/** 実main.jsの境界を有限のNode/DOM代替で検査する。実ブラウザの試験ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const main = await readFile(process.env.JSONUI_UX_REVIEW_SOURCE || new URL('../../editor-core/src/main.js', import.meta.url), 'utf8');
function part(start, end) { const a=main.indexOf(start),b=main.indexOf(end,a+start.length); assert(a>=0&&b>a);return main.slice(a,b); }
function context(parts, extra={}) { const c=vm.createContext(extra);for(const [a,b] of parts)vm.runInContext(part(a,b),c,{timeout:1000});return c; }
function pathContext(){return context([
 ['async function readPackTextCaseInsensitive(', 'async function loadMergedGlobalVarNames('],
 ['function buildPackPathCaseIndex(', 'async function readImportedPackBlob('],
]);}
test('大文字混在global variablesは欠落時だけ実パスを1回再読取りする', async()=>{
 const c=pathContext(), calls=[];const content='{"$color":[1,0,0]}';
 const text=await c.readPackTextCaseInsensitive({desiredPackPath:'ui/_global_variables.json',packPaths:['UI/_GLOBAL_VARIABLES.JSON'],readTextFn:async p=>{calls.push(p);if(p==='UI/_GLOBAL_VARIABLES.JSON')return content;throw new Error('ZIP_ENTRY_NOT_FOUND');}});
 assert.equal(text,content);assert.deepEqual(calls,['ui/_global_variables.json','UI/_GLOBAL_VARIABLES.JSON']);
});
test('パス再読取りはI/O失敗を欠落扱いせず完全一致成功時も再読取りしない', async()=>{
 const c=pathContext();let calls=0;
 await assert.rejects(c.readPackTextCaseInsensitive({desiredPackPath:'ui/a.json',packPaths:['UI/A.JSON'],readTextFn:async()=>{calls++;throw new Error('ZIP_READ_TIMEOUT');}}),/ZIP_READ_TIMEOUT/);assert.equal(calls,1);
 const value=await c.readPackTextCaseInsensitive({desiredPackPath:'ui/a.json',packPaths:[],readTextFn:async()=>{calls++;return 'exact';}});assert.equal(value,'exact');assert.equal(calls,2);
});
test('支点0ズームは左上座標を保持し省略支点は中央を使う',()=>{
 const cs={view:{zoom:1,viewX:40,viewY:30},layout:{preset:{}}};let paints=0;
 const c=context([['function zoomCanvasAtPivotPx(', 'function fitCanvasView(']],{document:{getElementById:()=>({getBoundingClientRect:()=>({width:400,height:200})})},getCanvasState:()=>cs,ensureCanvasViewInitialized(){},canvasPxToWorld:(x,y,v)=>({x:x/v.zoom+v.viewX,y:y/v.zoom+v.viewY}),clampZoom:x=>Math.max(.01,Math.min(100,x)),drawCanvasNow(){paints++;},DEFAULT_CANVAS_PRESET:{}});
 c.zoomCanvasAtPivotPx('k',2,{x:0,y:0});assert.deepEqual(cs.view,{zoom:2,viewX:40,viewY:30});
 c.zoomCanvasAtPivotPx('k',2);assert.deepEqual(cs.view,{zoom:4,viewX:90,viewY:55});assert.equal(paints,2);
});
test('ログソートは__proto__をown data keyで保持し入力を変えない',()=>{
 const c=context([['function sortKeysDeep(', 'function stableStringifyDebug(']]);const value=JSON.parse('{"z":2,"__proto__":{"secret":"kept"},"a":[{"b":1}]}');
 const sorted=c.sortKeysDeep(value);assert.equal(Object.hasOwn(sorted,'__proto__'),true);assert.deepEqual(JSON.parse(JSON.stringify(sorted)),value);assert.equal(Object.getPrototypeOf(sorted),null);assert.equal(Object.getPrototypeOf(value),Object.prototype);
});
for(const throws of [false,true])test(`旧コピーAPIの${throws?'例外':'成功'}でもtextareaを必ず除去する`,async()=>{
 let appended=0,removed=0;const ta={style:{},setAttribute(){},select(){},setSelectionRange(){},remove(){removed++;}};
 const c=context([['async function copyLegacyTextToClipboard(', 'function renderJsonCodeBlock(']],{navigator:{clipboard:{writeText:async()=>{throw new Error('CLIPBOARD_DENIED');}}},document:{createElement:()=>ta,body:{appendChild(){appended++;}},execCommand(){if(throws)throw new Error('LEGACY_COPY_DENIED');return true;}}});
 assert.equal(await c.copyLegacyTextToClipboard('日本語'),!throws);assert.equal(appended,1);assert.equal(removed,1);assert.equal(ta.value,'日本語');
});
test('検索上限200は要素の2種hitとグローバル変数追加でも維持する',()=>{
 const c=context([['function normalizeSearchQuery(', 'function clearTreeSearch(']],{globalVarsEditorState:{status:'ready',entries:[{name:'$match'}]},diagnostics:{captureError:e=>{throw e;}}});
 const nodesById={};for(let i=0;i<199;i++)nodesById['match'+i]={id:'match'+i,type:'label',props:{}};
 nodesById.matchLast={id:'matchLast',type:'label',props:{text:'match.text',localize:true}};
 const out=c.computeTreeSearchResults({files:{currentFileId:'f',byId:{f:{nodesById}}}},'match');assert.equal(out.results.length,200);assert.equal(out.results.at(-1).kind,'element');
});
for(const side of ['left','right'])test(`${side}のキーボード幅変更は反対側の幅0を復活させない`,()=>{
 let result,prevented=0;const panels=side==='left'?{leftPx:300,rightPx:0}:{leftPx:0,rightPx:300};
 const c=context([['function onSplitterKeyDown(', 'function startSplitterDrag(']],{store:{getState:()=>({ui:{panels}}),dispatch:value=>{result=value;}},actions:{setPanelSizes:value=>value},PANEL_DEFAULT_LEFT_PX:320,PANEL_DEFAULT_RIGHT_PX:320,PANEL_MIN_LEFT:240,PANEL_MIN_RIGHT:240,PANEL_MIN_CENTER:400,getLayoutWidthPx:()=>1400,getSplitterWidthPx:()=>8,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),requestAnimationFrame:fn=>fn(),document:{activeElement:null}});
 c.onSplitterKeyDown(side,{key:'ArrowRight',shiftKey:false,preventDefault(){prevented++;}});assert.equal(result[side==='left'?'rightPx':'leftPx'],0);assert.equal(result[side==='left'?'leftPx':'rightPx'],side==='left'?320:280);assert.equal(prevented,1);
});
test('subtree収集は共有子・循環でも一回ずつ列挙して有限に終了する',()=>{
 const c=context([['function collectSubtreeIds(', 'function applyTreeDuplicate(']]);
 const nodes={a:{children:['b','c']},b:{children:['a','c']},c:{children:[]}};
 c.nodes=nodes;vm.runInContext('this.ids = collectSubtreeIds(nodes,"a")',c,{timeout:1000});
 assert.deepEqual([...c.ids].sort(),['a','b','c']);
});
test('実描画の画像異常callbackは選択定義id付き診断を消失させない',()=>{
 const file={id:'f',path:'ui/example.json',meta:{selectedDefinition:{recordId:'definition:test'}},nodesById:{}}, layout={boxes:[],preset:{width:100,height:100}};
 const state={ui:{previewLocale:'ja_JP'},files:{currentFileId:'f',byId:{f:file}},editor:{selection:{nodeId:null}},preview:{}},cs={view:{zoom:1,viewX:0,viewY:0},layout,interaction:{active:false},propsByIdOverride:{}};
 const logs=[],canvas={getBoundingClientRect:()=>({width:100,height:100})};
 const c=context([['function drawCanvasFrame(', '\nlet nativeMotionFrameTimer']],{
  document:{getElementById:()=>canvas,hidden:false},getCanvasState:()=>cs,drawNativeMotionFromSnapshot:()=>false,nativeMotionSnapshotOwner:null,ensureCanvasViewInitialized(){},DEFAULT_CANVAS_PRESET:{},store:{getState:()=>state},SUPPORTED_PREVIEW_LOCALES:['ja_JP'],studioDraftScene23:()=>null,
  isCanvasNodeTransformable:()=>false,isCanvasNodeResizable:()=>false,sourceWorkspace:{state:{pendingVersion:0},pendingNodeTransforms:()=>new Map()},studioPaintLayout21:()=>layout,mergePendingProperties21:value=>value,applyCanvasDraftToLayout:value=>value,applyPendingGeometry21:value=>value,
  importedPackRuntime:null,vanillaReferenceRuntime:null,preparePreviewTextCopyCapture:()=>({nodesById:{},segments:new Map()}),syncPreviewEditBoxOverlayPosition(){},textureCompositionEpoch:1,loggedNativeSceneIssueKeys:new Set(),MAX_NATIVE_TEXTURE_FAILURE_CODES:256,
  diagnostics:{log:(...args)=>logs.push(args),captureError:(...args)=>logs.push(['error',...args])},siteText:x=>x,drawCanvasNow(){},drawStudioSelection21(){},commitPreviewTextCopyCapture(){},prepareCurrentPreviewAudio(){},startNativeMotionPreview(){},updateCanvasZoomLabel(){},
  drawCanvasPreview:(canvas,layout,view,selection)=>selection.onImageDrawIssue({code:'IMAGE_EFFECT_INVALID',nodeId:'image1'}),
 });
 c.drawCanvasFrame('key');assert.equal(logs.length,1);assert.equal(logs[0][2].data.definitionId,'definition:test');assert.equal(logs[0][2].data.code,'IMAGE_EFFECT_INVALID');
});
