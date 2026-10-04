import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepresentativeClassicCollections, buildRepresentativeClassicCollectionData } from '../../editor-core/src/engine/representative-classic-runtime.js';
import { normalizePreviewState } from '../../editor-core/src/engine/preview-state.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsWithRepresentativeRuntime } from '../../editor-core/src/engine/preview-bindings-runtime.js';

const scenarios = {
  'trade.trade_screen': ['trade_item_A', 'trade_item_B', 'sell_item', 'trade_ingredient1_items', 'trade_ingredient2_items', 'trade_result_item'],
  'trade2.trade_screen': ['trade_item_1', 'trade_item_2', 'sell_item', 'trade2_ingredient1_item', 'trade2_ingredient2_item', 'trade2_result_item'],
};
const countFields = ['#item_stack_count', '#inventory_stack_count', '#trade_item_count'];
function collections(qualifiedName, userCollectionData = {}) {
  return buildRepresentativeClassicCollectionData(
    buildRepresentativeClassicCollections({ qualifiedName, collectionData: userCollectionData }), userCollectionData);
}
function countModel(collection) {
  return buildUiScreenModelFromJson({ namespace: 'trade', trade_screen: { type: 'screen', controls: [
    { item: { type: 'panel', collection_index: 0, __jsonui_preview_collection_name: collection, controls:
      countFields.map((field, index) => ({ [`count_${index}`]: { type: 'label', text: '#text', bindings: [
        { binding_type: 'collection', binding_collection_name: collection, binding_name: field, binding_name_override: '#text' },
      ] } })),
    } },
  ] } }, { filePath: 'ui/trade_screen.json' });
}
function boundCounts(qualifiedName, collection, userCollectionData) {
  const result = evaluateBindingsWithRepresentativeRuntime(countModel(collection), qualifiedName,
    userCollectionData ? { __collections: userCollectionData } : {});
  return countFields.map((_, index) => {
    const entry = Object.entries(result.propsById).find(([id]) => id.endsWith(`/count_${index}`));
    assert.ok(entry, `count_${index}`); return entry[1].text;
  });
}

for (const [qualifiedName, names] of Object.entries(scenarios)) {
  test(`${qualifiedName}: 代表12行の数量は文字列で1個のstackは空`, () => {
    const rows = collections(qualifiedName);
    for (const name of names) {
      const row = rows[name][0];
      for (const field of countFields) assert.equal(typeof row[field], 'string', `${name}.${field}`);
      const tradeCount = ['trade_item_2', 'trade2_ingredient2_item'].includes(name) ? '' : '1';
      assert.deepEqual(countFields.map(field => row[field]), ['', '', tradeCount], name);
      assert.equal(row['#item_valid'], true, '今回の修正で既存代表アイテムの有効状態を変えない');
    }
  });
  test(`${qualifiedName}: collection binding後もlabel textに数値を渡さない`, () => {
    for (const name of names) {
      const expectedTrade = ['trade_item_2', 'trade2_ingredient2_item'].includes(name) ? '' : '1';
      assert.deepEqual(boundCounts(qualifiedName, name), ['', '', expectedTrade], name);
    }
  });
}

test('利用者の型付き交易状態は1個・複数個の表示を代表行で上書きしない', () => {
  for (const count of [1, 4, 64]) {
    const state = normalizePreviewState({ trade: { offers: [{
      input: { id: 'minecraft:emerald', count }, secondInput: { id: 'minecraft:iron_ingot', count },
      output: { id: 'minecraft:diamond', count },
    }] } });
    const before = JSON.stringify(state.collectionData);
    const stack = count > 1 ? String(count) : '';
    for (const [qualifiedName, names] of Object.entries(scenarios)) {
      const rows = collections(qualifiedName, state.collectionData);
      for (const name of names) {
        assert.equal(rows[name], state.collectionData[name], '明示collectionをそのまま優先する');
        assert.deepEqual(boundCounts(qualifiedName, name, state.collectionData), [stack, stack, String(count)], name);
      }
    }
    assert.equal(JSON.stringify(state.collectionData), before);
  }
});

test('直接指定した空collection・独自文字・数値は暗黙変換せずそのまま保持する', () => {
  for (const qualifiedName of Object.keys(scenarios)) {
    const collection = scenarios[qualifiedName][0];
    for (const userRows of [[], [{ '#item_stack_count': '任意', '#inventory_stack_count': '004', '#trade_item_count': 7 }]]) {
      const input = { [collection]: userRows }, before = JSON.stringify(input);
      assert.equal(collections(qualifiedName, input)[collection], userRows);
      if (userRows.length) assert.deepEqual(boundCounts(qualifiedName, collection, input), ['任意', '004', 7]);
      assert.equal(JSON.stringify(input), before);
    }
  }
  assert.deepEqual(Object.keys(collections('custom.trade_screen')), []);
});
