import {DiskZipReader} from './disk-zip.mjs';
import {importResourcePackZip} from '../editor-core/src/pack-io/pack-importer.js';
import {parseJsonc} from '../editor-core/src/json/jsonc.js';
import {parseDefinitionKey} from '../editor-core/src/engine/ui-catalog.js';
import {createHash,randomBytes} from 'node:crypto';
import {writeFile,stat} from 'node:fs/promises';
const [input,output]=process.argv.slice(2);if(!input||!output)throw new Error('input.zip output.json を指定してください。');
// UUIDv7 の時刻部と randomBytes の乱数部を保持し、過去実行IDを再利用しない。
function makeAuditRunId() {
  const now=new Date(), bytes=randomBytes(16);
  bytes.writeUIntBE(now.getTime(),0,6);bytes[6]=(bytes[6]&0x0f)|0x70;bytes[8]=(bytes[8]&0x3f)|0x80;
  const timestamp=now.toISOString().slice(0,19).replace(/[-:]/g,'').replace('T','t')+'z';
  return `run-${timestamp}-${bytes.toString('hex')}`;
}
const configuredRunId=process.env.JSONUI_AUDIT_RUN_ID;
if(configuredRunId && !/^run-[0-9]{8}t[0-9]{6}z-[0-9a-f]{32}$/.test(configuredRunId))throw new Error('AUDIT_RUN_ID_INVALID');
const reader=new DiskZipReader(),report={run_id:configuredRunId || makeAuditRunId(),run_id_method:configuredRunId?'caller-supplied':'uuidv7-crypto-randomBytes',started_at:new Date().toISOString(),ordered_ui_defs:[],definitions:[]};
try{
  const pack=await importResourcePackZip({diskPath:input,name:'snapshot.zip',size:(await stat(input)).size},{zipReader:reader});if(!pack.ok)throw pack.error;
  const registry=await reader.readText(pack.rootPrefix+'ui/_ui_defs.json');const parsed=parseJsonc(registry);if(!parsed.ok||!Array.isArray(parsed.value.ui_defs))throw new Error('UI_DEFS_INVALID');
  report.registry_sha256=createHash('sha256').update(registry).digest('hex');
  for(const [order,file]of parsed.value.ui_defs.entries()){
    try{
      const text=await reader.readText(pack.rootPrefix+file),value=parseJsonc(text);if(!value.ok)throw new Error('UI_JSON_INVALID');
      report.ordered_ui_defs.push({order,file,sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text),status:'PRESENT'});
      for(const [rawKey,definition]of Object.entries(value.value))if(rawKey!=='namespace'&&definition&&typeof definition==='object'&&!Array.isArray(definition)){
        const key=parseDefinitionKey(rawKey);report.definitions.push({order,file,namespace:value.value.namespace||'',rawKey,localName:key.localName,baseRef:key.baseRef,type:definition.type||null});
      }
    }catch(error){report.ordered_ui_defs.push({order,file,status:'MISSING_OR_INVALID',error:error.code||error.message});}
  }
  report.missing_or_invalid_count=report.ordered_ui_defs.filter(item=>item.status==='MISSING_OR_INVALID').length;report.status=report.missing_or_invalid_count===0?'PASS':'PARTIAL';report.finished_at=new Date().toISOString();
  await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,registered:report.ordered_ui_defs.length,definitions:report.definitions.length}));
}finally{await reader.close();}
