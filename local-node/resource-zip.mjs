import { DiskZipReader } from './disk-zip.mjs';
import { BrArchiveReader } from './brarchive.mjs';
import { LIMITS, fail } from './limits.mjs';
import { normalizeZipPath } from '../editor-core/src/path/normalize-zip-path.js';

const ARCHIVE_CACHE_BYTES = 32 * 1024 * 1024;
const ARCHIVE_READ_BYTES = 64 * 1024 * 1024;
const ARCHIVE_COUNT = 128;
/** Adds bounded, read-only virtual resource paths for brarchive v1.
 * Loose files win at identical paths. Stored ZIP statistics retain their
 * meaning; virtual counts and skipped archives are separate metadata. */
export class ResourceZipReader extends DiskZipReader {
  constructor({ resourceRoot = '' } = {}) {
    super();
    if (typeof resourceRoot !== 'string' || resourceRoot && normalizeZipPath(resourceRoot) + '/' !== resourceRoot) fail('ZIP_RESOURCE_ROOT_INVALID');
    this.resourceRoot = resourceRoot; this.virtualEntries = new Map(); this.brReaders = []; this.resourceWarnings = [];
  }
  async listEntries() {
    if(this.closed||this.closing)fail('ZIP_CLOSED');
    // Concurrent callers share one atomic indexing operation. A caller must
    // never observe a partial set while another is mounting an archive.
    this.resourceIndexPromise ||= this.indexResources();
    return this.resourceIndexPromise;
  }
  async indexResources() {
    const result = await super.listEntries();
    const loose = new Set([...this.entryIndex.keys()].map(x=>x.normalize('NFC').toLowerCase()));
    const virtualFolded = new Set();
    // Structural ZIP checks above cover the entire container. Resource mounts
    // and their work/cache/diagnostic budgets belong only to the selected RP.
    const archives = [...this.entryIndex].filter(([key])=>key.startsWith(this.resourceRoot)&&/(?:^|\/)__brarchive\/(?:textures|font|models|entity|render_controllers|ui|texts)(?:\/|\.brarchive$)/u.test(key)&&key.endsWith('.brarchive'));
    this.resourceWarnings = [...result.warnings];
    if (this.resourceRoot) {
      this.resourceWarnings = this.resourceWarnings.filter(w => w.code !== 'ZIP_ENTRIES_READ_BLOCKED');
      const blocked = [...this.entryIndex].filter(([key, item]) => key.startsWith(this.resourceRoot) && item.info.blockedReason).length;
      if (blocked) this.resourceWarnings.push({ code: 'ZIP_ENTRIES_READ_BLOCKED', resourceRoot: this.resourceRoot,
        message: `選択RP内の ${blocked} 件の項目は読取上限により利用できません。` });
    }
    let bytes = 0, mounted = 0, shadowed = 0, attempted = 0, failed = 0, skipped = 0, readBudgetBytes = 0;
    let fullyShadowedArchives = 0, emptyArchives = 0, releasedArchives = 0, releasedBytes = 0;
    for(const [archivePath,item] of archives){
      if(this.closed||this.closing)fail('ZIP_CLOSED');
      const reasons = [];
      if(attempted>=ARCHIVE_COUNT)reasons.push('archive-count');
      if(item.info.blockedReason)reasons.push('blocked-entry');
      if(item.info.uncompressedSize>ARCHIVE_CACHE_BYTES-bytes)reasons.push('cache-capacity');
      if(item.info.uncompressedSize>ARCHIVE_READ_BYTES-readBudgetBytes)reasons.push('read-budget');
      const limitCode=attempted>=ARCHIVE_COUNT?'BRARCHIVE_COUNT_LIMIT'
        :item.info.uncompressedSize>ARCHIVE_CACHE_BYTES-bytes||item.info.blockedReason?'BRARCHIVE_CACHE_LIMIT'
        :item.info.uncompressedSize>ARCHIVE_READ_BYTES-readBudgetBytes?'BRARCHIVE_READ_BUDGET_LIMIT':null;
      if(limitCode){
        skipped++;
        this.resourceWarnings.push({code:limitCode,message:`内部素材 ${archivePath} は読み取り上限のため使用できません。`,
          archivePath,reasons,blockedReason:item.info.blockedReason||null,archiveBytes:item.info.uncompressedSize,
          cacheBytes:bytes,cacheLimitBytes:ARCHIVE_CACHE_BYTES,readBudgetBytes,readLimitBytes:ARCHIVE_READ_BYTES,
          attempted,attemptLimit:ARCHIVE_COUNT});continue;
      }
      // Charge attempted reads too: repeated malformed archives must not evade
      // the work budget simply because none was retained in the cache.
      attempted++;readBudgetBytes+=item.info.uncompressedSize;
      let reader;
      try {
        const buffer = await super.bytes(archivePath,ARCHIVE_CACHE_BYTES);
        if(this.closed||this.closing)fail('ZIP_CLOSED');
        reader = await BrArchiveReader.fromBytes(buffer);
        const {entries,warnings}=await reader.listEntries();
        if(this.closed||this.closing)fail('ZIP_CLOSED');
        const prefix = archivePath.replace(/(^|\/)__brarchive\//u,'$1').slice(0,-'.brarchive'.length)+'/';
        const staged=[];let stagedShadowed=0;
        for(const entry of entries){
          const key=prefix+entry.path,folded=key.normalize('NFC').toLowerCase();
          if(loose.has(folded)){stagedShadowed++;continue;}
          if(virtualFolded.has(folded))fail('BRARCHIVE_RESOURCE_COLLISION');
          if(this.entryIndex.size+staged.length>=LIMITS.entries)fail('BRARCHIVE_RESOURCE_COUNT_LIMIT',413);
          staged.push({key,folded,entry});
        }
        for(const {key,folded,entry}of staged){
          virtualFolded.add(folded);this.virtualEntries.set(key,{reader,name:entry.path});
          this.entryIndex.set(key,{info:{...entry,path:key,originalName:key,archivePath,archiveEntry:entry.path,virtual:true}});
        }
        mounted++;shadowed+=stagedShadowed;
        if(staged.length){
          bytes+=buffer.length;this.brReaders.push(reader);reader=null;
        }else{
          // A successfully inspected archive can contribute no virtual paths.
          // Release only retained storage; attempted work remains charged.
          releasedArchives++;releasedBytes+=buffer.length;
          if(entries.length)fullyShadowedArchives++;else emptyArchives++;
          await reader.close();reader=null;
        }
        this.resourceWarnings.push(...warnings.map(w=>({...w,message:`${archivePath}: ${w.message}`})));
      } catch(error) {
        failed++;
        await reader?.close();
        if(this.closed||this.closing)fail('ZIP_CLOSED');
        this.resourceWarnings.push({code:/^BRARCHIVE_[A-Z_]+$/u.test(error.message)?error.message:'BRARCHIVE_READ_FAILED',message:`内部素材 ${archivePath} を使用できません。通常のファイルは引き続き検査できます。`});
      }
    }
    if(this.closed||this.closing)fail('ZIP_CLOSED');
    this.resourcesIndexed=true;
    this.meta={...this.meta,brarchive:{seen:archives.length,attempted,mounted,failed,skipped,
      virtualEntries:this.virtualEntries.size,looseFileOverrides:shadowed,cacheBytes:bytes,
      retainedArchives:this.brReaders.length,fullyShadowedArchives,emptyArchives,releasedArchives,releasedBytes,
      cacheLimitBytes:ARCHIVE_CACHE_BYTES,readBudgetBytes,readLimitBytes:ARCHIVE_READ_BYTES,attemptLimit:ARCHIVE_COUNT}};
    return {meta:this.meta,warnings:this.resourceWarnings,entries:[]};
  }
  async bytes(path,maxBytes=LIMITS.entryBytes){
    if(this.closed||this.closing)fail('ZIP_CLOSED');
    const key=normalizeZipPath(path),virtual=this.virtualEntries.get(key);
    return virtual?virtual.reader.bytes(virtual.name,maxBytes):super.bytes(key,maxBytes);
  }
  async close(){
    if(this.resourceClosePromise)return this.resourceClosePromise;
    this.closing=true;
    // A bounded read already in flight may finish, but cannot publish another
    // mount after close begins. Wait for its cleanup before closing the ZIP.
    this.resourceClosePromise=(async()=>{
      try {
        await this.resourceIndexPromise?.catch(()=>{});
        for(const reader of this.brReaders)await reader.close();
      } finally { this.brReaders.length=0;this.virtualEntries.clear();await super.close(); }
    })();
    return this.resourceClosePromise;
  }
}
