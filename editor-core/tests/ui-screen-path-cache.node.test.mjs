import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiScreenPathCache } from '../src/preview/ui-screen-path-cache.js';

test('画面pathのJSON/JSONC・大文字・重複・underscore/pocket判定を維持する', () => {
  const cache = createUiScreenPathCache();
  const imported = ['ui/z.json', 'ui/a.jsonc', 'UI/Upper.JSONC', 'ui/nested/view.json',
    'ui/_ui_defs.json', 'ui/nested/_hidden.json', '_ui/menu.json', 'ui/pocket_screen.json',
    'ui/POCKET/book.json', 'ui/pocketbook.json', 'ui/a.json.bak', 'ui/a.jsoncc',
    'ui\\wrong.json', 'ui/.json', '/ui/absolute.json', 'textures/ui/a.json', null, 0, false, ''];
  const reference = ['ui/a.jsonc', 'ui/A.jsonc', 'ui/z.json', 'ui/nested/next.json', 'ui/a.json '];
  const before = [...imported];
  assert.deepEqual(cache.get(imported, reference), [
    'UI/Upper.JSONC', 'ui/A.jsonc', 'ui/a.jsonc', 'ui/nested/next.json', 'ui/nested/view.json', 'ui/z.json',
  ]);
  assert.deepEqual(imported, before);
});

test('warm読込は同じreadonly結果を返し入力要素を一つも再読取しない', () => {
  let indexedReads = 0;
  const observe = list => new Proxy(list, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/u.test(key)) indexedReads++;
    return Reflect.get(target, key, receiver);
  } });
  const a = observe(['textures/a.png', 'ui/a.json']), b = observe(['ui/b.json']);
  const cache = createUiScreenPathCache(), first = cache.get(a, b, 3);
  assert.equal(indexedReads, 3);
  for (let index = 0; index < 1000; index++) assert.equal(cache.get(a, b, 3), first);
  assert.equal(indexedReads, 3);
  assert.equal(cache.snapshot().scannedPaths, 3);
  assert.equal(cache.snapshot().hits, 1000);
  assert.ok(Object.isFrozen(first));
  assert.throws(() => first.push('ui/corrupt.json'), TypeError);
});

test('同じ長さでも配列を置換すると旧pathを残さず再取得する', () => {
  const cache = createUiScreenPathCache(), reference = ['ui/shared.json'];
  const before = cache.get(['ui/old.json'], reference);
  const after = cache.get(['ui/new.json'], reference);
  assert.notEqual(after, before);
  assert.deepEqual(after, ['ui/new.json', 'ui/shared.json']);
  assert.deepEqual(cache.get(['ui/new.json'], ['ui/reference-new.json']), ['ui/new.json', 'ui/reference-new.json']);
});

test('push/popによる長さの変化はepochが同じでも失効する', () => {
  const cache = createUiScreenPathCache(), imported = ['ui/a.json'], reference = ['ui/b.json'];
  cache.get(imported, reference);
  imported.push('ui/c.json');
  assert.deepEqual(cache.get(imported, reference), ['ui/a.json', 'ui/b.json', 'ui/c.json']);
  reference.pop();
  assert.deepEqual(cache.get(imported, reference), ['ui/a.json', 'ui/c.json']);
  assert.equal(cache.snapshot().misses, 3);
});

test('in-place同長置換はexplicit epochの更新で両sourceを再検査する', () => {
  const cache = createUiScreenPathCache(), imported = ['ui/a.json'], reference = ['ui/b.json'];
  const before = cache.get(imported, reference, 10);
  imported[0] = 'ui/pocket.json';
  reference[0] = 'ui/c.jsonc';
  const after = cache.get(imported, reference, 11);
  assert.deepEqual(before, ['ui/a.json', 'ui/b.json']);
  assert.deepEqual(after, ['ui/c.jsonc']);
  assert.notEqual(after, before);
});

test('pack解除とclearは最新構成だけを残し旧入力参照を保持しない', () => {
  const cache = createUiScreenPathCache(), imported = ['ui/a.json'], reference = ['ui/b.json'];
  cache.get(imported, reference);
  assert.equal(cache.snapshot().retainedArrays, 2);
  assert.deepEqual(cache.get(null, reference), ['ui/b.json']);
  assert.equal(cache.snapshot().retainedArrays, 1);
  cache.clear();
  assert.equal(cache.snapshot().retainedArrays, 0);
  assert.equal(cache.snapshot().cachedPaths, 0);
  reference[0] = 'ui/after-clear.json';
  assert.deepEqual(cache.get(undefined, reference), ['ui/after-clear.json']);
  const empty = cache.get();
  assert.deepEqual(empty, []);
  assert.equal(cache.get(null, undefined), empty);
});

test('入力の変換失敗は旧cacheを破損させず、修正後に再実行できる', () => {
  const cache = createUiScreenPathCache(), good = ['ui/ok.json'];
  const before = cache.get(good);
  const bad = [{ toString() { throw new Error('invalid path fixture'); } }];
  assert.throws(() => cache.get(bad), /invalid path fixture/u);
  assert.equal(cache.get(good), before);
  bad[0] = 'ui/recovered.json';
  assert.deepEqual(cache.get(bad), ['ui/recovered.json']);
});
