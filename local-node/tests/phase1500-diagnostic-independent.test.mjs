/** root担当の診断変更に対するux担当の独立境界検査。 */
import test from 'node:test';import assert from 'node:assert/strict';
import {buildDiagnosticsSnapshot} from '../../editor-core/src/diagnostics/log-export.js';
import {redactDiagnosticValue,summarizeDiagnosticMetadata} from '../../editor-core/src/diagnostics/site-diagnostic-session.js';
import {localizeConsoleResult} from '../console-i18n.mjs';
test('任意環境metadataが大きくても16KiBを超えず最新errorを保持する',()=>{
 const result=buildDiagnosticsSnapshot({maxBytes:16384,includeEnv:true,environment:{userAgent:'a'.repeat(512),timeZone:'z'.repeat(512),url:'https://example.com',viewport:Object.fromEntries(Array.from({length:30},(_,i)=>['dimension'+i,'x'.repeat(512)]))},entries:[{level:'error',message:'newest',id:'last'}]});
 assert.ok(result.bytes<=16384,`${result.bytes}>16384`);assert.equal(result.document.entries.at(-1)?.id,'last');assert.equal(result.bytes,Buffer.byteLength(result.text));assert.equal(JSON.parse(result.text).summary.outputBytes,result.bytes);
});
test('日本語・異なるbyte予算でもserialized summaryのbytesと実bytesが一致する',()=>{
 for(const maxBytes of [16384,17400,20000,32768]){const entries=Array.from({length:80},(_,i)=>({id:'id'+i,level:i===79?'error':'info',message:'字形🙂'.repeat(i+1)}));const result=buildDiagnosticsSnapshot({maxBytes,context:{state:'大'.repeat(1200)},entries,droppedEntryCount:3});const saved=JSON.parse(result.text);
 assert.equal(saved.summary.outputBytes,Buffer.byteLength(result.text));assert.equal(result.bytes,Buffer.byteLength(result.text));assert.ok(result.bytes<=maxBytes);assert.equal(saved.entries.at(-1).id,'id79');assert.equal(saved.summary.droppedEntryCount,3+80-saved.entries.length);}
});
test('__proto__のown keyを保全しても秘密・原文のredactionを通過させない',()=>{
 const value=JSON.parse('{"__proto__":{"password":"hidden","body":"source code"},"token":"hidden","safe":1}');const out=redactDiagnosticValue(value);assert.equal(Object.hasOwn(out,'__proto__'),true);assert.equal(out.__proto__.password,'[REDACTED_SECRET]');assert.equal(out.__proto__.body,'[REDACTED_BODY]');assert.equal(out.token,'[REDACTED_SECRET]');assert.equal(Object.getPrototypeOf(out),Object.prototype);assert.equal({}.password,undefined);
 const meta=summarizeDiagnosticMetadata(value);assert.equal(Object.hasOwn(meta,'__proto__'),true);assert.equal(meta.__proto__.values,'[OMITTED_BY_POLICY]');assert.equal(meta.token,'[REDACTED_SECRET]');
});
test('console翻訳はdiagnostic envelopeだけを変更し不明IRと__proto__を維持する',()=>{
 const input=JSON.parse('{"__proto__":{"marker":"keep"},"uiModel":{"message":"入力が必要です"},"diagnostics":[{"code":"EDIT_PATH_INVALID","message":"入力が必要です"}]}');const result=localizeConsoleResult(input,'en');
 assert.equal(Object.hasOwn(result,'__proto__'),true);assert.equal(result.__proto__.marker,'keep');assert.equal(result.uiModel,input.uiModel);assert.equal(result.diagnostics[0].code,'EDIT_PATH_INVALID');assert.match(result.diagnostics[0].message,/safe relative JSON path/);assert.equal(input.diagnostics[0].message,'入力が必要です');assert.equal(Object.getPrototypeOf(result),Object.prototype);
});
