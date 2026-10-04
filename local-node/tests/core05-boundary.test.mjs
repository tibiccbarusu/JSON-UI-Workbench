import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const implementation = process.env.JSONUI_CORE_ROOT ? pathToFileURL(`${resolve(process.env.JSONUI_CORE_ROOT)}/`) : new URL('../../', import.meta.url);
const { normalizePreviewState } = await import(new URL('editor-core/src/engine/preview-state.js', implementation));
const item = { id: 'minecraft:diamond', count: 2, selected: true };
const EMPTY = {'#is_selected_slot':false,'#item_valid':false,'#item_id_aux':0};
const checkEmpty = (row) => { for (const [key,value] of Object.entries(EMPTY)) assert.equal(row?.[key], value, key); };

test('醸造台の1品目入力は品目と選択を保持し残り2枠を非選択の空状態にする', () => {
  const input = { brewing: { outputs: [item] } }, before = JSON.stringify(input);
  const rows = normalizePreviewState(input).collectionData.brewing_result_items;
  assert.equal(rows.length, 3);
  assert.equal(rows[0]['#item_id_aux'],306 * 65536);
  assert.equal(rows[0]['#inventory_stack_count'],'2');
  assert.equal(rows[0]['#is_selected_slot'],true);
  checkEmpty(rows[1]); checkEmpty(rows[2]);
  rows[1]['#is_selected_slot'] = true;
  assert.equal(rows[2]['#is_selected_slot'],false, '各空枠は独立した状態を持つ');
  assert.equal(JSON.stringify(input),before);
});

test('醸造台の空入力は固定3枠の背景表示に必要な空状態を渡す', () => {
  const rows = normalizePreviewState({brewing:{outputs:[]}}).collectionData.brewing_result_items;
  assert.equal(rows.length,3);
  for (const row of rows) checkEmpty(row);
});

test('醸造台の満杯3枠ではユーザー指定の順序と個数を保持する', () => {
  const rows = normalizePreviewState({brewing:{outputs:[item,{id:'minecraft:gold_ingot',count:7},{id:'minecraft:iron_ingot',count:9}]}}).collectionData.brewing_result_items;
  assert.deepEqual(rows.map(row => row['#item_id_aux']),[306,308,307].map(id=>id*65536));
  assert.deepEqual(rows.map(row => row['#inventory_stack_count']),['2','7','9']);
});

test('醸造台のraw collection指定とoutputs省略の意味を変更しない', () => {
  assert.equal(Object.hasOwn(normalizePreviewState({brewing:{}}).collectionData,'brewing_result_items'),false);
  assert.deepEqual(normalizePreviewState({brewing:{outputs:[item]},collectionData:{brewing_result_items:[]}}).collectionData.brewing_result_items,[]);
  const row = {'#is_selected_slot':true,'#custom':42};
  const explicit = normalizePreviewState({brewing:{outputs:[]},collectionData:{brewing_result_items:[row]}}).collectionData.brewing_result_items;
  assert.equal(explicit.length,1);assert.equal(explicit[0]['#custom'],42);assert.equal(explicit[0]['#is_selected_slot'],true);
});

test('醸造台の過大入力と不正品目は従来通り全体拒否する', () => {
  assert.throws(()=>normalizePreviewState({brewing:{outputs:[item,item,item,item]}}),{code:'PREVIEW_STATE_BREWING_OUTPUTS'});
  assert.throws(()=>normalizePreviewState({brewing:{outputs:[null]}}),{code:'PREVIEW_STATE_ITEM_REQUIRED'});
});

test('主要inventory固定枠は空配列と短配列を補完し、実品目の位置を保つ', () => {
  for (const [field,name,capacity] of [['main','inventory_items',27],['hotbar','hotbar_items',9],['armor','armor_items',4],['offhand','offhand_items',1],['container','container_items',27]]) {
    for (const values of [[],[item]]) {
      const input={inventory:{[field]:values}}, before=JSON.stringify(input);
      const rows=normalizePreviewState(input).collectionData[name];
      assert.equal(rows.length,capacity,field);
      for(let i=values.length;i<capacity;i++)checkEmpty(rows[i]);
      if(values.length)assert.equal(rows[0]['#item_id_aux'],306*65536);
      assert.equal(JSON.stringify(input),before);
    }
  }
  for(const capacity of [1,5,9,27,54,256]) {
    const rows=normalizePreviewState({inventory:{container:[],containerSize:capacity}}).collectionData.container_items;
    assert.equal(rows.length,capacity);rows.forEach(checkEmpty);
  }
});

test('inventoryの空位置・raw優先度と可変Form/tradeの空状態は維持する', () => {
  const state=normalizePreviewState({inventory:{armor:[null,item],container:[],containerSize:54},collectionData:{container_items:[]}});
  checkEmpty(state.collectionData.armor_items[0]);
  assert.equal(state.collectionData.armor_items[1]['#item_id_aux'],306*65536);
  assert.equal(state.collectionData.armor_items.length,4);
  assert.equal(state.collectionData.container_items.length,0);
  assert.equal(normalizePreviewState({form:{buttons:[]}}).collectionData.form_buttons.length,0);
  assert.equal(normalizePreviewState({trade:{offers:[]}}).collectionData.trades.length,0);
});
