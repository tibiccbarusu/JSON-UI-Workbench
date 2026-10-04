/** Actual HTTP/Worker catalog, selector, projection, validation and first frame.
 * The VM supplies DOM/status and deterministic state only; no fake selector. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { writeFile } from 'node:fs/promises';
import { createLocalServer } from '../server.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { setup, source } from '../../editor-core/tests/helpers/navigation-main-harness.mjs';
import * as catalogFns from '../../editor-core/src/engine/ui-catalog.js';
import * as modelFns from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';
import * as interaction from '../../editor-core/src/preview/ui-interaction-engine.js';
import * as targets from '../../editor-core/src/preview/ui-interaction-target.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { normalizePackPath } from '../../editor-core/src/path/normalize-pack-path.js';
import { requestNodeFramePayload } from '../../editor-core/src/ui/node-frame-controller.js';
import { prepareNodeFrameFile } from '../../editor-core/src/engine/node-frame-wire.js';

test('navigation uses actual HTTP and Worker through first layout before atomic commit', { timeout:120000 }, async() => {
  const app = await createLocalServer({ port:0 }), realFetch = globalThis.fetch;
  const routes = [], output = { method:'実mainの操作・遷移処理、実HTTP/Node Workerのcatalog/project/validate/frame。DOM表示は代替。', cases:[] };
  const existingWindow = globalThis.window;
  globalThis.window = {};
  globalThis.fetch = (url, options) => { const absolute = new URL(url, `http://127.0.0.1:${app.port}/`); routes.push(absolute.pathname); return realFetch(absolute, options); };
  try {
    const remote = await import('../../editor-core/src/pack-io/node-remote-client.js');
    const files = {
      'ui/origin.json':JSON.stringify({ namespace:'test', origin:{ type:'screen', size:[200,100], controls:[{ go:{ type:'button', size:[60,20], anchor_from:'top_left', anchor_to:'top_left', button_mappings:[{ from_button_id:'button.menu_select', to_button_id:'button.open_target', mapping_type:'pressed' }] } }] } }),
      'ui/common.json':JSON.stringify({ namespace:'shared', base:{ type:'screen', size:[200,100], controls:[{ title:{ type:'label', text:'別ファイル継承先の表示', size:[150,20] } }] } }),
      'ui/target.json':JSON.stringify({ namespace:'test', 'target@shared.base':{} }),
      'ui/how_to_play_screen.json':JSON.stringify({ namespace:'how_to_play', how_to_play_screen:{ type:'screen', controls:[{ title:{ type:'label', text:'遊び方' } }] } }),
      'ui/multi.json':JSON.stringify({ namespace:'multi', first:{ type:'screen', size:[100,80], controls:[{ title:{ type:'label', text:'第一' } }, { picture:{ type:'image', texture:'textures/first', size:[12,12] } }] }, second:{ type:'screen', size:[180,90], controls:[{ title:{ type:'label', text:'第二' } }, { picture:{ type:'image', texture:'textures/second', size:[24,24] } }] } }),
      'ui/encyclopedia.json':JSON.stringify({ namespace:'encyclopedia', anvil_section:{ type:'panel', visible:false, size:[180,90], controls:[{ title:{ type:'label', text:'金床の説明' } }] } }),
      'ui/duplicate.json':JSON.stringify({ namespace:'dup', 'same@shared.base':{}, 'same@test.target':{} }),
      'ui/shadow_a.json':JSON.stringify({ namespace:'shadow', same:{ type:'screen', controls:[{ marker:{ type:'label', text:'A' } }] } }),
      'ui/shadow_b.json':JSON.stringify({ namespace:'shadow', same:{ type:'screen', controls:[{ marker:{ type:'label', text:'B' } }] } }),
      'ui/pocket/blocked.json':JSON.stringify({ namespace:'pocket', blocked:{ type:'screen' } }),
    };
    files['ui/_ui_defs.json'] = JSON.stringify({ ui_defs:Object.keys(files) });
    const packBytes = makeZip({ 'manifest.json':manifest, ...files });
    // 再帰試験は旧版の資料を書き換えない。明示された今回の出力先だけへ保存する。
    if (process.env.JSONUI_NAVIGATION_FIXTURE_EVIDENCE) {
      await writeFile(process.env.JSONUI_NAVIGATION_FIXTURE_EVIDENCE, packBytes);
    }
    const runtime = await remote.tryNodeImport(new File([packBytes], 'navigation-integration.zip', { type:'application/zip' }));
    const catalog = await remote.buildNodeCatalog(runtime, null);
    const prepare = () => {
      const h = setup(), s = h.sandbox;
      Object.assign(s, { ...catalogFns, ...modelFns, buildTreeFromUiScreenModel, parseJsonc, normalizePackPath,
        resolveNodeUi:remote.resolveNodeUi, nodeValidatePreview:remote.nodeValidatePreview, renderNodeFrame:remote.renderNodeFrame,
        requestNodeFramePayload, prepareNodeFrameFile, evaluateBindingsForUiModel, computeLayoutBoxesForFile,
        readImportedPackText:path => runtime.zipReader.readText(runtime.rootPrefix + path), importedPackRuntime:runtime, vanillaReferenceRuntime:null });
      s.uiCatalogState.catalog = catalog;
      return h;
    };
    const move = (h, packPath, qualifiedName, extra = {}) => h.sandbox.api.navigatePreviewEffect({ fileId:`screen:${packPath}`, definition:qualifiedName, ...extra }, h.state.files.byId[h.state.files.currentFileId]);
    const current = h => h.state.files.byId[h.state.files.currentFileId];
    const record = (name, detail = {}) => output.cases.push({ name, status:'PASS', ...detail });
    {
      const h = prepare(), s = h.sandbox;
      const model = modelFns.buildUiScreenModelFromJson(JSON.parse(files['ui/origin.json']), { filePath:'ui/origin.json' }), tree = buildTreeFromUiScreenModel(model);
      Object.assign(h.origin, { uiModel:model, rootId:tree.rootId, nodesById:tree.nodesById });
      const evaluated = evaluateBindingsForUiModel(model, { mockData:{}, collectionData:{} });
      const layout = computeLayoutBoxesForFile(tree, { width:200, height:100 }, { propsByIdOverride:evaluated.propsById });
      const context = { enabled:true, pocket:false, state:h.state, file:h.origin, model, nodesById:tree.nodesById, propsById:evaluated.propsById, boxes:layout.boxes,
        mockData:{}, collectionData:{}, actionMap:{ 'button.open_target':'screen:ui/target.json' }, availableScreenPaths:Object.keys(files), screenDefinition:'test.origin' };
      const hit = targets.hitTestUiInteraction(context, 10, 10); assert(hit);
      Object.assign(s, { ...interaction, ...targets, getInteractionPreviewContext:() => context,
        document:{ getElementById:() => null }, hidePreviewEditBoxOverlay(){}, diagnostics:{ log(){} }, previewAudioSequence:0, buildPreviewAudioIntent:() => null });
      const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
      vm.runInContext(part('function commitPreviewInteractionEffects(', 'let previewNavigationEpoch = 0;')
        + part('function presentPreviewInteractionResult(', 'function getInteractionHitProps(')
        + part('function interactionTarget(', 'function renderPreviewOperationCapabilities('), s);
      let pending; const navigate = s.navigatePreviewEffect; s.navigatePreviewEffect = (...args) => (pending = navigate(...args));
      s.activatePreviewHit(h.origin.id, hit); assert(pending); assert.equal(await pending, true);
      assert.equal(current(h).meta.selectedDefinition.qualifiedName, 'test.target');
      assert(current(h).modelOutputText.includes('別ファイル継承先の表示'));
      assert(h.canvas.get(current(h).id).layout.boxes.some(box => box.type === 'label'));
      assert.equal(h.events.filter(event => event.type === 'preview/navCommit').length, 1);
      assert.equal(h.events.filter(event => event.type === 'files/openFile').length, 0);
      record('実クリック→旧単一定義mapping→別ファイル継承→初回frame→一括commit');
    }
    {
      const h = prepare();
      const help = interaction.resolveUiInteraction({ enabled:true, node:{ type:'button', props:{ button_mappings:[{ from_button_id:'button.menu_select', to_button_id:'button.help', mapping_type:'pressed' }] } }, availableScreenPaths:Object.keys(files) });
      const choice = help.effects[0].candidates.find(item => item.definition === 'how_to_play.how_to_play_screen');
      assert(choice); assert.equal(await h.sandbox.api.navigatePreviewEffect(choice, h.origin), true);
      assert(current(h).modelOutputText.includes('遊び方'));
      record('未open Helpの実qualifiedName選択');
    }
    {
      const h = prepare();
      assert.equal(await move(h, 'ui/multi.json', 'multi.first'), true);
      assert(current(h).modelOutputText.includes('textures/first'));
      assert.equal(await move(h, 'ui/multi.json', 'multi.second'), true);
      assert(current(h).modelOutputText.includes('textures/second')); assert(!current(h).modelOutputText.includes('textures/first'));
      const secondFile = current(h), secondBoxes = h.canvas.get(secondFile.id).layout.boxes;
      assert(secondBoxes.some(box => box.w === 180), JSON.stringify(secondBoxes));
      assert.equal(await move(h, 'ui/target.json', 'test.target'), true);
      const savedLength = h.state.preview.navigation.stack.length;
      const ref = h.state.preview.navigation.stack[2]; assert.equal(ref.qualifiedName, 'multi.second');
      assert.equal(await h.sandbox.api.navigateToScreenFile(ref, 'setIndex', 2), true);
      assert.equal(current(h), secondFile); assert.equal(h.state.preview.navigation.index, 2);
      assert.equal(h.state.preview.navigation.stack.length, savedLength);
      assert.equal(await h.sandbox.api.navigateToScreenFile(h.state.preview.navigation.stack[1], 'setIndex', 1), true);
      assert(current(h).modelOutputText.includes('第一'));
      assert.equal(await h.sandbox.api.navigateToScreenFile(h.state.preview.navigation.stack[2], 'setIndex', 2), true);
      assert(current(h).modelOutputText.includes('第二'));
      record('同一ファイル第一→第二→別ファイル→既存高速経路→戻る・進む', { historyLength:savedLength });
    }
    {
      const h = prepare(); const origin = current(h);
      assert.equal(await move(h, 'ui/multi.json'), false);
      assert.equal(h.sandbox.screenOpenState.error, 'UI_NAVIGATION_DEFINITION_REQUIRED');
      assert.equal(current(h), origin); assert.equal(h.state.preview.navigation.stack.length, 0);
      assert.equal(await move(h, 'ui/duplicate.json', 'dup.same'), false);
      assert.equal(h.sandbox.screenOpenState.error, 'UI_DEFINITION_AMBIGUOUS');
      assert.equal(await move(h, 'ui/pocket/blocked.json', 'pocket.blocked'), false);
      assert.equal(current(h), origin);
      record('旧複数定義・重複qualifiedName・Pocketを元画面保持で拒否');
    }
    {
      const h = prepare();
      assert.equal(await move(h, 'ui/encyclopedia.json', 'encyclopedia.anvil_section', { previewTopic:true }), true);
      const cs = h.canvas.get(current(h).id); assert(cs.previewTopicRootId); assert.equal(cs.previewTopicReturn.qualifiedName, 'test.origin');
      assert(h.state.preview.navigation.stack[1].returnTo);
      assert.equal(await h.sandbox.api.navigateToScreenFile(cs.previewTopicReturn, 'push'), true);
      assert.equal(current(h).meta.selectedDefinition.qualifiedName, 'test.origin');
      assert.equal(await h.sandbox.api.navigateToScreenFile(h.state.preview.navigation.stack[1], 'setIndex', 1), true);
      assert.equal(h.canvas.get(current(h).id).previewTopicReturn.qualifiedName, 'test.origin');
      record('topic表示・元UI復帰・履歴からtopic復元');
    }
    {
      const h = prepare(), before = current(h);
      // Send a deliberately stale projection ID through the real HTTP client;
      // the Node server owns the rejection and no successful frame is faked.
      h.sandbox.renderNodeFrame = payload => remote.renderNodeFrame({ ...payload, projectionId:'0'.repeat(64) });
      assert.equal(await move(h, 'ui/target.json', 'test.target'), false);
      assert.equal(current(h), before); assert.equal(h.state.preview.navigation.stack.length, 0);
      assert.equal(h.sandbox.navigationUiState.lastResolution.stage, 'first-frame');
      record('実HTTPの失効projection拒否で初回frameが失敗しても部分commit・履歴更新なし');
    }
    {
      const h = prepare(); let release, reached;
      const gate = new Promise(resolve => release = resolve), gateReached = new Promise(resolve => reached = resolve);
      const read = h.sandbox.readImportedPackText;
      h.sandbox.readImportedPackText = async path => { if (path === 'ui/target.json') { reached(); await gate; } return read(path); };
      const old = move(h, 'ui/target.json', 'test.target'); await gateReached;
      const latest = move(h, 'ui/multi.json', 'multi.second');
      assert.equal(await old, false); assert.equal(await latest, true); release();
      assert.equal(current(h).meta.selectedDefinition.qualifiedName, 'multi.second');
      assert.equal(h.events.filter(event => event.type === 'preview/navCommit').length, 1);
      record('別要求がHTTP読込中の古い要求を取り消し、最新定義だけcommit');
    }
    {
      const h = prepare(), before = current(h);
      const winner = catalog.symbols['shadow.same'].winnerId;
      const loser = catalog.records.find(item => item.qualifiedName === 'shadow.same' && item.id !== winner);
      assert(loser); assert.equal(await move(h, loser.filePath, 'shadow.same'), false);
      assert.equal(h.sandbox.screenOpenState.error, 'UI_NAVIGATION_PATH_MISMATCH');
      assert.equal(current(h), before);
      record('別ファイルの実効symbol winnerと参照が不一致なら推測遷移を拒否');
    }
    output.routes = [...new Set(routes)]; output.assertions = 'PASS';
    assert(output.routes.some(route => /\/catalog(?:\/|$)/u.test(route)));
    assert(output.routes.some(route => /\/frame$/u.test(route)));
    // Evidence belongs to the current run. Ordinary regression tests must not
    // rewrite the immutable report bundled with a previous release.
    if (process.env.JSONUI_NAVIGATION_EVIDENCE) {
      await writeFile(process.env.JSONUI_NAVIGATION_EVIDENCE, JSON.stringify(output, null, 2) + '\n');
    }
  } finally {
    globalThis.fetch = realFetch;
    if (existingWindow === undefined) delete globalThis.window; else globalThis.window = existingWindow;
    await app.close();
  }
});
