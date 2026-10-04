import test from 'node:test';
import assert from 'node:assert/strict';
import { createPackExportSettings } from '../../editor-core/src/ui/pack-export-settings.js';
import pngjs from '../vendor/pngjs/lib/png.js';

const png = () => new File([pngjs.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([20, 40, 80, 255]) })], 'icon.png', { type: 'image/png' });
function heldFile() {
  const file = png(); let complete, fail;
  const original = file.arrayBuffer.bind(file);
  const wait = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  file.arrayBuffer = () => wait;
  return { file, fail, complete: async () => complete(await original()) };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('アイコン無応答は有限期限でloadingを解除し、前の有効設定を維持する', { timeout: 2000 }, async t => {
  const settings = createPackExportSettings({ iconReadTimeoutMs: 20 }); t.after(() => settings.clearIcon());
  await settings.selectIcon(png()); const before = settings.options(), url = settings.state.iconUrl;
  const held = heldFile();
  await assert.rejects(settings.selectIcon(held.file), { name: 'TimeoutError', code: 'EXPORT_ICON_READ_TIMEOUT' });
  assert.equal(settings.state.loading, false); assert.equal(settings.state.iconUrl, url);
  assert.deepEqual(settings.options(), before); assert.match(settings.state.iconError, /時間内/u);
  await held.complete(); await pause(0); assert.deepEqual(settings.options(), before);
});

test('アイコンの選び直し/clearは未完了の旧readをすぐ終え、遅い失敗を通知しない', { timeout: 2000 }, async t => {
  const settings = createPackExportSettings(); t.after(() => settings.clearIcon());
  const first = heldFile(), reading = settings.selectIcon(first.file); await pause(0);
  await settings.selectIcon(png()); assert.equal(await reading, false);
  first.fail(new Error('late superseded error')); await pause(0); assert.equal(settings.state.iconError, '');
  const second = heldFile(), cleared = settings.selectIcon(second.file); await pause(0);
  settings.clearIcon(); assert.equal(await cleared, false);
  second.fail(new Error('late cleared error')); await pause(0);
  assert.equal(settings.state.iconError, ''); assert.equal(settings.state.loading, false); assert.equal(settings.state.iconUrl, '');
});

test('実アイコン選択イベントのtimeoutでも入力リセットとUI更新が完了する', { timeout: 2000 }, async t => {
  const settings = createPackExportSettings({ iconReadTimeoutMs: 20 }); t.after(() => settings.clearIcon());
  const nodes = [], updates = [], errors = [], held = heldFile();
  const h = (tag, attrs, children = []) => { const node = { tag, attrs, children }; nodes.push(node); return node; };
  settings.render(h, { onChange: changed => updates.push([changed, settings.state.loading]), onError: error => errors.push(error.code) });
  const input = { files: [held.file], value: 'slow' };
  await nodes.find(node => node.attrs.id === 'pack-export-icon-file').attrs.onChange({ currentTarget: input });
  assert.equal(input.value, ''); assert.deepEqual(updates, [[false, true], [true, false]]);
  assert.deepEqual(errors, ['EXPORT_ICON_READ_TIMEOUT']); assert.doesNotThrow(() => settings.options());
  held.fail(new Error('late failed read')); await pause(0);
});

test('アイコンread成功後は期限が状態を書き換えず、同じ画像を再選択できる', { timeout: 2000 }, async t => {
  const settings = createPackExportSettings({ iconReadTimeoutMs: 10 }); t.after(() => settings.clearIcon());
  const file = png(); await settings.selectIcon(file); await pause(20);
  assert.equal(settings.state.iconError, ''); assert.equal(settings.state.loading, false);
  assert.equal(await settings.selectIcon(file), true); assert.equal(settings.state.iconError, '');
});
