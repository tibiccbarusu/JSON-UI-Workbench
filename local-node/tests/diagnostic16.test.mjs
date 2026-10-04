import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalServer } from '../server.mjs';
import { auditVanillaReference } from '../../editor-core/src/vanilla/vanilla-reference-audit.js';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';

test('原文の空min/max制約は配置と診断で一致し、不正な他のvectorは警告する', () => {
  const layout = props => computeLayoutBoxesForFile({rootId:'root', nodesById:{
    root:{id:'root',type:'panel',props:{size:[30,20],...props},children:[]},
  }}, {width:100,height:80});
  const implicit=layout({}), empty=layout({min_size:[],max_size:[]});
  assert.deepEqual(empty.boxes,implicit.boxes);
  assert.equal(empty.warnings.some(w=>w.startsWith('LAYOUT_SCALAR_UNSUPPORTED:')),false);
  for(const props of [{size:[]},{offset:[]},{min_size:[1]},{max_size:[1]}]) {
    assert.equal(layout(props).warnings.some(w=>w.startsWith('LAYOUT_SCALAR_UNSUPPORTED:')),true,JSON.stringify(props));
  }
});

test('未指定の版タグはchannel不一致と誤診断しない（実際の相違は維持）', () => {
  const unknown = auditVanillaReference({ expectedChannel: 'stable', sourceChannel: 'stable' });
  assert.equal(unknown.version.status, 'UNKNOWN');
  assert.equal(unknown.version.channelStatus, 'UNKNOWN');
  assert.equal(unknown.verifiedReferenceInputReady, false);
  const mismatch = auditVanillaReference({ expectedChannel: 'preview', sourceChannel: 'stable' });
  assert.equal(mismatch.version.channelStatus, 'MISMATCH');
  const contradictory = auditVanillaReference({ expectedChannel: 'stable', sourceChannel: 'stable', sourceRelease: '1.26.40-preview' });
  assert.equal(contradictory.version.channelStatus, 'MISMATCH');
});

test('実HTTP: ブラウザの任意favicon要求は成功、他の不明経路と不正methodは拒否', { timeout: 15000 }, async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`;
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(base + '/favicon.ico', { method, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 204); assert.equal(await response.text(), '');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const missing = await fetch(base + '/unknown-resource', { signal: AbortSignal.timeout(5000) });
  assert.equal(missing.status, 404); assert.equal((await missing.json()).error, 'NODE_STATIC_NOT_FOUND');
  const method = await fetch(base + '/favicon.ico', { method: 'POST', signal: AbortSignal.timeout(5000) });
  assert.equal(method.status, 405); await method.arrayBuffer();
});
