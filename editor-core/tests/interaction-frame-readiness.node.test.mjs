import test from 'node:test';
import assert from 'node:assert/strict';
import { previewLayoutInputKey, isPreviewInteractionFrameCurrent } from '../src/preview/interaction-frame-readiness.js';

function setup() {
  const file = { id:'screen:ui/test.json', uiModel:{}, nodesById:{} };
  const state = { preview:{ mockDataVersion:1 }, ui:{ previewLocale:'en_US' } };
  const canvasState = { structureMode:false, layout:{ boxes:[] }, layoutInputFile:file, nodeFrameAppliedFile:file };
  const input = { state, file, canvasState, preset:{width:100,height:100}, assetMetricsRevision:0, nodeFrameAvailability:true, animationEvent:'default' };
  canvasState.layoutInputKey = previewLayoutInputKey(input);
  canvasState.nodeFrameContext = canvasState.nodeFrameAppliedContext = `${canvasState.layoutInputKey}|default`;
  return input;
}

test('new mock state is blocked before ensureLayout schedules any frame',()=>{
  const input=setup();assert.equal(isPreviewInteractionFrameCurrent(input),true);
  input.state.preview.mockDataVersion++;assert.equal(isPreviewInteractionFrameCurrent(input),false);
});
test('new request key cannot certify old applied props/layout',()=>{
  const input=setup();input.state.preview.mockDataVersion++;
  input.canvasState.layoutInputKey=previewLayoutInputKey(input);
  input.canvasState.nodeFrameContext=`${input.canvasState.layoutInputKey}|default`;
  assert.equal(isPreviewInteractionFrameCurrent(input),false);
  input.canvasState.nodeFrameAppliedContext=input.canvasState.nodeFrameContext;
  assert.equal(isPreviewInteractionFrameCurrent(input),true);
});
test('identical context strings do not permit another model or node index',()=>{
  for(const field of ['uiModel','nodesById']) {
    const input=setup();input.file={...input.file,[field]:{}};input.canvasState.layoutInputFile=input.file;
    assert.equal(input.canvasState.nodeFrameContext,input.canvasState.nodeFrameAppliedContext);
    assert.equal(isPreviewInteractionFrameCurrent(input),false);
    input.canvasState.nodeFrameAppliedFile=input.file;assert.equal(isPreviewInteractionFrameCurrent(input),true);
  }
});
test('locale, canvas size, structure, assets, scrolling, topic and event invalidate old frames',()=>{
  const mutations=[x=>x.state.ui.previewLocale='ja_JP',x=>x.preset.width++,x=>x.canvasState.structureMode=true,
    x=>x.assetMetricsRevision++,x=>x.canvasState.scrollRevision=1,x=>x.canvasState.previewTopicRootId='topic',x=>x.animationEvent='close'];
  for(const mutate of mutations){const input=setup();mutate(input);assert.equal(isPreviewInteractionFrameCurrent(input),false);}
});
test('unknown Node capability and failed layouts never admit gameplay input',()=>{
  const input=setup();input.nodeFrameAvailability=null;assert.equal(isPreviewInteractionFrameCurrent(input),false);
  input.nodeFrameAvailability=true;input.canvasState.layoutError={message:'failure'};assert.equal(isPreviewInteractionFrameCurrent(input),false);
});
test('browser synchronous layout permits input only after the current layout completes',()=>{
  const input=setup();input.nodeFrameAvailability=false;delete input.canvasState.nodeFrameAppliedFile;delete input.canvasState.nodeFrameAppliedContext;
  assert.equal(isPreviewInteractionFrameCurrent(input),true);
  input.state.preview.mockDataVersion++;assert.equal(isPreviewInteractionFrameCurrent(input),false);
  input.canvasState.layoutInputKey=previewLayoutInputKey(input);assert.equal(isPreviewInteractionFrameCurrent(input),true);
});
test('time-only animation work keeps the completed displayed frame usable',()=>{
  const input=setup();input.canvasState.nodeFrameRequestKey=`${input.canvasState.nodeFrameContext}|1.25`;
  assert.equal(isPreviewInteractionFrameCurrent(input),true);
  input.canvasState.nodeFrameRequestKey=`${input.canvasState.nodeFrameContext}|1.5`;
  assert.equal(isPreviewInteractionFrameCurrent(input),true);
});
