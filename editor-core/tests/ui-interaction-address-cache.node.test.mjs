import test from 'node:test';
import assert from 'node:assert/strict';
import { findInteractionCollectionAddress, listUiInteractionCapabilities } from '../src/preview/ui-interaction-engine.js';
import { restoreFrameDelta } from '../src/pack-io/frame-delta-client.js';
const box=(id,parentId=null)=>({id,parentId,x:0,y:0,w:10,h:10});
function context() {
  return {nodeId:'cell',nodesById:{cell:{props:{collection_index:1}},left:{type:'collection_panel',props:{collection_name:'left_items'}},right:{type:'collection_panel',props:{collection_name:'right_items'}}},boxes:[box('cell','left'),box('left'),box('right')]};
}
test('address index reuses one published array and rebuilding on equal-length frame replacement changes ancestry',()=>{
  const c=context();assert.deepEqual(findInteractionCollectionAddress(c),{collection:'left_items',index:1});
  const before={frameId:'frame1',modelId:'model',layout:{boxes:c.boxes},propsById:{},basePropsById:{}};
  const next=restoreFrameDelta(before,{schema:'jsonui-frame-delta-v1',baseFrameId:'frame1',modelId:'model',layoutDelta:{boxCount:3,boxes:[[0,{set:{parentId:'right'},remove:[]}]],meta:{set:{},remove:[]}},propsDelta:{set:{},remove:[]},basePropsDelta:{set:{},remove:[]}});
  assert.notEqual(next.layout.boxes,c.boxes);assert.equal(next.layout.boxes.length,c.boxes.length);
  assert.deepEqual(findInteractionCollectionAddress({...c,boxes:next.layout.boxes}),{collection:'right_items',index:1});
  assert.deepEqual(findInteractionCollectionAddress(c),{collection:'left_items',index:1});
});
test('length changes rebuild address index and existing box object parent changes remain live',()=>{
  const c=context();assert.deepEqual(findInteractionCollectionAddress(c),{collection:'left_items',index:1});
  c.boxes[0].parentId='right';assert.deepEqual(findInteractionCollectionAddress(c),{collection:'right_items',index:1});
  c.nodesById.child={props:{}};c.boxes.push(box('child','cell'));
  assert.deepEqual(findInteractionCollectionAddress({...c,nodeId:'child'}),{collection:'right_items',index:1});
  c.boxes.pop();assert.equal(findInteractionCollectionAddress({...c,nodeId:'child'}),null);
});
test('state and props change address without invalidating layout, and collection mismatch stays blocked',()=>{
  const c=context();assert.deepEqual(findInteractionCollectionAddress(c),{collection:'left_items',index:1});
  assert.deepEqual(findInteractionCollectionAddress({...c,propsById:{cell:{collection_index:2}}}),{collection:'left_items',index:2});
  c.nodesById.left.props.collection_name='renamed';assert.deepEqual(findInteractionCollectionAddress(c),{collection:'renamed',index:1});
  assert.equal(findInteractionCollectionAddress({...c,collection:'other'}),null);
  const single={nodeId:'button',boxes:[box('button')],nodesById:{button:{bindings:[{binding_type:'collection_details',binding_collection_name:'one'}]}}};
  assert.deepEqual(findInteractionCollectionAddress({...single,collectionData:{one:[{}]}}),{collection:'one',index:0});
  assert.equal(findInteractionCollectionAddress({...single,collectionData:{one:[{},{}]}}),null);
});
test('96 capability entries on 5000 boxes scan the address layout once instead of per candidate',()=>{
  const buttons=Array.from({length:97},(_,index)=>({id:'b'+index,type:'button',props:{button_mappings:[{from_button_id:'button.menu_select',to_button_id:'button.menu_exit',mapping_type:'pressed'}]},children:[]}));
  const root={id:'root',type:'panel',props:{},children:buttons},nodesById=Object.fromEntries([root,...buttons].map(n=>[n.id,n]));
  const data=Array.from({length:5000},(_,index)=>box(index<97?'b'+index:'d'+index,'root'));
  let numericReads=0;const boxes=new Proxy(data,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/u.test(key))numericReads++;return Reflect.get(target,key,receiver);}});
  const c={model:{root},nodesById,boxes};const before=listUiInteractionCapabilities(c);
  assert.equal(before.entries.length,96);assert.equal(before.truncated,true);assert.equal(numericReads,10000);
  numericReads=0;assert.deepEqual(listUiInteractionCapabilities(c),before);assert.equal(numericReads,0);
});
