/** Real main navigation/open functions; deterministic I/O gates, DOM rendering omitted. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createLocalToggleState, normalizeLocalToggleState } from '../../src/preview/local-toggle-state.js';
import { installStudioMainBoundaries22 } from './studio-main-boundaries22.mjs';
import { readFile } from 'node:fs/promises';
import * as navigation from '../../src/preview/screen-navigation.js';
import { selectUiDefinition } from '../../src/engine/ui-catalog.js';
import { appReducer, actions, createInitialState } from '../../src/state-store/app-store.js';
export const source = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
const section = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); assert(a >= 0 && b > a); return source.slice(a, b); };
const code = section('function ensureLocalToggleSession40(', '\nfunction ')
  + section('async function ensureScreenFileOpen(', '// 0.6: 操作の状態更新')
  + section('let previewNavigationEpoch = 0;', 'function presentPreviewInteractionResult(')
  + section('async function openUiScreenFromImportedPack(', '/** Re-resolve the current projection');
export function setup({ fast = false, gateStage = 'read', targetId = 'screen:ui/target.json', targetDefinition = 'test.target' } = {}) {
  const origin = { id:'screen:ui/origin.json', path:'ui/origin.json', kind:'screen', readOnly:true, uiModel:{ root:{ children:[{ id:'old' }] } }, meta:{ previewProjection:true, previewProjectionInstanceId:'origin-1', selectedDefinition:{ recordId:'origin-record', qualifiedName:'test.origin' } } };
  const target = { id:targetId, path:targetId.slice(7), kind:'screen', readOnly:true, uiModel:{ root:{ children:[{ id:'root/target' }] } }, meta:{ previewProjection:true, previewProjectionInstanceId:'target-1', navigationCatalogGeneration:1, selectedDefinition:{ recordId:'record', qualifiedName:targetDefinition } } };
  const imported = { id:'pack' };
  const state = { ...createInitialState(), files:{ currentFileId:origin.id, openFileIds:[origin.id], byId:{ [origin.id]:origin } }, pack:{ imported }, preview:{ navigation:{ enabled:true, stack:[], index:-1, actionMap:{} }, mockData:{} } };
  if (fast) { state.files.byId[target.id] = target; state.files.openFileIds.push(target.id); }
  const listeners = new Set(), events = [], notices = [], canvas = new Map();
  const dispatch = action => {
    const previous = { ...state }; events.push(action);
    if (action.type === 'files/replaceModel') state.files.byId[origin.id].uiModel = { root:{ children:[] } };
    else if (action.type === 'pack/replace') state.pack.imported = { id:'new-pack' };
    else if (action.type === 'files/setCurrentFile' && action.fileId === 'other') state.files.currentFileId = 'other';
    else Object.assign(state, appReducer(state, action));
    for (const listener of [...listeners]) listener(state, previous, action);
  };
  let release, reached;
  const readGate = new Promise(resolve => release = resolve), gateReached = new Promise(resolve => reached = resolve);
  const awaitGate = async stage => { if (gateStage === stage) { reached(); await readGate; } };
  const selected = { id:'record', rawKey:targetDefinition.split('.').at(-1), filePath:targetId.slice(7), qualifiedName:targetDefinition, localName:targetDefinition.split('.').at(-1), profile:'classic', sourceKind:'imported' };
  const catalog = { nodeCatalogId:'catalog' };
  const sandbox = { ...navigation, selectUiDefinition, AbortController, setTimeout, clearTimeout, crypto:webcrypto, createLocalToggleState, normalizeLocalToggleState,
    store:{ getState:() => state, dispatch, subscribe:fn => { listeners.add(fn); return () => listeners.delete(fn); } }, actions,
    getCanvasKey:x => x, getCanvasState:key => { if (!canvas.has(key)) canvas.set(key, { previewClosed:false }); return canvas.get(key); },
    getSelectedPreviewQualifiedName:f => f?.meta?.selectedDefinition?.qualifiedName || '',
    screenFileIdToPackPath:id => id.startsWith('screen:') ? id.slice(7) : null, makeScreenFileId:path => `screen:${path}`,
    screenOpenState:{ generation:0, status:'ready', error:null }, uiCatalogState:{ generation:1, status:'ready', catalog },
    importedPackRuntime:{}, vanillaReferenceRuntime:{}, projectionRefreshRunning:false, drainProjectionRefreshQueue(){}, safeRender(){}, setStatus:message => notices.push(message), normalizePackPath:x => x,
    runtimeStateEditor:{ dirty:false }, navigationUiState:{}, resourcePackMutationEpoch:0, invalidatePreviewAudioForNavigation(){}, getLogicalCanvasPreset:() => ({ width:200, height:100 }),
    readPreviewProjectionIdentity:f => f?.meta?.previewProjectionInstanceId ? { fileId:f.id, instanceId:f.meta.previewProjectionInstanceId } : null,
    isOpenPreviewProjectionIdentity:(s, id) => s.files.openFileIds.includes(id.fileId) && s.files.byId[id.fileId]?.meta?.previewProjectionInstanceId === id.instanceId,
    listEffectiveDefinitionsForPath:() => [selected],
    readImportedPackText:async() => { await awaitGate('read'); return '{}'; }, readVanillaReferenceText:async() => { await awaitGate('read'); return '{}'; }, parseJsonc:() => ({ ok:true, value:{} }),
    buildRepresentativeClassicResolverVariables:() => ({}), buildRepresentativeClassicCollections:() => ({}),
    resolveNodeUi:async() => { await awaitGate('resolve'); return { ok:true, document:{}, selected:{ recordId:'record', qualifiedName:targetDefinition }, nodeProjectionId:'projection' }; },
    findCatalogFile:() => null, findAnyCatalogFile:() => null, buildUiScreenModelFromJson:() => target.uiModel,
    buildTreeFromUiScreenModel:() => ({ rootId:'root', nodesById:{}, stats:{ nodeCount:1, maxDepth:1 } }),
    nodeValidatePreview:async() => { await awaitGate('validate'); return { validation:{ status:'PASS' } }; }, uiScreenModelToJsonText:() => '{ }', summarizeUiScreenModel:() => ({}), uuidv4:() => 'new-instance',
    requestNodeFramePayload:async input => { await awaitGate('frame'); return { schema:'jsonui-frame-v1', generation:input.generation, uiInstanceId:input.uiInstanceId, bindings:{localToggleState:input.localToggleState}, layout:{ boxes:[{ id:'root/target' }] } }; },
    renderNodeFrame(){}, prepareNodeFrameFile:x => x, evaluateBindingsForUiModel:() => ({ propsById:{} }), computeLayoutBoxesForFile:() => ({ boxes:[{ id:'root/target' }] }),
  };
  vm.createContext(sandbox);
  installStudioMainBoundaries22(sandbox, source);
  vm.runInContext(code + '\nglobalThis.api={navigatePreviewEffect,ensureScreenFileOpen,navigateToScreenFile,ensureLocalToggleSession40};', sandbox);
  const start = effect => sandbox.api.navigatePreviewEffect(effect || { fileId:targetId, definition:targetDefinition }, origin);
  return { sandbox, state, origin, target, events, notices, listeners, canvas, dispatch, start, release, gateReached };
}
