import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiScreenTree } from '../../editor-core/src/editor/screen-tree.js';
import { duplicateSubtreeInNodeMap, deleteSubtreeInNodeMap } from '../../editor-core/src/editor/tree-node-ops.js';
import { stableStringify } from '../../editor-core/src/json/stable-stringify.js';
import { appReducer, createInitialState, actions } from '../../editor-core/src/state-store/app-store.js';
import { verifyOfficialReleaseUrl, verifyOfficialReleaseAsset } from '../../editor-core/src/vanilla/official-release-verifier.js';

test('screen tree always owns root and every child reference within finite budgets', () => {
  for (const input of [{}, {namespace:'demo', a:{controls:[{x:{type:'label'}}]},b:{type:'panel'}}]) {
    for (const maxNodes of [0,-1,1,2,3,NaN,Infinity]) {
      const result=buildUiScreenTree(input,{maxNodes});
      assert.ok(Object.hasOwn(result.nodesById,result.rootId));
      assert.equal(result.stats.nodeCount,Object.keys(result.nodesById).length);
      if(Number.isSafeInteger(maxNodes)) assert.ok(result.stats.nodeCount<=Math.max(1,maxNodes));
      for(const node of Object.values(result.nodesById)) for(const child of node.children) assert.ok(Object.hasOwn(result.nodesById,child),child);
    }
  }
});

test('stub tree operations reject cycles and missing descendants without modifying source', () => {
  for(const tail of [['a'], ['missing'], ['b','b'], [''], ['', 'b'], ['b', '']]) {
    const source={root:{id:'root',children:['a']},a:{id:'a',children:tail},b:{id:'b',children:[]}};
    const before=JSON.stringify(source);
    const copied=duplicateSubtreeInNodeMap(source,'root','a');
    const deleted=deleteSubtreeInNodeMap(source,'root','a');
    assert.equal(copied.nodesById,source);assert.equal(copied.newNodeId,null);
    assert.equal(deleted.nodesById,source);assert.deepEqual(deleted.deletedIds,[]);
    assert.equal(JSON.stringify(source),before);
  }
});

test('stub tree operations reject own descendant keys without node objects', () => {
  for (const invalid of [null, undefined, false, 1, 'text', []]) {
    const source = {root:{id:'root',children:['a']}, a:{id:'a',children:['b']}, b:invalid};
    const before = JSON.stringify(source);
    const copied = duplicateSubtreeInNodeMap(source,'root','a');
    const deleted = deleteSubtreeInNodeMap(source,'root','a');
    assert.equal(copied.nodesById,source); assert.equal(copied.newNodeId,null);
    assert.equal(deleted.nodesById,source); assert.deepEqual(deleted.deletedIds,[]);
    assert.equal(JSON.stringify(source),before);
  }
});

test('stub subtree copies remap descendant IDs and deletion preserves sibling data', () => {
  const source={root:{id:'root',children:['a','s']},a:{id:'a',props:{name:'a'},children:['b']},b:{id:'b',props:{text:'日本語'},children:[]},s:{id:'s',children:[]}};
  const copy=duplicateSubtreeInNodeMap(source,'root','a');
  assert.equal(copy.newNodeId,'a_copy');assert.deepEqual(copy.nodesById.root.children,['a','a_copy','s']);
  assert.deepEqual(copy.nodesById.a_copy.children,['b_copy']);assert.equal(copy.nodesById.b_copy.props.text,'日本語');
  const removed=deleteSubtreeInNodeMap(copy.nodesById,'root','a_copy');
  assert.deepEqual(removed.nodesById,source);assert.equal(removed.nodesById.s,source.s);
});

test('sorted JSON preserves own prototype-sensitive keys recursively without pollution', () => {
  const input=JSON.parse('{"z":0,"__proto__":{"x":1},"nested":[{"__proto__":2,"constructor":3}]}');
  const before=JSON.stringify(input); const output=stableStringify(input,{sortKeys:true});
  assert.deepEqual(JSON.parse(output),input);assert.equal(JSON.stringify(input),before);
  assert.equal(Object.prototype.x,undefined);assert.ok(output.endsWith('\n'));
});

test('navigation index remains an integer suitable for indexing history', () => {
  const state=createInitialState();state.preview.navigation.stack=['a','b','c'];state.preview.navigation.index=0;
  const result=appReducer(state,actions.navSetIndex(1.8));
  assert.equal(result.preview.navigation.index,1);assert.equal(result.preview.navigation.stack[result.preview.navigation.index],'b');
  assert.equal(state.preview.navigation.index,0);
});

const tag='v1.26.40.05';
const url=`https://github.com/Mojang/bedrock-samples/releases/download/${tag}/bedrock-samples-${tag}-full.zip`;
test('official release URL requires the exact HTTPS authority and asset path', () => {
  assert.equal(verifyOfficialReleaseUrl(url,tag),true);
  for(const altered of [url.replace('github.com','user@github.com'),url.replace('github.com','github.com:444'),url+'/extra',url+'?x=1',url+'#x']) assert.equal(verifyOfficialReleaseUrl(altered,tag),false,altered);
});

test('official metadata body deadline settles even when adapter ignores cancellation', async () => {
  let seenSignal;
  const result=await verifyOfficialReleaseAsset({sourceAssetUrl:url,sourceRelease:tag,sourceChannel:'stable',localDigest:'a'.repeat(64)}, {timeoutMs:1000,fetchImpl:async(_url,options)=>{seenSignal=options.signal;return {ok:true,json:()=>new Promise(()=>{})};}});
  assert.equal(result.result_code,'OFFICIAL_METADATA_FETCH_TIMEOUT');assert.equal(result.asset_digest_match,false);assert.equal(seenSignal.aborted,true);
});
