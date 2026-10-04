import test from 'node:test';
import assert from 'node:assert/strict';
import '../../editor-core/tests/suite-regressions.js';
import {getRegisteredTests} from '../../editor-core/tests/test-harness.js';
import {validateUiDefsState, summarizeValidation} from '../../editor-core/src/validation/validator.js';
import {generateSchemaFilesDraft07} from '../../editor-core/src/schema/schema-generator.js';
import {applyTextRanges, parseEditableJsonc, pointerParts, pointerJoin, appendEditableRawProperty} from '../workspace-jsonc.mjs';
for(const tc of getRegisteredTests().filter(x=>/^(?:schema metadata|generated schemas|validator|native runtime element types|resource-backed book|native renderer validation|binding-evaluated ignored|hard-ignored subtrees)/u.test(x.name))) test(tc.name,tc.fn);
test('ui_defs format versionは正の安全整数だけを保存可能とし小数を拒否する',()=>{
 for(const formatVersion of [1.5,0,-1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]){
  const result=validateUiDefsState({formatVersion,uiDefs:['ui/main.json']}); assert.equal(result.ok,false);assert(result.errors.some(x=>x.code==='UI_DEFS_FORMAT_VERSION_INVALID'));
 }
 for(const formatVersion of [1,2,'1']) assert.equal(validateUiDefsState({formatVersion,uiDefs:['ui/main.json']}).ok,true);
 const invalid=validateUiDefsState({formatVersion:1,uiDefs:['../bad.json']}); assert.match(summarizeValidation(invalid),/BLOCKED/);
 const warning=validateUiDefsState({formatVersion:1,uiDefs:[]}); assert.equal(warning.ok,true);assert.match(summarizeValidation(warning),/warning/);
});
test('schema bundleは5個の固有相対名とJSON再読取可能な値を返す',()=>{
 const files=generateSchemaFilesDraft07();assert.equal(files.length,5);assert.equal(new Set(files.map(x=>x.path)).size,5);
 for(const file of files) assert.deepEqual(JSON.parse(JSON.stringify(file.json)),JSON.parse(JSON.stringify(generateSchemaFilesDraft07().find(x=>x.path===file.path).json)));
});
test('JSON Pointerはslashとtildeを往復し不正escapeを拒否する',()=>{
 const parts=['a/b','x~y','','0'];assert.deepEqual(pointerParts(pointerJoin(parts)),parts);
 for(const pointer of ['no-root','/~2','/dangling~']) assert.throws(()=>pointerParts(pointer),{code:'EDIT_POINTER_INVALID'});
});
test('JSONC rangeは重なりを拒否し無関係なcomment/BOMを保持する',()=>{
 assert.throws(()=>applyTextRanges('abcdef',[{start:1,end:4,text:'x'},{start:3,end:5,text:'y'}]),{code:'EDIT_RANGE_INVALID'});
 const text='\uFEFF{\r\n //keep\r\n "namespace":"x",\r\n "existing":{"type":"panel"}\r\n}';
 const raw='{ /* authored */ "type":"label", "text":"$dynamic" }';
 const after=appendEditableRawProperty(text,parseEditableJsonc(text),'copy@x.existing',raw);
 assert(after.startsWith('\uFEFF{\r\n //keep'));assert(after.includes(raw));assert.equal(parseEditableJsonc(after).value['copy@x.existing'].text,'$dynamic');
 assert.throws(()=>appendEditableRawProperty(text,parseEditableJsonc(text),'existing',raw),{code:'EDIT_NAME_CONFLICT'});
});
