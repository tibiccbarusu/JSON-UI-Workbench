import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { safeEvalExpression } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

async function project(definition, variables = {}) {
  const catalog = await buildUiCatalog({ parseJsonc, sources: [{ id: 'pack', kind: 'imported', precedence: 1,
    filePaths: ['ui/a.json'], readText: async () => JSON.stringify({ namespace: 'x', screen: definition }) }] });
  const projection = resolveEffectiveUi({ catalog, recordId: catalog.records[0].id, variables });
  assert.equal(projection.ok, true);
  return { projection, root: projection.document.screen, catalog };
}

test('公式how_to_playと同形のtext式から翻訳キーを作り、元JSONを変更しない', async () => {
  const expression = "('howtoplay.category.' + $category)";
  const { root, catalog } = await project({ type: 'label', '$category': 'basics', text: expression });
  assert.equal(root.text, 'howtoplay.category.basics');
  assert.equal(catalog.records[0].value.text, expression);
});

test('継承先から受け取った字句変数・式別名を文字列式に適用する', async () => {
  const { root } = await project({ type: 'panel', '$prefix': "('textures/' + $section)", '$section': 'ui',
    '$name': 'button', controls: [{ image: { type: 'image', texture: "($prefix + '/' + $name)" } },
      { label: { type: 'label', '$name': 'override', text: "('item.' + $name)" } }] });
  assert.equal(root.controls[0].image.texture, 'textures/ui/button');
  assert.equal(root.controls[1].label.text, 'item.override');
});

test('bindingへ渡す#文字列を保持し、勝手に現在の代表値へ固定しない', async () => {
  const { root } = await project({ type: 'label', '$text': 'topic', text: "('#pre_process_' + $text)" });
  assert.equal(root.text, '#pre_process_topic');
});

test('未解決・循環・不正型・未対応式は原文を保持し、property別に診断する', async () => {
  for (const value of ["('topic.' + $missing)", '(1 + 2)', "('topic.' + $loop)", '(globalThis.process.exit())']) {
    const { root, projection } = await project({ type: 'label', '$loop': "('x' + $loop)", text: value, texture: value });
    assert.equal(root.text, value);
    assert.equal(root.texture, value);
    for (const property of ['text', 'texture']) assert(projection.diagnostics.some(row =>
      row.code === 'UI_PROPERTY_EXPRESSION_UNRESOLVED' && row.property === property), `${property}: ${value}`);
  }
});

test('括弧式以外の日本語と翻訳キー・テクスチャパスを変更しない', async () => {
  for (const value of ['ここは日本語です', 'howtoplay.basics', 'textures/ui/button', '日本語（括弧）']) {
    const { root } = await project({ type: 'label', text: value, texture: value });
    assert.equal(root.text, value);
    assert.equal(root.texture, value);
  }
});

test('文字列演算に長さ上限がありview bindingの反復連結でも無制限に増えない', () => {
  const ctx = { props: { text: 'x'.repeat(40_000) }, mockData: {} };
  assert.equal(safeEvalExpression('(#text + #text)', ctx), undefined);
  assert.equal(safeEvalExpression("('a' + 'b')", ctx), 'ab');
  assert.equal(safeEvalExpression("(#text + '')", ctx).length, 40_000);
});
