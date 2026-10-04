import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolvePlannedPreviewNodeIds22 as resolve, pendingEditDiagnosticSummary22 as summary } from '../src/ui/workspace-preview-feedback22.js';

test('interaction計画はクリックされた画像ではなく親と共有される全編集先へ対応する', () => {
  const mapping = new Map([['image', { previewPointer:'/button/controls/0/image' }], ['button', { previewPointer:'/button' }], ['hover', { previewPointer:'/hover' }]]);
  assert.deepEqual(resolve(mapping, { target:{effectivePointer:'/button'}, affectedEffectivePointers:['/button','/hover'] }), ['button','hover']);
  for (const pointers of [['/button','/missing'], [], ['/hover']]) assert.throws(() => resolve(mapping, {target:{effectivePointer:'/button'},affectedEffectivePointers:pointers}), {code:'WORKSPACE_PREVIEW_TARGET_UNRESOLVED'});
  mapping.set('duplicate', {previewPointer:'/button'});
  assert.throws(() => resolve(mapping, {target:{effectivePointer:'/button'},affectedEffectivePointers:['/button']}), {code:'WORKSPACE_PREVIEW_TARGET_UNRESOLVED'});
});
test('未反映診断は件数と対象モードを記録し、原文と入力内容を取り込まない', () => {
  const state = {pendingOperations:Array.from({length:20}, () => ({operation:{type:'move',targetMode:'interaction',delta:[3,4],value:'SECRET',text:'SECRET'},previewNodeIds:['button']}))};
  const result = summary(state);
  assert.equal(result.count,20); assert.equal(result.operations.length,16); assert.equal(result.omittedOperations,4);
  assert.equal(result.operations[0].previewTargetCount,1); assert.deepEqual(result.operations[0].delta,[3,4]);
  assert(!JSON.stringify(result).includes('SECRET'));
});
test('実mainの再生・プレビュー状態変更ボタンは未反映中disabled、解除時は本来の制限を維持', async () => {
  const source = await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  const controls = [], notes = new Map();
  const sandbox = vm.createContext({sourceWorkspace:{state:{busy:false,pendingOperations:[],drafts:new Map()}},
    assertStudioExternalChange21(){throw new Error('blocked');},
    document:{querySelectorAll:()=>controls,getElementById:id=>notes.get(id)},
    h(tag,attrs){const node={tag,attrs,disabled:attrs.disabled,getAttribute:key=>attrs[key]};if(attrs['data-studio-runtime-control'])controls.push(node);return node;}});
  vm.runInContext(source.slice(source.indexOf('function studioRuntimeChangesBlocked21('),source.indexOf('function updateStudioPendingUi(')),sandbox);
  const normal=sandbox.studioRuntimeControlsH21('button',{onClick:()=>{}}), intrinsic=sandbox.studioRuntimeControlsH21('button',{onClick:()=>{},disabled:true});
  assert.equal(normal.disabled,false);assert.equal(intrinsic.disabled,true);
  sandbox.sourceWorkspace.state.pendingOperations.push({});sandbox.syncStudioRuntimeControls21();
  assert.equal(normal.disabled,true);assert.equal(intrinsic.disabled,true);
  sandbox.sourceWorkspace.state.pendingOperations=[];sandbox.syncStudioRuntimeControls21();
  assert.equal(normal.disabled,false);assert.equal(intrinsic.disabled,true);
});
