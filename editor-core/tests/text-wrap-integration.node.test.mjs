/** 本番の文字実寸補正とNode配置への受渡し。ブラウザ実機検査ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {layoutBitmapText} from '../src/preview/bitmap-font.js';
import {getBedrockLogicalFontPx,estimateTextIntrinsicSize} from '../src/preview/canvas-preview.js';
import {buildUiScreenModelFromJson} from '../src/model/ui-screen-model.js';
import {buildTreeFromUiScreenModel} from '../src/editor/ui-model-tree.js';
import {FrameIrProcessor} from '../../local-node/frame-ir.mjs';
const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('function measurePreviewLabelIntrinsicSize('),end=source.indexOf('function drawCanvasNow(',start);
assert(start>0&&end>start);
const glyphs=Array.from({length:256},(_,cell)=>({advance:cell===32?4:8,empty:false}));
const sheet={image:{},metrics:{glyphs},status:'ready'};
const sandbox={estimateTextIntrinsicSize,getBedrockLogicalFontPx,previewTextMeasureCanvas:null,
 document:{createElement:()=>({getContext:()=>({})})},resolveLocalRuntimePropertyToken:v=>v,resolvePreviewLocalizedText:v=>v,
 bitmapTextLayout:(text,fontType,fontPx,color,linePadding,maxWidth)=>layoutBitmapText(text,{fontType,fontPx,color,linePadding,maxWidth,getSheet:()=>sheet})};
vm.createContext(sandbox);vm.runInContext(source.slice(start,end)+'\nglobalThis.merge=mergeTextIntrinsicSizes;',sandbox);
function fixture(size=['100%','default'],extra={}){
 const uiModel=buildUiScreenModelFromJson({namespace:'wrap',screen:{type:'stack_panel',orientation:'vertical',size:[32,'100%c'],anchor_from:'top_left',anchor_to:'top_left',controls:[
 {paragraph:{type:'label',size,text:'one two',localize:false,anchor_from:'top_left',anchor_to:'top_left',...extra}},
 {next:{type:'panel',size:[32,4],anchor_from:'top_left',anchor_to:'top_left'}}]}},{filePath:'ui/wrap.json'});
 const file={id:'screen:ui/wrap.json',...buildTreeFromUiScreenModel(uiModel),uiModel};
 const id=Object.keys(file.nodesById).find(id=>id.endsWith('/paragraph'));return {file,id};
}
const run=(processor,input)=>JSON.parse(processor.execute({preset:{width:100,height:100},...input}).body);
test('実label幅から折返しを測りNodeへ高さを戻して後続段落を押し下げる',()=>{
 const {file,id}=fixture(),processor=new FrameIrProcessor(),first=run(processor,{file});
 const measured=sandbox.merge(file,first.basePropsById,'en_US',first.layout);
 assert.equal(measured[id].size[1],16);
 const next=run(processor,{modelId:first.modelId,propsByIdOverride:measured});
 const box=next.layout.boxes.find(x=>x.id===id),after=next.layout.boxes.find(x=>x.id.endsWith('/next'));
 assert.equal(box.h,16);assert(after.y>=box.y+box.h);assert.equal(file.nodesById[id].props.size[1],'default');
});
test('幅がまだ不明なら旧来の1行測定を維持する',()=>{
 const {file,id}=fixture();const result=sandbox.merge(file,{},'en_US');assert.equal(result[id].size[1],8);
});
test('固定heightのlabelは自動で宣言寸法を書き換えない',()=>{
 const {file}=fixture([32,8]);const base={};assert.equal(sandbox.merge(file,base,'en_US',{boxes:[]}),base);
});
test('固定sizeのcontent制約には文字実寸だけを補い宣言幅を保持する',()=>{
 const {file,id}=fixture([32,8],{max_size:['100%c',10]});
 const result=sandbox.merge(file,{},'en_US',{boxes:[{id,w:32,h:8}]});
 assert.equal(Object.hasOwn(result[id],'size'),false);
 assert.deepEqual(Array.from(result[id].__jsonui_preview_text_intrinsic_size),[52,8]);
 assert.deepEqual(file.nodesById[id].props.size,[32,8]);
});
test('明示text_wrap falseは旧来のクリップ表示を選択できる',()=>{
 const {file,id}=fixture(['100%','default'],{text_wrap:false});const result=sandbox.merge(file,{},'en_US',{boxes:[{id,w:32}]});assert.equal(result[id].size[1],8);
});
test('行間は折返しで増えた行にも実寸として含める',()=>{
 const {file,id}=fixture(['100%','default'],{line_padding:2});const result=sandbox.merge(file,{},'en_US',{boxes:[{id,w:32}]});assert.equal(result[id].size[1],18);
});
