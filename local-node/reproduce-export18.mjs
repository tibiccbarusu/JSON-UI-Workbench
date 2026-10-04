import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { planWorkspaceExport, buildWorkspaceExport } from './workspace-export.mjs';
import { ResourceZipReader } from './resource-zip.mjs';
import { importResourcePackZip } from '../editor-core/src/pack-io/pack-importer.js';
const root = resolve(process.argv[2]), zipPath = resolve(process.argv[3]), output = resolve(process.argv[4]);
await mkdir(output, {recursive:true});
const paths = (await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>join(e.parentPath??e.path,e.name).slice(root.length+1).replaceAll('\\','/'));
const imported=await importResourcePackZip({diskPath:zipPath,name:'inventory-background.zip',size:(await stat(zipPath)).size},{zipReader:new ResourceZipReader()});
if(!imported.ok) throw new Error(JSON.stringify(imported.error));
const sources=[{id:'vanilla',kind:'vanilla',paths,readText:p=>readFile(join(root,p),'utf8'),readBytes:p=>readFile(join(root,p))},
 {id:'imported',kind:'imported',paths:imported.packPaths,readText:(p,maxBytes)=>imported.zipReader.readText(imported.rootPrefix+p,{maxBytes}),readBytes:(p,maxBytes)=>imported.zipReader.bytes(imported.rootPrefix+p,maxBytes)}];
try {
 const options={sources,selections:[{filePath:'ui/anvil_screen.json',rawKey:'anvil_screen@common.inventory_screen_common'}]};
 const result=await planWorkspaceExport(options);
 await writeFile(join(output,'plan.json'),JSON.stringify(result,null,2)+'\n');
 const codes={};for(const row of result.plan.unresolved)codes[row.code]=(codes[row.code]??0)+1;
 process.stdout.write(JSON.stringify({ok:result.ok,unresolved:result.plan.unresolved.length,codes,warnings:result.plan.warnings.length,files:result.plan.files.length})+'\n');
 if (process.argv.includes('--build') && result.ok) {const built=await buildWorkspaceExport(options);await writeFile(join(output,'selected.zip'),built.bytes);process.stdout.write(JSON.stringify({zipBytes:built.size,sha256:built.sha256})+'\n');}
} finally {await imported.zipReader.close();}
