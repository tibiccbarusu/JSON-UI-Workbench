import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { nativePreviewPointerForBox } from '../src/preview/native-motion.js';
const source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, name); return source.slice(start, end + 2);
}
function harness() {
  const timers = new Map(), raf = [], draws = [], samples = [];
  let id = 0, now = 100;
  const state = { ui: { tabs: { center: 'canvas' } }, files: { currentFileId: 'f' } };
  const cs = { nativeMotionHasBook: true, view: { zoom: 1, viewX: 0, viewY: 0 }, layout: {}, propsByIdOverride: {}, interaction: { active: false } };
  const canvas = { getBoundingClientRect: () => ({ width: 640, height: 360 }) };
  const document = { hidden: false, getElementById: () => canvas };
  const context = vm.createContext({ document, window: { devicePixelRatio: 1 }, performance: { now: () => now },
    nativePreviewPointerForBox,
    store: { getState: () => state }, getCanvasKey: () => 'f', getCanvasState: () => cs,
    setTimeout(callback, delay) { timers.set(++id, { callback, delay }); return id; }, clearTimeout(timerId) { timers.delete(timerId); },
    requestAnimationFrame(callback) { raf.push(callback); }, drawCanvasNow(key, options) { draws.push({ key, options }); },
    drawCanvasPreview(...args) { draws.push(args); },
    sampleNativePreviewMotion(scene, opts) { samples.push({ scene, opts }); return { ...scene, moved: true }; },
  });
  vm.runInContext(`let pendingCanvasTextureRedraw=false,pendingCanvasTextureNativeOnly=false;
    let nativeMotionFrameTimer=null,nativeMotionLastTickMs=0,nativeMotionElapsedMs=0,nativeMotionEnabled=true,nativeMotionSnapshotOwner=null;
    let textureCompositionEpoch=0;
    ${fn('requestCanvasTextureRedraw')}
    ${fn('stopNativeMotionPreview')}
    ${fn('startNativeMotionPreview')}
    ${fn('drawNativeMotionFromSnapshot')}
    globalThis.api={start:startNativeMotionPreview,stop:stopNativeMotionPreview,redraw:requestCanvasTextureRedraw,
      draw:drawNativeMotionFromSnapshot,elapsed:()=>nativeMotionElapsedMs,disable:()=>nativeMotionEnabled=false,
      ownSnapshot:(cs)=>nativeMotionSnapshotOwner=cs};`, context);
  return { api: context.api, cs, state, canvas, document, timers, raf, draws, samples,
    tick() { now += 40; const [key, timer] = timers.entries().next().value; timers.delete(key); timer.callback(); },
    frame() { while (raf.length) raf.shift()(); },
    snapshot() { context.api.ownSnapshot(cs); cs.nativeMotionSnapshot = { canvas, key: 'f', state, layout: cs.layout, props: cs.propsByIdOverride,
      textureEpoch: 0, structureMode: cs.structureMode, interaction: cs.interaction, activeInteraction: false,
      hoverId: cs.hoverId, dpr: 1, view: [1, 0, 0], width: 640, height: 360,
      nativeEntries: [['book', { nativeBaseScene: { kind: 'book' } }]], drawLayout: {}, drawSelection: { textDrawById: { fixed: true } } }; return cs.nativeMotionSnapshot; },
  };
}
test('3D自律timerは1件のみ・40ms間隔で再描画要求をまとめる', () => {
  const h = harness(); h.api.start(); h.api.start(); assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 40); h.tick();
  assert.equal(h.timers.size, 1); assert.equal(h.api.elapsed(), 40); h.frame();
  assert.equal(h.draws.length, 1); assert.equal(h.draws[0].options.nativeOnly, true);
  h.api.stop(); assert.equal(h.timers.size, 0);
});
test('OFF/hidden/closed/タブ変更/モデル無しでtimerが停止する', () => {
  for (const change of [h => h.api.disable(), h => h.document.hidden = true,
    h => h.cs.previewClosed = true, h => h.state.ui.tabs.center = 'source', h => h.cs.nativeMotionHasBook = false]) {
    const h = harness(); h.api.start(); change(h); h.tick(); h.frame();
    assert.equal(h.timers.size, 0); assert.equal(h.draws.length, 0);
  }
});
test('通常描画要求が混ざった場合は順序に関係なく完全描画を優先する', () => {
  for (const reverse of [false, true]) {
    const h = harness();
    if (reverse) { h.api.redraw(); h.api.redraw({ nativeOnly: true }); }
    else { h.api.redraw({ nativeOnly: true }); h.api.redraw(); }
    assert.equal(h.raf.length, 1); h.frame(); assert.equal(h.draws[0].options.nativeOnly, false);
  }
});
test('native専用描画は前回のtext/texture metadataを再利用してsceneだけ更新する', () => {
  const h = harness(), snapshot = h.snapshot();
  assert.equal(h.api.draw('f', h.canvas, h.cs), true); assert.equal(h.samples.length, 1);
  assert.equal(h.draws[0][3], snapshot.drawSelection);
  assert.equal(snapshot.drawSelection.textDrawById.fixed, true);
  assert.equal(snapshot.nativeEntries[0][1].nativeScene.moved, true);
});
test('layout/props/view/hover/interaction/closed変更で古いmetadataを再利用しない', () => {
  for (const change of [h => h.cs.layout = {}, h => h.cs.propsByIdOverride = {}, h => h.cs.view.zoom = 2,
    h => h.cs.hoverId = 'x', h => h.cs.interaction.active = true, h => h.cs.previewClosed = true,
    h => h.document.hidden = true]) {
    const h = harness(); h.snapshot(); change(h);
    assert.equal(h.api.draw('f', h.canvas, h.cs), false); assert.equal(h.samples.length, 0); assert.equal(h.draws.length, 0);
  }
});

test('同じpointerでも複数モデルは各control中心を基準に向きが変わる', () => {
  const h = harness(), snapshot = h.snapshot();
  h.cs.nativePointerWorld = { active: true, x: 110, y: 20 };
  snapshot.nativeEntries = [
    ['left', { nativeBaseScene: { kind: 'horse' }, nativeControlBox: { x: 0, y: 0, w: 100, h: 40 } }],
    ['right', { nativeBaseScene: { kind: 'player' }, nativeControlBox: { x: 120, y: 0, w: 100, h: 40 } }],
  ];
  assert.equal(h.api.draw('f', h.canvas, h.cs), true);
  assert.equal(h.samples[0].opts.pointer.x, 1);
  assert.equal(h.samples[1].opts.pointer.x, -1);
  h.cs.nativePointerWorld.active = false;
  h.api.draw('f', h.canvas, h.cs);
  assert.equal(h.samples[2].opts.pointer.active, false);
  assert.equal(h.samples[3].opts.pointer.active, false);
});

test('cursor専用sceneのsnapshotはidle中保持し明示停止で解放する', () => {
  const h = harness(), snapshot = h.snapshot(); h.cs.nativeMotionHasBook = false;
  h.api.start(); assert.equal(h.timers.size, 0); assert.equal(h.cs.nativeMotionSnapshot, snapshot);
  h.api.stop(); assert.equal(h.cs.nativeMotionSnapshot, null);
});
