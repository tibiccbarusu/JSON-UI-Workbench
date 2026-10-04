import test from 'node:test';
import assert from 'node:assert/strict';
import { selectUiDefinition } from '../src/engine/ui-catalog.js';
import { normalizeScreenRef, resolveScreenRef, sameScreenRef, readNavigationMappings, setNavigationMapping, resolveNavigationMapping, updateNavigationHistory, normalizeNavigationEntry } from '../src/preview/screen-navigation.js';
import { createInitialState, appReducer, actions } from '../src/state-store/app-store.js';

const ref = (qualifiedName, packPath = 'ui/multi.json') => ({ packPath, qualifiedName, presentation:'screen' });
const record = (id, localName, extra = {}) => ({ id, rawKey:localName, localName, qualifiedName:`multi.${localName}`, filePath:'ui/multi.json', sourceKind:'imported', profile:'classic', ...extra });
test('qualifiedName と全legacy aliasを同じ候補集合で一意解決する', () => {
  const first = record('r1', 'first'), second = record('r2', 'second');
  for (const alias of ['r2', 'second', 'multi.second']) assert.equal(selectUiDefinition([first, second], alias), second);
  assert.throws(() => selectUiDefinition([first, record('r2', 'r1')], 'r1'), /AMBIGUOUS/u);
  assert.throws(() => selectUiDefinition([first, record('r2', 'first')], 'multi.first'), /AMBIGUOUS/u);
});
test('旧file-only設定は単一定義だけ解決し、複数は選択要求へ', () => {
  const first = record('r1', 'first'), second = record('r2', 'second');
  assert.equal(resolveScreenRef('screen:ui/multi.json', [first]).qualifiedName, 'multi.first');
  assert.throws(() => resolveScreenRef('screen:ui/multi.json', [first, second]), /DEFINITION_REQUIRED/u);
  assert.equal(resolveScreenRef(ref('multi.second'), [first, second], 17).catalogGeneration, 17);
});
test('unsafe path・未知presentation・Pocket・pathの不一致を拒否する', () => {
  for (const path of ['../ui/a.json', '/ui/a.json', 'https://evil/a.json', 'C:/ui/a.json', 'ui/_ui_defs.json']) assert.throws(() => normalizeScreenRef(path));
  assert.throws(() => normalizeScreenRef({ ...ref('multi.first'), presentation:'script' }));
  assert.throws(() => normalizeScreenRef({ ...ref('multi.first'), presentation:'topic' }));
  assert.throws(() => resolveScreenRef(ref('multi.first'), [record('r1', 'first', { profile:'pocket' })]), /POCKET/u);
  assert.throws(() => resolveScreenRef(ref('multi.first'), [record('r1', 'first', { filePath:'ui/moved.json' })]), /PATH_MISMATCH/u);
});
test('画面単位→新global→旧globalの優先順位を維持し原設定を破壊しない', () => {
  const legacy = { 'button.open':'screen:ui/legacy.json' };
  const a = ref('multi.first'), b = ref('multi.second');
  let map = setNavigationMapping(legacy, { actionId:'button.open', source:null, target:ref('global.target', 'ui/global.json') });
  map = setNavigationMapping(map, { actionId:'button.open', source:a, target:ref('a.target', 'ui/a.json') });
  map = setNavigationMapping(map, { actionId:'button.open', source:b, target:ref('b.target', 'ui/b.json') });
  assert.equal(resolveNavigationMapping(map, a, 'button.open').definition, 'a.target');
  assert.equal(resolveNavigationMapping(map, b, 'button.open').definition, 'b.target');
  assert.equal(resolveNavigationMapping(map, ref('multi.third'), 'button.open').definition, 'global.target');
  assert.deepEqual(readNavigationMappings(map).legacy, legacy);
  assert.deepEqual(legacy, { 'button.open':'screen:ui/legacy.json' });
  assert.equal(resolveNavigationMapping(legacy, a, 'button.open').legacy, true);
  assert.equal(resolveNavigationMapping({}, a, 'toString'), null);
});
test('同一pathの別定義を履歴で区別し、重複clickは増やさず100件に制限', () => {
  let nav = updateNavigationHistory({}, ref('multi.first'), 'reset');
  nav = updateNavigationHistory(nav, ref('multi.second'));
  nav = updateNavigationHistory(nav, ref('multi.second'));
  assert.equal(nav.stack.length, 2); assert(!sameScreenRef(nav.stack[0], nav.stack[1]));
  nav = updateNavigationHistory(nav, ref('multi.first'), 'setIndex', 0);
  assert.equal(nav.stack.length, 2); assert.equal(nav.index, 0);
  for (let index = 0; index < 120; index++) nav = updateNavigationHistory(nav, ref(`multi.ui_${index}`));
  assert.equal(nav.stack.length, 100); assert.equal(nav.index, 99);
});
test('履歴の局所状態はscrollだけに限定し、大容量や実行モデルを保持しない', () => {
  const entry = normalizeNavigationEntry({ ...ref('multi.first'), uiModel:{ huge:true }, view:{ scrollById:{ good:{ x:0, y:10 }, invalid:Infinity }, raw:'do not keep' } });
  assert.deepEqual(entry.view, { scrollById:{ good:{ x:0, y:10 } } }); assert.equal(entry.uiModel, undefined);
  const huge = Object.fromEntries(Array.from({ length:1000 }, (_, index) => ['x'.repeat(100) + index, { x:0, y:index }]));
  assert.equal(normalizeNavigationEntry({ ...entry, view:{ scrollById:huge } }).view, undefined);
});
test('navigation commitはファイルと定義履歴を同じreducer更新へまとめる', () => {
  let state = createInitialState();
  const file = { id:'screen:ui/multi.json', path:'ui/multi.json', kind:'screen' };
  state = appReducer(state, actions.navCommit({ file, screenRef:ref('multi.second'), origin:ref('multi.first'), mode:'push' }));
  assert.equal(state.files.currentFileId, file.id); assert.equal(state.files.byId[file.id], file);
  assert.equal(state.preview.navigation.stack[1].qualifiedName, 'multi.second');
  const before = state;
  state = appReducer(state, actions.navCommit({ file:{ ...file, id:'other' }, screenRef:ref('multi.first'), mode:'setIndex', index:20 }));
  assert.equal(state, before);
});
