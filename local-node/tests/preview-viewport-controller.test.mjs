import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewViewportController } from '../../editor-core/src/ui/preview-viewport.js';

function fixture({ native = true } = {}) {
  const listeners = new Map(), classes = new Set(), pending = [];
  let exits = 0, button = { textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const doc = {
    documentElement: { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } },
    fullscreenElement: null,
    getElementById: id => id === 'preview-expand' ? button : null,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
    exitFullscreen: async () => { exits++; doc.fullscreenElement = null; listeners.get('fullscreenchange')?.(); },
  };
  if (native) doc.documentElement.requestFullscreen = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  return { doc, classes, pending, listeners,
    get exits() { return exits; }, get button() { return button; },
    replaceButton() { button = { textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }; },
    succeed(index) { doc.fullscreenElement = doc.documentElement; pending[index].resolve(); },
    reject(index) { pending[index].reject(new Error('拒否の模擬')); },
  };
}

test('Fullscreen非対応でもCSS最大化・ボタン同期・元のsnapshot復元ができる', async () => {
  const f = fixture({ native: false }), restored = [];
  const controller = createPreviewViewportController({ document: f.doc, onExit: value => restored.push(value) });
  const snapshot = { key: 'file:a', view: { zoom: 2 } };
  await controller.enter(snapshot);
  assert.equal(controller.active, true);
  assert.ok(f.classes.has('preview-expanded'));
  f.replaceButton(); controller.sync();
  assert.equal(f.button.attributes['aria-pressed'], 'true');
  assert.match(f.button.textContent, /戻す/u);
  await controller.exit();
  assert.deepEqual(restored, [snapshot]);
  assert.equal(f.button.attributes['aria-pressed'], 'false');
  assert.equal(f.classes.has('preview-expanded'), false);
  controller.dispose();
});

test('Fullscreen拒否を未処理例外にせず最大化を継続する', async () => {
  const f = fixture(), notices = [];
  const controller = createPreviewViewportController({ document: f.doc, onNotice: value => notices.push(value) });
  const entering = controller.enter(); f.reject(0); await entering;
  assert.equal(controller.active, true);
  assert.equal(notices.length, 1);
  await controller.exit(); assert.equal(f.exits, 0);
  controller.dispose();
});

test('Fullscreenが無効な環境ではネイティブ要求を発行しない', async () => {
  const f = fixture(); f.doc.fullscreenEnabled = false;
  const controller = createPreviewViewportController({ document: f.doc });
  await controller.enter();
  assert.equal(controller.active, true); assert.equal(f.pending.length, 0);
  controller.dispose();
});

test('古い全画面要求の遅延完了は新しいセッションを終了しない', async () => {
  const f = fixture();
  const controller = createPreviewViewportController({ document: f.doc });
  const first = controller.enter({ key: 'a' });
  await controller.exit();
  const second = controller.enter({ key: 'b' });
  f.succeed(1); await second;
  f.succeed(0); await first;
  assert.equal(controller.active, true);
  assert.equal(f.exits, 0);
  await controller.exit(); assert.equal(f.exits, 1);
  controller.dispose();
});

test('古い要求が先に成功し新しい要求が拒否されても所有した全画面を後で解除できる', async () => {
  const f = fixture();
  const controller = createPreviewViewportController({ document: f.doc });
  const first = controller.enter(); await controller.exit();
  const second = controller.enter();
  f.succeed(0); await first; f.reject(1); await second;
  assert.equal(controller.active, true); assert.equal(f.exits, 0);
  await controller.exit(); assert.equal(f.exits, 1);
  controller.dispose();
});

test('解除後に完了した自分の全画面だけを後始末する', async () => {
  const f = fixture();
  const controller = createPreviewViewportController({ document: f.doc });
  const entering = controller.enter(); await controller.exit();
  f.succeed(0); await entering;
  assert.equal(controller.active, false); assert.equal(f.exits, 1);
  controller.dispose();
});

test('拡大前から存在する他機能の全画面は取得も解除もしない', async () => {
  for (const sameRoot of [true, false]) {
    const f = fixture(); f.doc.fullscreenElement = sameRoot ? f.doc.documentElement : { id: 'external' };
    const original = f.doc.fullscreenElement;
    const controller = createPreviewViewportController({ document: f.doc });
    await controller.enter(); await controller.exit();
    assert.equal(f.pending.length, 0); assert.equal(f.exits, 0);
    assert.equal(f.doc.fullscreenElement, original);
    controller.dispose();
  }
});

test('ブラウザから全画面が解除されたら状態とsnapshotを1回だけ戻す', async () => {
  const f = fixture(), restored = [];
  const controller = createPreviewViewportController({ document: f.doc, onExit: value => restored.push(value) });
  const entering = controller.enter('snapshot'); f.succeed(0); await entering;
  f.doc.fullscreenElement = null; f.listeners.get('fullscreenchange')(); f.listeners.get('fullscreenchange')();
  assert.equal(controller.active, false); assert.deepEqual(restored, ['snapshot']);
  assert.equal(f.exits, 0);
  controller.dispose();
});

test('DOMへ届く入力EscとIME変換中Escを奪わず通常Escで解除する', async () => {
  const f = fixture({ native: false });
  const controller = createPreviewViewportController({ document: f.doc });
  await controller.enter(); let prevented = 0;
  const event = target => ({ key: 'Escape', target, preventDefault() { prevented++; }, stopPropagation() {} });
  f.listeners.get('keydown')(event({ id: 'preview-editbox-overlay' }));
  f.listeners.get('keydown')({ ...event({}), isComposing: true });
  assert.equal(controller.active, true); assert.equal(prevented, 0);
  f.listeners.get('keydown')(event({ id: 'preview-canvas' }));
  assert.equal(controller.active, false); assert.equal(prevented, 1);
  controller.dispose();
});

test('RAFの世代照合で素早い再切替後の古いfitを破棄できる', async () => {
  const f = fixture({ native: false }), frames = []; let view = 3, controller;
  controller = createPreviewViewportController({ document: f.doc,
    onResize: expanded => {
      const generation = controller.generation;
      frames.push(() => { if (controller.generation === generation && controller.active === expanded && expanded) view = 9; });
    },
    onExit: snapshot => { view = snapshot.view; },
  });
  await controller.enter({ view }); await controller.exit();
  for (const frame of frames) frame();
  assert.equal(view, 3);
  controller.dispose();
});

test('dispose後の再入場や遅い応答でイベント監視を復活させない', async () => {
  const f = fixture();
  const controller = createPreviewViewportController({ document: f.doc });
  const entering = controller.enter(); controller.dispose();
  f.succeed(0); await entering; await controller.enter();
  assert.equal(controller.active, false); assert.equal(f.listeners.size, 0);
  assert.equal(f.pending.length, 1); assert.equal(f.exits, 1);
});

function ribbonFixture() {
  const f = fixture({ native: false }), nodes = new Map(), getOriginal = f.doc.getElementById;
  function makeNode(id, inCommands) {
    const node = { id, attributes: {}, textContent: '',
      setAttribute(name, value) { this.attributes[name] = value; },
      closest() { return inCommands ? node : null; },
      focus() { f.doc.activeElement = node; f.listeners.get('focusin')?.({ target: node }); },
    };
    nodes.set(id, node); return node;
  }
  const tab = makeNode('studio-tab-edit', true), canvas = makeNode('preview-canvas', false);
  const reveal = makeNode('studio-expanded-reveal', true), pin = makeNode('studio-expanded-pin', true);
  makeNode('studio-preview-expand', false);
  f.doc.getElementById = id => nodes.get(id) || getOriginal(id);
  f.doc.querySelector = () => tab;
  return { ...f, nodes, tab, canvas, reveal, pin };
}

test('最大化の上端hoverでリボンを表示し、コマンドへ移動した後も操作できる', async () => {
  const f = ribbonFixture();
  const c = createPreviewViewportController({ document: f.doc }); await c.enter();
  assert.equal(c.ribbonVisible, false);
  f.listeners.get('pointermove')({ target: f.canvas, clientY: 8, pointerType: 'mouse', buttons: 0 });
  assert.equal(c.ribbonVisible, true); assert.equal(f.reveal.attributes['aria-expanded'], 'true');
  f.listeners.get('pointermove')({ target: f.tab, clientY: 130, pointerType: 'mouse', buttons: 0 });
  assert.equal(c.ribbonVisible, true);
  f.listeners.get('pointermove')({ target: f.canvas, clientY: 500, pointerType: 'mouse', buttons: 0 });
  assert.equal(c.ribbonVisible, false); c.dispose();
});

test('リボンへフォーカスがある間はマウスが外へ移っても閉じない', async () => {
  const f = ribbonFixture(); const c = createPreviewViewportController({ document: f.doc }); await c.enter();
  c.showRibbon({ focus: true }); assert.equal(f.doc.activeElement, f.tab);
  f.listeners.get('pointermove')({ target: f.canvas, clientY: 500, pointerType: 'mouse', buttons: 0 });
  assert.equal(c.ribbonVisible, true);
  f.canvas.focus(); assert.equal(c.ribbonVisible, false); c.dispose();
});

test('タッチはhoverを発生させず明示表示と外側tapで開閉する', async () => {
  const f = ribbonFixture(); const c = createPreviewViewportController({ document: f.doc }); await c.enter();
  f.listeners.get('pointermove')({ target: f.canvas, clientY: 1, pointerType: 'touch', buttons: 0 });
  assert.equal(c.ribbonVisible, false);
  c.showRibbon({ focus: true }); assert.equal(c.ribbonVisible, true);
  f.listeners.get('pointerdown')({ target: f.canvas, pointerType: 'touch' });
  assert.equal(c.ribbonVisible, false); c.dispose();
});

test('固定中は外側操作で閉じず、固定解除・次回最大化・DOM再生成も同期する', async () => {
  const f = ribbonFixture(), resizes = [];
  const c = createPreviewViewportController({ document: f.doc, onResize: value => resizes.push(value) }); await c.enter();
  c.setRibbonPinned(true); assert.equal(c.ribbonVisible, true); assert.equal(f.pin.attributes['aria-pressed'], 'true');
  assert.ok(f.classes.has('preview-ribbon-pinned'));
  f.listeners.get('pointerdown')({ target: f.canvas }); c.hideRibbon(); assert.equal(c.ribbonVisible, true);
  assert.equal(resizes.length, 2);
  await c.exit(); assert.equal(f.classes.has('preview-ribbon-visible'), false);
  await c.enter(); assert.equal(c.ribbonVisible, true);
  f.reveal.attributes = {}; f.pin.attributes = {}; c.sync();
  assert.equal(f.reveal.attributes['aria-expanded'], 'true'); assert.equal(f.pin.attributes['aria-pressed'], 'true');
  c.setRibbonPinned(false); assert.equal(f.pin.attributes['aria-pressed'], 'false'); c.dispose();
});

test('F6はコマンドとcanvasを交互にフォーカスし、修飾キー・IMEは奪わない', async () => {
  const f = ribbonFixture(); const c = createPreviewViewportController({ document: f.doc }); await c.enter();
  let prevented = 0;
  const event = extra => ({ key: 'F6', preventDefault() { prevented++; }, stopPropagation() {}, ...extra });
  f.listeners.get('keydown')(event({ ctrlKey: true })); f.listeners.get('keydown')(event({ isComposing: true }));
  assert.equal(prevented, 0);
  f.listeners.get('keydown')(event()); assert.equal(f.doc.activeElement, f.tab); assert.equal(c.ribbonVisible, true);
  f.listeners.get('keydown')(event()); assert.equal(f.doc.activeElement, f.canvas); assert.equal(c.ribbonVisible, false);
  c.setRibbonPinned(true); f.listeners.get('keydown')(event()); f.listeners.get('keydown')(event());
  assert.equal(f.doc.activeElement, f.canvas); assert.equal(c.ribbonVisible, true); c.dispose();
});

test('ドラッグ中に上端へ入ってもリボンで操作中のキャンバスを遮らない', async () => {
  const f = ribbonFixture(); const c = createPreviewViewportController({ document: f.doc }); await c.enter();
  f.listeners.get('pointermove')({ target: f.canvas, clientY: 5, pointerType: 'mouse', buttons: 1 });
  assert.equal(c.ribbonVisible, false);
  await c.exit(); c.showRibbon(); assert.equal(c.ribbonVisible, false); c.dispose();
});

test('閉じる操作がcanvasフォーカスを復元し全画面自体は維持される', async () => {
  const f = ribbonFixture(); const c = createPreviewViewportController({ document: f.doc }); await c.enter();
  c.showRibbon({ focus: true }); c.hideRibbon({ focusCanvas: true });
  assert.equal(c.active, true); assert.equal(c.ribbonVisible, false); assert.equal(f.doc.activeElement, f.canvas);
  c.dispose(); assert.equal(f.listeners.size, 0);
});
