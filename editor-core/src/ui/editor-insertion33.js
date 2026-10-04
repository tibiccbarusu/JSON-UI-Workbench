/** 挿入先は現在プレビュー中の定義内に限定する。別ファイルや別定義を探索しない。 */
const containers = new Set(['panel', 'input_panel', 'button', 'screen']);
const flow = new Set(['stack_panel', 'grid', 'factory']);
const childId = child => typeof child === 'string' ? child : child?.id;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

/** 選択なしは現在の画面、画像/文字選択中は最寄りの親へ挿入する。 */
export function insertionParent33({ nodesById, selectedId, screenId, relation = 'inside' }) {
  if (!['inside', 'sibling'].includes(relation)) fail('WORKSPACE_ADD_RELATION_INVALID', '追加先の方式を選び直してください。');
  if (!nodesById || !nodesById[screenId]) fail('WORKSPACE_ADD_PARENT_REQUIRED', '追加する UI を先にプレビューしてください。');
  const parentIds = new Map();
  for (const [id, node] of Object.entries(nodesById)) for (const child of node.children || []) parentIds.set(childId(child), id);
  const parent = id => nodesById[id]?.parentId || parentIds.get(id);
  let id = selectedId && nodesById[selectedId] ? selectedId : screenId;
  const chain = new Set(); let cursor = id;
  while (cursor && cursor !== screenId) {
    if (chain.has(cursor)) fail('WORKSPACE_ADD_PARENT_CYCLE', '追加先の親子関係が循環しています。');
    chain.add(cursor); cursor = parent(cursor);
  }
  if (cursor !== screenId) fail('WORKSPACE_ADD_PARENT_REQUIRED', '現在表示中の UI 内で追加先を選んでください。');
  if (relation === 'sibling' && id !== screenId) id = parent(id);
  while (id) {
    const node = nodesById[id];
    if (flow.has(node.type)) fail('WORKSPACE_ADD_FLOW_LAYOUT', '選択先は自動配置です。要素一覧で自由配置できる親パネルを選んでください。');
    if (containers.has(node.type)) return node;
    if (id === screenId) break;
    id = parent(id);
  }
  fail('WORKSPACE_ADD_PARENT_REQUIRED', '追加できる親パネルを選んでください。');
}

/** クリック挿入の初期サイズ。ボタンの表示文字は label 子要素に持たせる。 */
export function newElementValue33(type, position) {
  if (!['panel', 'label', 'image', 'button'].includes(type)) fail('WORKSPACE_ADD_TYPE_INVALID', '追加する種類が未対応です。');
  if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)) fail('WORKSPACE_ADD_POSITION_INVALID', '追加位置が不正です。');
  const value = { type, anchor_from: 'top_left', anchor_to: 'top_left', size: [100, 40], offset: position.map(n => Math.round(n * 100) / 100) };
  if (type === 'label') Object.assign(value, { text: '新しいラベル', size: [100, 20], color: [1, 1, 1] });
  if (type === 'button') value.controls = [{ caption: { type: 'label', text: 'ボタン', anchor_from: 'center', anchor_to: 'center', size: ['100%', '100%'], color: [1, 1, 1] } }];
  return value;
}
