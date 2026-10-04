import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeRequestLog35 } from '../src/diagnostics/node-request-log35.js';
import { renderStudioAppearance35, textureSuggestions35 } from '../src/ui/studio-appearance35.js';
import { createPreviewDebugRequest23 } from '../src/diagnostics/preview-debug-request23.js';

test('通信履歴は本文やqueryを収集せず、失敗request IDを成功の大量発生後も保持する', () => {
  const log = createNodeRequestLog35({ capacity: 3, failureCapacity: 2 });
  const first = log.begin('packs/PRIVATE_UUID/read?path=PRIVATE_TEXTURE&token=PRIVATE_TOKEN');
  log.end(first, { status: 500, code: 'PACK_INVALID', correlationId: 'request-first' });
  log.end(first, { status: 500, code: 'DUPLICATE' });
  for (let i = 0; i < 20; i++) log.end(log.begin('frame'), { status: 200, correlationId: `request-${i}` });
  const snapshot = log.snapshot();
  assert.equal(snapshot.counters.started, 21); assert.equal(snapshot.counters.failed, 1);
  assert.equal(snapshot.recent.length, 3); assert.equal(snapshot.failures.length, 1);
  assert.equal(snapshot.failures[0].correlation_id, 'request-first');
  assert.equal(snapshot.failures[0].route, 'packs/:id/read');
  assert.equal(snapshot.recent[0].phase, 'response-headers');
  assert(!JSON.stringify(snapshot).includes('PRIVATE_'));
  snapshot.failures[0].code = 'MUTATED'; assert.equal(log.snapshot().failures[0].code, 'PACK_INVALID');
});
test('通信の取消と期限超過を分離し、不正なコードとrequest IDをそのまま保存しない', () => {
  const log = createNodeRequestLog35();
  log.end(log.begin('catalog'), { code: 'NODE_REQUEST_FAILED', cancelled: true });
  log.end(log.begin('workspace-edit'), { code: 'NODE_REQUEST_TIMEOUT' });
  log.end(log.begin('read/PRIVATE?token=SECRET'), { status: 500, code: '/home/PRIVATE', correlationId: 'token=SECRET' });
  const snapshot = log.snapshot(); assert.equal(snapshot.counters.cancelled, 1); assert.equal(snapshot.counters.failed, 2);
  assert.equal(snapshot.failures[0].code, 'NODE_REQUEST_TIMEOUT');
  assert.equal(snapshot.failures[1].correlation_id, null); assert.equal(snapshot.failures[1].code, 'NODE_REQUEST_FAILED');
  assert(!JSON.stringify(snapshot).includes('SECRET')); assert(!JSON.stringify(snapshot).includes('PRIVATE'));
  const request = createPreviewDebugRequest23({ state: { transport: snapshot } });
  assert.equal(request.state.transport.failures[0].code, 'NODE_REQUEST_TIMEOUT');
});
test('テクスチャ候補は実在する画像だけをパック優先で重複除去し、候補数を制限する', () => {
  const make = paths => ({ textures: { byLower: new Map(paths.map(p => [p.toLowerCase(), [p]])) } });
  const indexes = [make(['textures/ui/a.png', 'textures/ui/a.tga', 'textures/ui/a.json']), make(['textures/ui/b.png', 'textures/ui/c.jpg', 'font/glyph.png'])];
  assert.deepEqual(textureSuggestions35(indexes), ['textures/ui/a', 'textures/ui/b', 'textures/ui/c']);
  assert.deepEqual(textureSuggestions35(indexes, 'ui/b'), ['textures/ui/b']);
  assert.equal(textureSuggestions35(indexes, '', 1).length, 1);
});
test('文字欄は日本語と引用符をそのまま受け取り、変更ボタンまで編集を送らない', () => {
  const h = (tag, props = {}, children = []) => ({ tag, props, children });
  const calls = [], draft = { value: '前の文字' };
  const view = renderStudioAppearance35(h, { type: 'label', value: '前の文字', draft, onApply: (...args) => calls.push(args) });
  const input = view.children.find(x => x?.tag === 'textarea');
  input.props.onInput({ currentTarget: { value: '日本語 "見出し"\n2行目' } });
  assert.equal(calls.length, 0);
  view.children.find(x => x?.tag === 'button').props.onClick();
  assert.deepEqual(calls, [['text', '日本語 "見出し"\n2行目']]);
  assert.equal(renderStudioAppearance35(h, { type: 'button', value: '', draft }), null);
});
