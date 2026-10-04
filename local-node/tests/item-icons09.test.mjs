import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalServer } from '../server.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { parseItemTextureAtlas, resolveNativeRendererTexture } from '../../editor-core/src/preview/native-renderer-preview.js';
import { normalizePreviewState } from '../../editor-core/src/engine/preview-state.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { buildValidationSourceContext } from '../validation.mjs';

const renderer = 'inventory_item_renderer';
const atlasText = rows => JSON.stringify({texture_data: rows});
const atlas = rows => parseItemTextureAtlas(atlasText(rows)).atlas;
const iconIndex = (icons = {}, directTextures = {}, blocked = {}) => ({icons, directTextures, blocked});
const props = id => ({renderer, __jsonui_preview_collection_details: normalizePreviewState({slots:{items:[{id}]}}).collectionData.items[0]});
const definition = (id, icon) => JSON.stringify({'minecraft:item':{description:{identifier:id},components:{'minecraft:icon':icon}}});
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');

test('任意IDはatlasから解決し、既定の3品目と独自名前空間を保持する', () => {
  const context = {vanillaAtlas:atlas(Object.fromEntries(['iron_ingot','diamond','emerald','apple','example:gem'].map(k => [k,{textures:`textures/items/${k.replace(':','_')}`}])))};
  for(const id of ['iron_ingot','diamond','emerald','apple','example:gem']) {
    const result = resolveNativeRendererTexture(props(id), context);
    assert.equal(result.status,'resolved',id);
    assert.equal(result.textureRef,`textures/items/${id.replace(':','_')}`);
  }
  assert.equal(resolveNativeRendererTexture(props('other:diamond'),context).issue,'ITEM_ICON_TEXTURE_MISSING');
  assert.equal(resolveNativeRendererTexture(props('missing'),context).issue,'ITEM_ICON_TEXTURE_MISSING');
});

test('上位の正式定義を優先し、下位索引の失敗・待機は確定済み上位対応を妨げない', () => {
  for(const status of ['loading','error']) {
    const context = {importedItemsStatus:'ready', importedItems:iconIndex({'minecraft:golden_sword':{atlasKey:'sword_gold'}}),
      vanillaItemsStatus:status, importedAtlas:atlas({sword_gold:{textures:'textures/custom/gold_weapon'}})};
    assert.equal(resolveNativeRendererTexture(props('golden_sword'),context).textureRef,'textures/custom/gold_weapon');
  }
  const lowerDefinition = {importedItemsStatus:'ready',importedItems:iconIndex(),vanillaItemsStatus:'ready',
    vanillaItems:iconIndex({'minecraft:golden_sword':{atlasKey:'sword_gold'}}),
    importedAtlas:atlas({sword_gold:{textures:'textures/override/weapon'}}),vanillaAtlas:atlas({sword_gold:{textures:'textures/items/gold_sword'}})};
  assert.equal(resolveNativeRendererTexture(props('golden_sword'),lowerDefinition).textureRef,'textures/override/weapon');
});

test('実在する同名ファイルだけを補完し、空欄・明示指定・読込状態・不正索引を区別する', () => {
  const context = {importedItemsStatus:'ready',importedItems:iconIndex({}, {'minecraft:apple':'textures/items/apple'})};
  assert.equal(resolveNativeRendererTexture(props('apple'),context).textureRef,'textures/items/apple');
  assert.equal(resolveNativeRendererTexture(props('custom:apple'),context).issue,'ITEM_ICON_TEXTURE_MISSING');
  assert.equal(resolveNativeRendererTexture({...props('apple'),'#item_valid':false},context).empty,true);
  assert.equal(resolveNativeRendererTexture({...props('apple'),__jsonui_preview_item_texture:'textures/manual/apple'},context).textureRef,'textures/manual/apple');
  assert.equal(resolveNativeRendererTexture(props('apple'),{importedItemsStatus:'loading'}).status,'pending');
  assert.equal(resolveNativeRendererTexture(props('apple'),{importedItemsStatus:'error'}).issue,'ITEM_ICON_INDEX_FAILED');
  const invalid = {importedItemsStatus:'ready',importedItems:iconIndex({}, {}, 42), importedAtlas:atlas({apple:{textures:'textures/items/apple'}})};
  assert.equal(resolveNativeRendererTexture(props('apple'),invalid).issue,'ITEM_ICON_CONTEXT_INVALID');
  let reads = 0;const blocked = {}; Object.defineProperty(blocked,'minecraft:apple',{get(){reads++;return false;}});
  assert.equal(resolveNativeRendererTexture(props('apple'),{importedItemsStatus:'ready',importedItems:iconIndex({}, {}, blocked)}).status,'blocked');
  assert.equal(reads,0);
  const zero = normalizePreviewState({slots:{items:[{id:'apple',count:0}]}}).collectionData.items[0];
  assert.equal(resolveNativeRendererTexture({renderer,__jsonui_preview_collection_details:zero},context).empty,true);
});

test('HTTPで両パックの索引・編集上書き・画像bytes・実binding経由の任意IDを検査', async t => {
  const app = await createLocalServer({port:0});t.after(()=>app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const {token} = await (await fetch(base+'capabilities')).json();
  const headers = {'X-JSONUI-Token':token};
  const post = (route, data, auth = true) => fetch(base+route,{method:'POST',headers:{...(auth?headers:{}),'Content-Type':'application/json'},body:JSON.stringify(data)});
  const vanillaId = randomUUID(), importedId = randomUUID();
  const vanillaRows = {sword_gold:{textures:'textures/items/gold_sword'},diamond:{textures:'textures/items/diamond'}};
  const importedRows = {sword_gold:{textures:'textures/custom/weapon'}};
  for(const [id, files] of [[vanillaId,{'items/sword.json':definition('minecraft:golden_sword',{textures:{default:'sword_gold'}}),
    'textures/item_texture.json':atlasText(vanillaRows),'textures/items/gold_sword.png':pixel,'textures/items/diamond.png':pixel}],
    [importedId,{'textures/item_texture.json':atlasText(importedRows),'textures/custom/weapon.png':pixel,'textures/items/apple.png':pixel}]]) {
    const response = await fetch(base+'packs',{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-JSONUI-Upload-ID':id,'X-JSONUI-Name':'icons.zip'},
      body:makeZip({'manifest.json':manifest,...files})});
    assert.equal(response.status,200,await response.text());
  }
  const source = {id:importedId,kind:'imported'};
  const denied = await post('item-icons',{source},false);assert.equal(denied.status,401);await denied.arrayBuffer();
  const readIndex = async source => {const r=await post('item-icons',{source});assert.equal(r.status,200);return r.json();};
  const importedItems = await readIndex(source), vanillaItems = await readIndex({id:vanillaId,kind:'vanilla'});
  assert.equal(importedItems.processing,'node-worker');
  assert.equal(importedItems.stats.documentBytes,0);
  const context = {importedItemsStatus:'ready',importedItems,vanillaItemsStatus:'ready',vanillaItems,
    importedAtlas:atlas(importedRows),vanillaAtlas:atlas(vanillaRows)};
  // Keep the renderer a row consumer, with a native collection-owning parent.
  const model = buildUiScreenModelFromJson({namespace:'test',owner:{type:'collection_panel',collection_name:'items',controls:[{item:{type:'custom',renderer,collection_index:0,
    bindings:[{binding_type:'collection_details',binding_collection_name:'items'}]}}]}},{filePath:'ui/item.json'});
  const collectionData = normalizePreviewState({slots:{items:[{id:'golden_sword'}]}}).collectionData;
  const evaluated = evaluateBindingsForUiModel(model,{mockData:{},collectionData});
  const node = model.root.children.flatMap(owner=>owner.children).find(n=>n.type==='custom');
  const result = resolveNativeRendererTexture({...node.unknownProps,...node.props,...evaluated.propsById[node.id]},context);
  assert.equal(result.textureRef,'textures/custom/weapon');assert.equal(result.source,'imported');
  const image = await fetch(base+`packs/${importedId}/read?path=${encodeURIComponent(result.textureRef+'.png')}&maxBytes=1024`,{headers});
  assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),pixel);
  assert.equal(resolveNativeRendererTexture(props('apple'),context).textureRef,'textures/items/apple');
  const changed = await readIndex({...source,overrides:{'items/apple.json':definition('minecraft:apple','sword_gold')}});
  assert.equal(changed.icons['minecraft:apple'].atlasKey,'sword_gold');
  assert.equal((await readIndex(source)).icons['minecraft:apple'],undefined);
  const removed = await fetch(base+`packs/${importedId}`,{method:'DELETE',headers});assert.equal(removed.status,200);await removed.arrayBuffer();
  const stale = await post('item-icons',{source});assert.equal(stale.status,404);await stale.arrayBuffer();
});

test('Node側の参照検査も同じ正式定義の索引を用いる', async () => {
  const files = {'items/sword.json':definition('minecraft:golden_sword','sword_gold'),'textures/item_texture.json':atlasText({sword_gold:{textures:'textures/items/gold_sword'}}),'textures/items/gold_sword.png':pixel};
  const item = {packPaths:Object.keys(files),rootPrefix:'',zipReader:{async readText(path){return files[path];}}};
  const {context} = await buildValidationSourceContext([{id:'vanilla',kind:'vanilla'}],()=>item,{},'en_US');
  assert.equal(context.itemTextureAtlases.vanillaItemsStatus,'ready');
  assert.equal(resolveNativeRendererTexture(props('golden_sword'),context.itemTextureAtlases).textureRef,'textures/items/gold_sword');
});


test('atlasの無いパックでも、互換別名の実在画像のみを表示する', () => {
  const context = {importedItemsStatus:'ready',importedItems:iconIndex({}, {'minecraft:gold_sword':'textures/items/gold_sword'})};
  assert.equal(resolveNativeRendererTexture(props('golden_sword'),context).textureRef,'textures/items/gold_sword');
  assert.equal(resolveNativeRendererTexture(props('diamond_sword'),context).issue,'ITEM_ICON_TEXTURE_MISSING');
  assert.equal(resolveNativeRendererTexture(props('custom:golden_sword'),context).issue,'ITEM_ICON_TEXTURE_MISSING');
});
