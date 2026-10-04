import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function startTreeReorderDrag(');
const end = source.indexOf('\nfunction ', start + 1);
const body = source.slice(start, end);
function harness() {
  const listeners = new Map(), commits = [], indicator = { style: {}, remove() {} };
  const context = vm.createContext({
    closeTreeContextMenu() {}, canEditTreeForFile: () => true,
    store: { getState: () => ({ files: { byId: { file: { nodesById: { p: { children: ['a','b','c'] } } } } } }) },
    treeUiState: { drag: {} },
    document: { createElement: () => indicator, body: { appendChild() {} }, elementFromPoint: () => ({ closest: () => ({
      getAttribute: name => name === 'data-tree-node-id' ? 'b' : 'p',
      getBoundingClientRect: () => ({ top: 0, height: 100, bottom: 100, left: 0, width: 100 }),
    }) }) },
    window: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) },
    applyTreeReorder: (...args) => commits.push(args),
    diagnostics: { captureError: error => { throw error; } },
  });
  vm.runInContext(body, context);
  context.startTreeReorderDrag({ button: 0, pointerId: 1, preventDefault() {}, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} } },
    { fileId: 'file', nodeId: 'a', parentId: 'p', fromIndex: 0 });
  listeners.get('pointermove')({ clientX: 20, clientY: 80 });
  return { listeners, commits, context };
}
test('tree pointercancelはドラッグ表示を片付けて元の子順序を保持する', () => {
  const h = harness(); h.listeners.get('pointercancel')({ type: 'pointercancel', pointerId: 1 });
  assert.equal(h.commits.length, 0); assert.equal(h.context.treeUiState.drag.active, false); assert.equal(h.listeners.size, 0);
});
test('tree pointerupは選択した同親内の挿入位置を一度だけ確定する', () => {
  const h = harness(); h.listeners.get('pointerup')({ type: 'pointerup', pointerId: 1 });
  assert.equal(h.commits.length, 1); assert.deepEqual(h.commits[0], ['file','p','a',1]); assert.equal(h.listeners.size, 0);
});
