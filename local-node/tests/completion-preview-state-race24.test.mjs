import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPreviewStateControls } from '../../editor-core/src/ui/preview-workspace.js';
function draft(state = { text: '{}' }) {
  const elements = [], errors = [], applies = [];
  const h = (tag, attrs = {}, children = []) => { const node = { tag, attrs, children }; elements.push(node); return node; };
  renderPreviewStateControls(h, { state, presets: [], onApply: value => applies.push(value), onPreset: value => { state.text = JSON.stringify({ preset: value }); }, onDownload() {}, onCurrent: () => { state.text = '{"current":true}'; }, onError: error => errors.push(error) });
  return { state, errors, applies, input: elements.find(e => e.tag === 'input'), textarea: elements.find(e => e.tag === 'textarea'), select: elements.find(e => e.tag === 'select'), button: text => elements.find(e => e.tag === 'button' && e.children.includes(text)) };
}
function pending(view) {
  let resolve, reject;
  const read = new Promise((yes, no) => { resolve = yes; reject = no; });
  const input = { value: 'state.json', files: [{ size: 32, text: () => read }] };
  return { done: view.input.attrs.onChange({ currentTarget: input }), resolve, reject, input };
}
test('遅い状態ファイルは後で入力した未適用JSONを上書きしない', async () => {
  const view = draft(), load = pending(view);
  assert.equal(load.input.value, '');
  view.textarea.attrs.onInput({ currentTarget: { value: '{"typed":true}' } });
  load.resolve('{"old":true}'); await load.done;
  assert.equal(view.state.text, '{"typed":true}'); assert.equal(view.applies.length, 0);
});
test('連続読込は最新選択が所有し、古い成功も失敗も最新メッセージを変えない', async () => {
  const view = draft(), old = pending(view), newest = pending(view);
  newest.resolve('{"new":true}'); await newest.done;
  const message = view.state.message;
  old.reject(new Error('obsolete read')); await old.done;
  assert.equal(view.state.text, '{"new":true}'); assert.equal(view.state.message, message); assert.deepEqual(view.errors, []);
});
test('DOM再生成後は同じ草稿オブジェクトでも旧読込を破棄する', async () => {
  const first = draft(), load = pending(first), next = draft(first.state);
  next.textarea.attrs.onInput({ currentTarget: { value: '{"rebuilt":true}' } });
  load.resolve('{"old":true}'); await load.done;
  assert.equal(first.state.text, '{"rebuilt":true}');
});
test('例・現在値・適用操作はいずれも保留読込を失効させる', async () => {
  for (const operation of ['preset', 'current', 'apply', 'shortcut']) {
    const view = draft(), load = pending(view);
    if (operation === 'preset') view.select.attrs.onChange({ currentTarget: { value: 'furnace' } });
    if (operation === 'current') view.button('適用中の値を取得').attrs.onClick();
    if (operation === 'apply') view.button('状態を適用').attrs.onClick();
    if (operation === 'shortcut') view.textarea.attrs.onKeydown({ ctrlKey: true, key: 'Enter', preventDefault() {} });
    const expected = view.state.text;
    load.resolve('{"old":true}'); await load.done;
    assert.equal(view.state.text, expected, operation);
  }
});
test('最新の不正JSONはエラーを報告し、既存草稿を保持する', async () => {
  const view = draft(), load = pending(view);
  load.resolve('{bad'); await load.done;
  assert.equal(view.state.text, '{}'); assert.equal(view.errors.length, 1); assert.match(view.state.message, /読込できません/);
});
