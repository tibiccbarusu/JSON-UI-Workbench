// ブラウザー ESM。Node が解釈・配置した草稿を描画データへ接続する。
// 原文、store 内の確定 file、Node の配置・バインディング計算結果を変更しない。
import { buildUiScreenModelFromJson } from '../model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor/ui-model-tree.js';
import { applyPendingLayout21, mergePendingProperties21 } from './editor-draft-layout21.js';
const localName = value => String(value || '').split('@', 1)[0];
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

/** Node の配置に対応する軽量モデルを1応答につき1回作成する。再描画ごとには呼ばない。 */
export function buildWorkspaceDraftScene23({ file, result, additions = [], transforms = new Map(), basePropsByIdOverride = {} } = {}) {
  if (!file?.id || !result?.ok || result.committed !== false
    || !result.projection?.document || result.frame?.schema !== 'jsonui-frame-v1'
    || !Array.isArray(result.frame?.layout?.boxes) || result.frame.layout.boxes.length > 50000) {
    fail('WORKSPACE_DRAFT_SCENE_INVALID', '草稿プレビューの表示データが不正です。変更を確認して再計算してください。');
  }
  const uiModel = buildUiScreenModelFromJson(result.projection.document, { filePath: file.path });
  const tree = buildTreeFromUiScreenModel(uiModel);
  const seen = new Set();
  for (const box of result.frame.layout.boxes) {
    if (!box || typeof box.id !== 'string' || !tree.nodesById[box.id] || seen.has(box.id)
      || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(box[key]))) {
      fail('WORKSPACE_DRAFT_SCENE_NODE_INVALID', '草稿の要素と配置が一致しません。再計算してください。');
    }
    seen.add(box.id);
  }
  const additionsByNodeId = new Map();
  for (const addition of additions) {
    const parentId = addition.previewSelection?.nodeId;
    const parent = tree.nodesById[parentId];
    if (!parent || addition.previewSelection?.fileId !== file.id) continue;
    const candidates = (parent.children || []).filter(id => localName(tree.nodesById[id]?.props?.name) === localName(addition.operation?.name));
    // 名前だけで別の親や生成済みの複製へ編集を接続しない。
    if (candidates.length === 1 && !file.nodesById?.[candidates[0]]) additionsByNodeId.set(candidates[0], addition.id);
  }
  return { baseFile: file, file: { ...file, uiModel, ...tree, meta: { ...file.meta,
    resolution: { ...file.meta?.resolution, nodeSources: result.projection.nodeSources },
    pendingDraft23: true } }, layout: result.frame.layout, propsByIdOverride: result.frame.propsById || {},
    additionsByNodeId, baseRevision: result.baseRevision, pendingVersion: result.pendingVersion,
    transformsAtBuild: transforms, additionsAtBuild: additions, basePropsByIdOverride,
    metrics: result.metrics, warnings: result.frame.warnings || [] };
}

/** 次のNode応答を待つ間も、直前の草稿上で移動・削除・表示属性を保持する。再解釈はしない。 */
export function advanceWorkspaceDraftScene23(scene, { transforms = new Map(), additions = [] } = {}) {
  const changes = new Map(), own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  for (const id of new Set([...scene.transformsAtBuild.keys(), ...transforms.keys()])) {
    if (!scene.file.nodesById[id]) continue;
    const before = scene.transformsAtBuild.get(id) || {}, after = transforms.get(id) || {};
    const properties = {}, baseline = { ...scene.baseFile.nodesById[id]?.props, ...scene.basePropsByIdOverride?.[id] };
    for (const key of new Set([...Object.keys(before.properties || {}), ...Object.keys(after.properties || {})])) {
      const value = own(after.properties, key) ? after.properties[key] : baseline[key];
      if (value !== undefined && JSON.stringify(value) !== JSON.stringify(before.properties?.[key])) properties[key] = value;
    }
    const offsetChanged = own(before.properties, 'offset') || own(after.properties, 'offset');
    if (offsetChanged) properties.offset = after.properties?.offset ?? baseline.offset ?? [0, 0];
    changes.set(id, { dx: (after.dx || 0) - (offsetChanged ? 0 : before.dx || 0),
      dy: (after.dy || 0) - (offsetChanged ? 0 : before.dy || 0), deleted: after.deleted === true, properties });
  }
  const activeAdditions = new Map(additions.map(addition => [addition.id, addition]));
  for (const [nodeId, pendingId] of scene.additionsByNodeId) {
    const addition = activeAdditions.get(pendingId);
    changes.set(nodeId, addition ? { dx: 0, dy: 0, properties: addition.operation.value }
      : { dx: 0, dy: 0, deleted: true, properties: {} });
  }
  const context = { nodesById: scene.file.nodesById, propsByIdOverride: scene.propsByIdOverride };
  return { ...scene, layout: applyPendingLayout21(scene.layout, changes, context),
    propsByIdOverride: mergePendingProperties21(scene.propsByIdOverride, changes) };
}

/** 新規要素のドラッグを画面の実効座標差から有限 delta へ変換し、キューだけ更新する。 */
export function moveWorkspaceDraftAddition23(controller, scene, nodeId, startBox, endBox) {
  const id = scene?.additionsByNodeId?.get(nodeId);
  if (!id || scene.pendingVersion !== controller.state.pendingVersion || scene.baseRevision !== controller.state.revision) {
    fail('WORKSPACE_DRAFT_ADDITION_STALE', '追加予定の要素の表示が変わりました。再計算後に選び直してください。');
  }
  const delta = ['x', 'y'].map(axis => {
    if (!Number.isFinite(startBox?.[axis]) || !Number.isFinite(endBox?.[axis])) fail('WORKSPACE_DRAFT_ADDITION_POSITION_INVALID', '移動前後の位置を確認できません。');
    const value = endBox[axis] - startBox[axis];
    if (!Number.isFinite(value)) fail('WORKSPACE_DRAFT_ADDITION_POSITION_INVALID', '移動量を確認できません。');
    return Math.round(value * 1000) / 1000;
  });
  return controller.editPendingAddition(id, { type: 'move', delta });
}
