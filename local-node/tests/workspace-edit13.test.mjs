import test from 'node:test';
import assert from 'node:assert/strict';
import { editWorkspace, inspectWorkspace, workspaceRevision } from '../workspace-edit.mjs';
import { parseEditableJsonc, pointerJoin } from '../workspace-jsonc.mjs';

const source = '\uFEFF{\r\n  // 原文コメントを維持\r\n  "namespace": "demo",\r\n  "base": { "type": "panel", "size": [100, 80] },\r\n  "screen": {\r\n    "type": "screen",\r\n    "controls": [\r\n      { "label@demo.base": { "text": "変更前", "offset": [1, 2] } },\r\n      { "other": { "type": "label", "text": "そのまま" } },\r\n    ]\r\n  }\r\n}\r\n';
const documents = () => ({ 'ui/demo.json': source });
const parsed = text => parseEditableJsonc(text).value;
const edit = (operation, docs = documents()) => editWorkspace({ documents: docs, operation: { path: 'ui/demo.json', ...operation } });

test('inspect: 原文 Pointer と複数定義・子要素の親を列挙する', () => {
  const result = inspectWorkspace({ documents: documents() });
  assert.equal(result.ok, true);
  assert.equal(result.nodes.length, 4);
  assert.equal(result.nodes.find(node => node.localName === 'label').parentPointer, '/screen');
  assert.equal(result.nodes.find(node => node.localName === 'label').pointer, '/screen/controls/0/label@demo.base');
  assert.equal(result.previewAllowed, true);
});

test('set: 選択した文字列だけを置換してコメント・BOM・CRLF・継承を保つ', () => {
  const input = Object.freeze(documents());
  const result = edit({ type: 'set', pointer: '/screen/controls/0/label@demo.base/text', value: '変更後' }, input);
  assert.equal(result.ok, true);
  assert.equal(result.documents['ui/demo.json'], source.replace('変更前', '変更後'));
  assert.equal(input['ui/demo.json'], source);
  assert.equal(result.changes[0].before, source);
  assert.equal(result.beforeRevision, workspaceRevision(input));
});

test('set: 欠落プロパティを追加でき、既存プロパティを保持する', () => {
  const result = edit({ type: 'set', pointer: '/base/texture', value: 'textures/ui/custom' });
  assert.equal(result.ok, true);
  assert.equal(parsed(result.documents['ui/demo.json']).base.texture, 'textures/ui/custom');
  assert.deepEqual([...parsed(result.documents['ui/demo.json']).base.size], [100, 80]);
  assert.match(result.documents['ui/demo.json'], /原文コメントを維持/u);
});

test('move: 子要素の offset を更新し継承元を展開しない', () => {
  const result = edit({ type: 'move', pointer: '/screen/controls/0/label@demo.base', offset: [70.5, -12] });
  assert.equal(result.ok, true);
  const label = parsed(result.documents['ui/demo.json']).screen.controls[0]['label@demo.base'];
  assert.deepEqual([...label.offset], [70.5, -12]);
  assert.equal(label.size, undefined);
  assert.equal(label.type, undefined);
});

test('move: NaN、無限大、過大座標を拒否する', () => {
  for (const offset of [[NaN, 2], [Infinity, 3], [1, 2, 3], [1000001, 0]]) {
    const result = edit({ type: 'move', pointer: '/base', offset });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'EDIT_OFFSET_INVALID');
    assert.equal(result.documents, undefined);
  }
});

test('add: 指定位置への配置と前後要素の保持', () => {
  const result = edit({ type: 'add', parentPointer: '/screen', name: 'new_item', value: { type: 'image', offset: [40, 50], texture: 'textures/ui/a' }, index: 1 });
  assert.equal(result.ok, true);
  const controls = parsed(result.documents['ui/demo.json']).screen.controls;
  assert.deepEqual(controls.map(item => Object.keys(item)[0]), ['label@demo.base', 'new_item', 'other']);
  assert.deepEqual([...controls[1].new_item.offset], [40, 50]);
});

test('add: controls を持たない要素に新規 controls を追加する', () => {
  const result = edit({ type: 'add', parentPointer: '/base', name: 'inside', value: { type: 'label', text: 'a' } });
  assert.equal(result.ok, true);
  assert.equal(parsed(result.documents['ui/demo.json']).base.controls[0].inside.text, 'a');
});

test('add: 新規トップレベル定義を追加する', () => {
  const result = edit({ type: 'add', parentPointer: '', name: 'second_screen', value: { type: 'screen' } });
  assert.equal(result.ok, true);
  assert.equal(parsed(result.documents['ui/demo.json']).second_screen.type, 'screen');
});

test('add: 重複要素名・動的 controls の上書きを拒否する', () => {
  assert.equal(edit({ type: 'add', parentPointer: '/screen', name: 'other', value: {} }).code, 'EDIT_NAME_CONFLICT');
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{"controls":"$controls"}}' };
  assert.equal(edit({ type: 'add', parentPointer: '/a', name: 'new', value: {} }, docs).code, 'EDIT_DYNAMIC_CONTROLS');
});

test('inherit: 原キーだけ変更しコメントと既存プロパティを維持する', () => {
  const result = edit({ type: 'inherit', pointer: '/screen/controls/1/other', baseRef: 'demo.base' });
  assert.equal(result.ok, true);
  assert.equal(result.documents['ui/demo.json'], source.replace('"other":', '"other@demo.base":'));
  const undo = edit({ type: 'replaceText', text: result.changes[0].before }, result.documents);
  assert.equal(undo.ok, true);
  assert.equal(undo.documents['ui/demo.json'], source);
  const redo = edit({ type: 'replaceText', text: result.changes[0].after }, undo.documents);
  assert.equal(redo.documents['ui/demo.json'], result.documents['ui/demo.json']);
});

test('inherit: 継承解除と不正な継承形式の拒否', () => {
  const result = edit({ type: 'inherit', pointer: '/screen/controls/0/label@demo.base', baseRef: null });
  assert.equal(result.ok, true);
  assert.equal(result.documents['ui/demo.json'], source.replace('label@demo.base', 'label'));
  assert.equal(edit({ type: 'inherit', pointer: '/base', baseRef: 'foo@bar' }).ok, false);
});

test('replaceText: 構文エラー・重複キー・不正 UI 構造を拒否してプレビュー禁止', () => {
  for (const text of ['{"namespace":', '{"namespace":"a","a":{},"a":{}}', '{"a":{"controls":42}}', '{"a":{"controls":[{"x":{},"y":{}}]}}', '{"a":{"size":[2]}}', '[]']) {
    const result = edit({ type: 'replaceText', text });
    assert.equal(result.ok, false, text);
    assert.equal(result.previewAllowed, false);
    assert.equal(result.documents, undefined);
  }
});

test('replaceText: 旧草稿が構文不正でも有効な原文へ修復できる', () => {
  const result = edit({ type: 'replaceText', text: source }, { 'ui/demo.json': '{broken' });
  assert.equal(result.ok, true);
  assert.equal(result.documents['ui/demo.json'], source);
});

test('循環: 直接継承と子要素展開経由の循環を確実に拒否する', () => {
  for (const text of ['{"namespace":"x","a@x.b":{},"b@x.a":{}}', '{"namespace":"x","a":{"controls":[{"child@x.a":{}}]}}']) {
    const result = edit({ type: 'replaceText', text });
    assert.equal(result.code, 'EDIT_INHERITANCE_CYCLE');
    assert.equal(result.previewAllowed, false);
  }
});

test('循環: 共通継承元を持つ DAG を循環と誤認しない', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{},"b@x.a":{},"c@x.a":{},"screen":{"controls":[{"b@x.b":{}},{"c@x.c":{}}]}}' };
  assert.equal(inspectWorkspace({ documents: docs }).previewAllowed, true);
});

test('基準パックの未解決参照は警告にし軽微な set を妨げない', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a@missing.base":{"text":"old"}}' };
  const result = edit({ type: 'set', pointer: '/a@missing.base/text', value: 'new' }, docs);
  assert.equal(result.ok, true);
  assert.ok(result.diagnostics.some(item => item.code === 'EDIT_REFERENCE_MISSING'));
});

test('planDelete: 読取のみで複数ファイルの継承推移閉包を返す', () => {
  const docs = documents();
  docs['ui/second.json'] = '{"namespace":"second","derived@demo.base":{},"last@second.derived":{"controls":[{"child":{"type":"label"}}]},"keep":{}}';
  const result = edit({ type: 'planDelete', pointer: '/base' }, docs);
  assert.equal(result.ok, true);
  assert.equal(result.deletePlan.count, 5);
  assert.equal(result.deletePlan.fileCount, 2);
  assert.equal(result.changes.length, 0);
  assert.equal(result.revision, workspaceRevision(docs));
});

test('delete: 複数ファイルの継承・子孫を削除し選択外の要素を保持する', () => {
  const docs = documents();
  docs['ui/second.json'] = '{"namespace":"second","derived@demo.base":{},"last@second.derived":{"controls":[{"child":{"type":"label"}}]},"keep":{}}';
  const snapshot = JSON.stringify(docs);
  const result = edit({ type: 'delete', pointer: '/base', cascade: true }, docs);
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(Object.keys(parsed(result.documents['ui/demo.json'])), ['namespace', 'screen']);
  assert.deepEqual(Object.keys(parsed(result.documents['ui/second.json'])), ['namespace', 'keep']);
  assert.deepEqual(parsed(result.documents['ui/demo.json']).screen.controls.map(item => Object.keys(item)[0]), ['other']);
  assert.equal(JSON.stringify(docs), snapshot);
});

test('delete: 元配列の多数の参照を番号ずれなしで削除する', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{},"screen":{"controls":[{"first@x.a":{}},{"keep":{}},{"second@x.a":{}},{"third@x.a":{}}]}}' };
  const result = edit({ type: 'delete', pointer: '/a', cascade: true }, docs);
  assert.equal(result.ok, true);
  assert.deepEqual(parsed(result.documents['ui/demo.json']).screen.controls.map(item => Object.keys(item)[0]), ['keep']);
});

test('delete: 要素の子孫削除と cascade 必須の失敗が原本を保持する', () => {
  assert.equal(edit({ type: 'delete', pointer: '/screen' }).code, 'EDIT_CASCADE_REQUIRED');
  const result = edit({ type: 'delete', pointer: '/screen', cascade: true });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(parsed(result.documents['ui/demo.json'])), ['namespace', 'base']);
});

test('delete: 確定不能な動的参照があれば安全に停止する', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{},"b@$unknown":{}}' };
  const result = edit({ type: 'delete', pointer: '/a', cascade: true }, docs);
  assert.equal(result.code, 'EDIT_DELETE_IMPACT_UNKNOWN');
  assert.equal(result.documents, undefined);
});

test('delete: 静的な $variable の継承参照を追跡する', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{},"b@$ref":{"$ref":"x.a"},"keep":{}}' };
  const result = edit({ type: 'delete', pointer: '/a', cascade: true }, docs);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(parsed(result.documents['ui/demo.json'])), ['namespace', 'keep']);
});

test('delete: 曖昧な同名定義参照があると削除を拒否する', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{},"b@x.a":{}}', 'ui/other.json': '{"namespace":"x","a":{}}' };
  assert.equal(edit({ type: 'delete', pointer: '/a', cascade: true }, docs).code, 'EDIT_DELETE_IMPACT_UNKNOWN');
});

test('JSON Pointer: スラッシュ・チルダを含む原キーを正確に編集する', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a/b~c":{"type":"label","text":"old"}}' };
  const pointer = pointerJoin(['a/b~c', 'text']);
  const result = edit({ type: 'set', pointer, value: 'new' }, docs);
  assert.equal(result.ok, true);
  assert.equal(parsed(result.documents['ui/demo.json'])['a/b~c'].text, 'new');
  assert.equal(edit({ type: 'set', pointer: '/a~2b', value: 1 }, docs).code, 'EDIT_POINTER_INVALID');
});

test('revision: 順序非依存、変更検出、古い状態からの上書き禁止', () => {
  assert.equal(workspaceRevision({ 'ui/a.json': '{}', 'ui/b.json': '{}' }), workspaceRevision({ 'ui/b.json': '{}', 'ui/a.json': '{}' }));
  const result = editWorkspace({ documents: documents(), expectedRevision: 'stale', operation: { type: 'replaceText', path: 'ui/demo.json', text: source } });
  assert.equal(result.code, 'EDIT_REVISION_CONFLICT');
});

test('安全境界: 絶対パス・相対脱出・大文字小文字衝突を拒否する', () => {
  for (const path of ['../ui/a.json', '/ui/a.json', 'C:/ui/a.json', 'ui/CON.json', 'ui/a .json/../a.json', 'https://host/a.json']) {
    const result = inspectWorkspace({ documents: { [path]: '{}' } });
    assert.equal(result.ok, false, path);
  }
  assert.equal(inspectWorkspace({ documents: { 'ui/A.json': '{}', 'ui/a.json': '{}' } }).code, 'EDIT_PATH_AMBIGUOUS');
});

test('安全境界: JSON で表現できない値と過深入力を拒否する', () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [undefined, Infinity, 1n, () => 1, new Date(), cyclic, Array(2)]) assert.equal(edit({ type: 'set', pointer: '/base/value', value }).ok, false);
  const deep = '{"a":'.repeat(130) + '{}' + '}'.repeat(130);
  assert.equal(edit({ type: 'replaceText', text: deep }).code, 'EDIT_DEPTH_LIMIT');
});

test('構文境界: JSON の解釈を変える不正入力を受理しない', () => {
  for (const text of ['{"a":01}', '{"a":1e}', '{"a":1e999}', '{"a":true false}', '{"a":NaN}', '{"a":undefined}', '{"a":"\\x"}', '{"a":{},,}', '{}junk', '/*closed?']) {
    assert.equal(edit({ type: 'replaceText', text }).ok, false, text);
  }
});

test('公式原文の既存不正寸法は無関係な編集を阻害せず、新しい不正値は拒否する', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{"size":["100%, 100%"],"text":"old"}}' };
  const before = inspectWorkspace({ documents: docs });
  assert.equal(before.ok, true);
  assert.equal(before.previewAllowed, false);
  assert.equal(before.diagnostics[0].code, 'EDIT_UI_PROPERTY_INVALID');
  assert.equal(edit({ type: 'set', pointer: '/a/text', value: 'new' }, docs).ok, true);
  assert.equal(edit({ type: 'set', pointer: '/a/size', value: [1] }, docs).ok, false);
  const repaired = edit({ type: 'set', pointer: '/a/size', value: [100, 100] }, docs);
  assert.equal(repaired.ok, true);
  assert.equal(repaired.previewAllowed, true);
});

test('delete: 条件付き変数を固定値と誤認せず影響不明として止める', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{},"b":{},"caller@$ref":{"$ref":"x.a","variables":[{"requires":"$runtime","$ref":"x.b"}]}}' };
  assert.equal(edit({ type: 'delete', pointer: '/b', cascade: true }, docs).code, 'EDIT_DELETE_IMPACT_UNKNOWN');
});

test('delete: 子要素だけなら無関係な動的グローバル参照で阻害しない', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{"controls":[{"child":{}},{"keep":{}}]},"b@$unknown":{}}' };
  const result = edit({ type: 'delete', pointer: '/a/controls/0/child', cascade: true }, docs);
  assert.equal(result.ok, true);
  assert.deepEqual(parsed(result.documents['ui/demo.json']).a.controls.map(item => Object.keys(item)[0]), ['keep']);
  assert.ok(parsed(result.documents['ui/demo.json'])['b@$unknown']);
});

test('delete: modifications の単一・配列 value 内の継承要素を正しく除去する', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{},"screen":{"modifications":[{"array_name":"controls","operation":"insert_back","value":{"single@x.a":{}}},{"array_name":"controls","operation":"insert_back","value":[{"first@x.a":{}},{"keep":{}},{"last@x.a":{}}]}]}}' };
  const result = edit({ type: 'delete', pointer: '/a', cascade: true }, docs);
  assert.equal(result.ok, true);
  const modifications = parsed(result.documents['ui/demo.json']).screen.modifications;
  assert.equal(modifications.length, 1);
  assert.deepEqual(modifications[0].value.map(item => Object.keys(item)[0]), ['keep']);
});

test('inspect: 特殊 UI 文書を定義と誤認せずグローバル変数を参照する', () => {
  const docs = { 'ui/_ui_defs.json': '{"ui_defs":["ui/demo.json"]}', 'ui/_global_variables.json': '{"$base":"x.a"}', 'ui/demo.json': '{"namespace":"x","a":{},"b@$base":{}}' };
  const result = inspectWorkspace({ documents: docs });
  assert.equal(result.ok, true);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(edit({ type: 'delete', pointer: '/a', cascade: true }, docs).deletePlan.count, 2);
});

test('inspect: 非文字列テンプレートを診断し例外を公開しない', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{"grid_item_template":[{"unexpected":{}}]}}' };
  const result = inspectWorkspace({ documents: docs });
  assert.equal(result.ok, true);
  assert.ok(result.diagnostics.some(item => item.code === 'EDIT_REFERENCE_DYNAMIC'));
});

test('既知プロパティの型: 不正な文字列・真偽値・数値・UV を新規に導入できない', () => {
  for (const [property, value] of [['text', {}], ['texture', []], ['visible', 123], ['alpha', true], ['uv', [1]]]) {
    const result = edit({ type: 'set', pointer: `/base/${property}`, value });
    assert.equal(result.ok, false, property);
    assert.equal(result.code, 'EDIT_UI_STRUCTURE');
    assert.equal(result.previewAllowed, false);
  }
  assert.equal(edit({ type: 'set', pointer: '/base/visible', value: '(not $hidden)' }).ok, true);
});

test('既存不正値の配列位置が変わっても無関係な追加を妨げない', () => {
  const docs = { 'ui/demo.json': '{"namespace":"x","a":{"controls":[{"old":{"size":[]}}]}}' };
  const result = edit({ type: 'add', parentPointer: '/a', name: 'new', value: { type: 'label', text: 'n' }, index: 0 }, docs);
  assert.equal(result.ok, true);
  assert.equal(result.previewAllowed, false);
  const duplicate = edit({ type: 'add', parentPointer: '/a', name: 'new', value: { size: [] }, index: 0 }, docs);
  assert.equal(duplicate.ok, false);
});

test('add: メタデータ名を UI の新規追加と誤認しない', () => {
  assert.equal(edit({ type: 'add', parentPointer: '', name: '$variable', value: {} }).code, 'EDIT_ADD_INVALID');
});
