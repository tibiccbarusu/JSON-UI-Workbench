import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionHistory28 } from '../src/diagnostics/action-history28.js';
import { createPreviewDebugRequest23 } from '../src/diagnostics/preview-debug-request23.js';

test('同じ選択を集約し first/last時刻と回数を残す', () => {
  let ms = 1000; const log = createActionHistory28({ now: () => ms });
  for (let i = 0; i < 50; i++) { log.record({ type: 'editor/selectNode', summary: 'root/close' }); ms += 10; }
  assert.equal(log.entries.length, 1); assert.equal(log.entries[0].count, 50);
  assert.equal(log.entries[0].tsIso, new Date(1000).toISOString());
  assert.equal(log.entries[0].last_ts_iso, new Date(1490).toISOString());
  assert.equal(log.stats().coalesced_events, 49);
});
test('重要操作・別選択・時間差・逆行時刻を合流しない', () => {
  let ms=1000;const log=createActionHistory28({now:()=>ms});
  for(const type of ['editor/updateProperty','editor/updateProperty','editor/selectNode'])log.record({type,summary:'same'});
  ms+=751;log.record({type:'editor/selectNode',summary:'same'});ms-=10;log.record({type:'editor/selectNode',summary:'same'});
  log.record({type:'editor/selectNode',summary:'other'}); assert.equal(log.entries.length,6);
});
test('保持上限と省略元イベント数を正しく数える', () => {
  const log=createActionHistory28({limit:2,now:()=>1000});
  for(let i=0;i<7;i++)log.record({type:'editor/selectNode',summary:'one'});
  log.record({type:'commit',summary:'one'});log.record({type:'commit',summary:'two'});
  assert.equal(log.entries.length,2);assert.equal(log.stats().dropped_events,7);
  assert.equal(log.stats().total_events,9);
});
test('入力長と機密のマスキングを保持する', () => {
  const log=createActionHistory28();log.record({type:'x'.repeat(10000),summary:'Authorization: Bearer secret-secret-secret'});
  assert.equal(log.entries[0].type.length,128);assert(!JSON.stringify(log.entries).includes('secret-secret-secret'));
  log.record({type:'commit',summary:'漢'.repeat(10000)});assert(log.entries[1].summary.length<=2048);
  for(const limit of [0,NaN,2001])assert.throws(()=>createActionHistory28({limit}));
});
test('500件を保持してもbundleの有限収録と省略表示が成立', () => {
  const log=createActionHistory28();for(let i=0;i<510;i++)log.record({type:'edit',summary:String(i)});
  const bundle=createPreviewDebugRequest23({events:log.entries,state:{actionHistory:log.stats()}});
  assert.equal(bundle.state.capture.events.available,500);
  assert.equal(bundle.state.capture.events.included,200);
  assert.equal(bundle.state.capture.events.omitted,300);
  assert(Buffer.byteLength(JSON.stringify(bundle))<1024*1024);
});
