/** ブラウザ ESM。選択・グループだけを保持し、DOM・原文・通信を変更しない。 */
const METADATA_SCHEMA = 'jsonui-editor-groups-v1';
const MAX_NODES = 50000;
const MAX_GROUPS = 5000;
const MAX_ID_LENGTH = 4096;

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function requireId(value, label) {
  if (!validId(value)) throw new TypeError(`${label} は空でない ${MAX_ID_LENGTH} 文字以内の文字列が必要です。`);
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} は ${minimum} 以上 ${maximum} 以下の整数が必要です。`);
  }
  return value;
}

function copyGroups(groups) {
  return new Map([...groups].map(([id, group]) => [id, { id, name: group.name, members: [...group.members] }]));
}

function captureState(state) {
  return { selected: new Set(state.selected), groups: copyGroups(state.groups) };
}

function emptyState(identity) {
  return { identity, index: null, selected: new Set(), groups: new Map(), groupIndex: null,
    nextGroupNumber: 1, undo: [], redo: [] };
}

function buildIndex(file) {
  const nodes = file?.nodesById;
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) {
    throw new TypeError('選択対象には file.nodesById が必要です。');
  }
  const entries = Object.entries(nodes);
  if (entries.length > MAX_NODES) throw new RangeError(`選択索引の上限 ${MAX_NODES} 要素を超えています。`);
  const ids = new Set(entries.map(([id]) => requireId(id, '要素 ID')));
  const selectable = new Set();
  const parent = new Map();
  function setParent(id, parentId) {
    if (!ids.has(id) || !ids.has(parentId)) return;
    if (parent.has(id) && parent.get(id) !== parentId) throw new Error(`要素 ${id} に複数の親があります。`);
    parent.set(id, parentId);
  }
  let edges = 0;
  for (const [id, node] of entries) {
    if (!node || typeof node !== 'object') continue;
    if (node.isFileRoot !== true && id !== file.rootId) selectable.add(id);
    if (validId(node.parentId)) setParent(id, node.parentId);
    if (!Array.isArray(node.children)) continue;
    edges += node.children.length;
    if (edges > MAX_NODES * 2) throw new RangeError('親子参照の上限を超えています。');
    for (const child of node.children) {
      const childId = typeof child === 'string' ? child : child?.id;
      if (validId(childId)) setParent(childId, id);
    }
  }
  // 色付けで一度ずつ辿り、循環を黙って誤処理しない。
  const done = new Set();
  for (const id of ids) {
    const path = new Set();
    let cursor = id;
    while (cursor && !done.has(cursor)) {
      if (path.has(cursor)) throw new Error(`親子参照が循環しています: ${cursor}`);
      path.add(cursor);
      cursor = parent.get(cursor);
    }
    for (const member of path) done.add(member);
  }
  return { ids, selectable, parent };
}

function rootsFromIndex(ids, index) {
  const selected = new Set([...ids].filter(id => index.selectable.has(id)));
  const selectedAncestor = new Map();
  function hasSelectedAncestor(id) {
    const path = [];
    let cursor = index.parent.get(id);
    let found = false;
    while (cursor) {
      if (selected.has(cursor)) { found = true; break; }
      if (selectedAncestor.has(cursor)) { found = selectedAncestor.get(cursor); break; }
      path.push(cursor);
      cursor = index.parent.get(cursor);
    }
    for (const parentId of path) selectedAncestor.set(parentId, found);
    return found;
  }
  return [...selected].filter(id => !hasSelectedAncestor(id));
}

function reconcileState(state) {
  if (!state.index) return;
  const valid = state.index.selectable;
  state.selected = new Set([...state.selected].filter(id => valid.has(id)));
  const occupied = new Set();
  const groups = new Map();
  for (const [id, group] of state.groups) {
    const members = rootsFromIndex(group.members.filter(member => !occupied.has(member)), state.index);
    if (members.length < 2) continue;
    for (const member of members) occupied.add(member);
    groups.set(id, { id, name: group.name, members });
  }
  state.groups = groups;
  state.groupIndex = null;
}

function normalizedRect(rect) {
  if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) {
    throw new TypeError('選択範囲には有限の数値 x, y, w, h が必要です。');
  }
  return { x: Math.min(rect.x, rect.x + rect.w), y: Math.min(rect.y, rect.y + rect.h),
    w: Math.abs(rect.w), h: Math.abs(rect.h) };
}

function visibleBox(box, viewport) {
  if (!box || box.visible === false || ![box.x, box.y, box.w, box.h].every(Number.isFinite)
    || box.w <= 0 || box.h <= 0) return null;
  let region = { x: box.x, y: box.y, w: box.w, h: box.h };
  for (const clip of [box.clipRect, viewport]) {
    if (clip == null) continue;
    if (![clip.x, clip.y, clip.w, clip.h].every(Number.isFinite) || clip.w <= 0 || clip.h <= 0) return null;
    const x = Math.max(region.x, clip.x), y = Math.max(region.y, clip.y);
    const right = Math.min(region.x + region.w, clip.x + clip.w), bottom = Math.min(region.y + region.h, clip.y + clip.h);
    if (!Number.isFinite(right) || !Number.isFinite(bottom) || right <= x || bottom <= y) return null;
    region = { x, y, w: right - x, h: bottom - y };
  }
  return region;
}

function matchingBox(rect, box, mode, viewport) {
  const visible = visibleBox(box, viewport);
  if (!visible) return false;
  if (mode === 'contain') return visible.x >= rect.x && visible.y >= rect.y
    && visible.x + visible.w <= rect.x + rect.w && visible.y + visible.h <= rect.y + rect.h;
  return visible.x < rect.x + rect.w && visible.x + visible.w > rect.x
    && visible.y < rect.y + rect.h && visible.y + visible.h > rect.y;
}

/** Canvasの見えるworld範囲とゲーム表示範囲の共通部分。DOMは呼出側が測定する。 */
export function marqueeViewport21({ view, canvasWidth, canvasHeight, logicalWidth, logicalHeight }) {
  const values = [view?.viewX, view?.viewY, view?.zoom, canvasWidth, canvasHeight, logicalWidth, logicalHeight];
  if (!values.every(Number.isFinite) || view.zoom <= 0 || canvasWidth < 0 || canvasHeight < 0 || logicalWidth <= 0 || logicalHeight <= 0) {
    throw new TypeError('範囲選択のCanvas寸法・ズーム・ゲーム寸法が不正です。');
  }
  const right = view.viewX + canvasWidth / view.zoom;
  const bottom = view.viewY + canvasHeight / view.zoom;
  if (![right, bottom].every(Number.isFinite)) throw new TypeError('範囲選択の表示座標が有限ではありません。');
  const x = Math.max(0, view.viewX), y = Math.max(0, view.viewY);
  return { x, y, w: Math.max(0, Math.min(logicalWidth, right) - x), h: Math.max(0, Math.min(logicalHeight, bottom) - y) };
}

/** 親子を同時選択した場合、移動は最上位の選択要素に一度だけ適用する。 */
export function movementRootIds21(selectedIds, file) {
  if (!Array.isArray(selectedIds) || selectedIds.length > MAX_NODES) throw new TypeError('selectedIds は上限内の配列が必要です。');
  return rootsFromIndex(selectedIds, buildIndex(file));
}

/**
 * 独立した画面ごとの選択状態を保持する。identity は呼出側で安定キーを渡す。
 * 再投影で変わる revision や複製後 pointer を identity に含めない。
 * @param {{maxScreens?: number, historyLimit?: number}} options
 * @returns {object} 入出力は JSON にできるコピー。変更は factory 内の名前付き状態だけ。
 */
export function createEditorSelection21({ maxScreens = 64, historyLimit = 100, evictUnmodified = false } = {}) {
  boundedInteger(maxScreens, 1, 512, 'maxScreens');
  boundedInteger(historyLimit, 1, 1000, 'historyLimit');
  const screens = new Map();
  const indexes = new WeakMap();
  let activeIdentity = null;

  function activeState() {
    const state = screens.get(activeIdentity);
    if (!state?.index) throw new Error('先に useScreen(identity, file) で画面を設定してください。');
    return state;
  }

  function groupFor(state, nodeId) {
    if (!state.groupIndex) {
      state.groupIndex = new Map();
      for (const group of state.groups.values()) {
        for (const member of group.members) state.groupIndex.set(member, group);
      }
    }
    // グループ化したパネル内部の描画部品をクリックした場合も、そのグループを選ぶ。
    // single=true は expandIds でこの探索自体を省略し、部品だけを選択する。
    let cursor = nodeId;
    while (cursor) {
      const group = state.groupIndex.get(cursor);
      if (group) return group;
      cursor = state.index.parent.get(cursor);
    }
    return null;
  }

  function expandIds(state, ids, single) {
    const out = new Set();
    for (const id of ids) {
      if (!state.index.selectable.has(id)) continue;
      const group = single ? null : groupFor(state, id);
      for (const member of group ? group.members : [id]) out.add(member);
    }
    return out;
  }

  function snapshot() {
    const state = screens.get(activeIdentity);
    const roots = state?.index ? rootsFromIndex(state.selected, state.index) : [];
    return { identity: activeIdentity, selectedIds: state ? [...state.selected] : [], movementRootIds: roots,
      groups: state ? [...copyGroups(state.groups).values()] : [],
      canGroup: roots.length >= 2, canUngroup: state ? [...state.groups.values()].some(group => group.members.some(id => state.selected.has(id))) : false,
      canUndoGroup: Boolean(state?.undo.length), canRedoGroup: Boolean(state?.redo.length) };
  }

  function recordGroupChange(state) {
    state.undo.push(captureState(state));
    if (state.undo.length > historyLimit) state.undo.shift();
    state.redo.length = 0;
  }

  function replaceSelection(state, ids, toggle) {
    if (!toggle) state.selected = new Set(ids);
    else {
      // 矩形には同じグループの複数要素が入るため、全候補を一度だけ反転する。
      for (const id of ids) {
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
      }
    }
    return snapshot();
  }

  return {
    /** file の nodesById は不変モデル。破壊的に変えた場合は新しい object を渡す。 */
    useScreen(identity, file) {
      requireId(identity, '画面 identity');
      if (!screens.has(identity) && screens.size >= maxScreens) {
        // 未設定の画面だけを解放する。グループとその履歴は自動破棄しない。
        const disposable = evictUnmodified && [...screens].find(([, state]) =>
          !state.groups.size && !state.undo.length && !state.redo.length);
        if (disposable) screens.delete(disposable[0]);
        else throw new RangeError('グループ設定を保持できる画面数の上限です。設定を保存してから不要な画面の設定を削除してください。');
      }
      const nodes = file?.nodesById;
      let cached = nodes && typeof nodes === 'object' ? indexes.get(nodes) : null;
      if (!cached || cached.rootId !== file.rootId) {
        cached = { rootId: file?.rootId, index: buildIndex(file) };
        indexes.set(nodes, cached);
      }
      const state = screens.get(identity) || emptyState(identity);
      state.index = cached.index;
      reconcileState(state);
      screens.set(identity, state);
      activeIdentity = identity;
      return snapshot();
    },

    /** toggle は追加選択、single はグループ内の個別選択。空白クリックは null。 */
    select(nodeId, { toggle = false, single = false } = {}) {
      const state = activeState();
      if (nodeId === null || nodeId === undefined) return toggle ? snapshot() : replaceSelection(state, [], false);
      if (!state.index.selectable.has(nodeId)) return snapshot();
      const unit = expandIds(state, [nodeId], single);
      if (toggle) {
        // グループの一部だけ選択中でも、Shift ではグループ全体を選択単位とする。
        const remove = [...unit].every(id => state.selected.has(id));
        for (const id of unit) {
          if (remove) state.selected.delete(id);
          else state.selected.add(id);
        }
        return snapshot();
      }
      return replaceSelection(state, unit, false);
    },

    setSelection(ids, { expandGroups = false } = {}) {
      if (!Array.isArray(ids) || ids.length > MAX_NODES) throw new TypeError('選択 ID は上限内の配列が必要です。');
      const state = activeState();
      return replaceSelection(state, expandIds(state, ids, !expandGroups), false);
    },

    /** rect と boxes は同じ座標系。描画済み・選択可能な boxes を呼出側が渡す。 */
    selectBox(rect, boxes, { toggle = false, single = false, mode = 'contain', viewport = null } = {}) {
      const region = normalizedRect(rect);
      if (viewport !== null && (!viewport || ![viewport.x, viewport.y, viewport.w, viewport.h, viewport.x + viewport.w, viewport.y + viewport.h].every(Number.isFinite) || viewport.w < 0 || viewport.h < 0)) {
        throw new TypeError('表示領域には有限な x/y と非負の w/h が必要です。');
      }
      const displayBounds = viewport;
      if (!['contain', 'intersect'].includes(mode)) throw new TypeError('矩形選択 mode は contain または intersect が必要です。');
      if (!Array.isArray(boxes) || boxes.length > MAX_NODES) throw new TypeError('boxes は上限内の配列が必要です。');
      const state = activeState();
      const hits = region.w > 0 && region.h > 0 ? boxes.filter(box => matchingBox(region, box, mode, displayBounds)).map(box => box.id) : [];
      if (toggle && !single) {
        const handled = new Set();
        for (const id of hits) {
          if (!state.index.selectable.has(id)) continue;
          const group = groupFor(state, id);
          const key = group ? `group:${group.id}` : `node:${id}`;
          if (handled.has(key)) continue;
          handled.add(key);
          const unit = group ? group.members : [id];
          const remove = unit.every(member => state.selected.has(member));
          for (const member of unit) {
            if (remove) state.selected.delete(member);
            else state.selected.add(member);
          }
        }
        return snapshot();
      }
      return replaceSelection(state, expandIds(state, hits, single), toggle);
    },

    /** 既存グループを含めたグループ化は一つの平坦なグループに統合する。 */
    groupSelected({ name = 'グループ' } = {}) {
      const state = activeState();
      if (typeof name !== 'string' || name.length > 256) throw new TypeError('グループ名は 256 文字以内の文字列が必要です。');
      if (rootsFromIndex(state.selected, state.index).length < 2) {
        throw new Error('グループ化するには独立した要素を 2 個以上選択してください。');
      }
      const members = rootsFromIndex(expandIds(state, state.selected, false), state.index);
      if (members.length < 2) throw new Error('グループ化するには独立した要素を 2 個以上選択してください。');
      const selected = new Set(members);
      const overlapIds = [...state.groups].filter(([, group]) => group.members.some(id => selected.has(id))).map(([id]) => id);
      if (state.groups.size - overlapIds.length >= MAX_GROUPS) throw new RangeError('グループ数の上限です。');
      recordGroupChange(state);
      for (const id of overlapIds) state.groups.delete(id);
      let id;
      do { id = `group-${state.nextGroupNumber++}`; } while (state.groups.has(id));
      state.groups.set(id, { id, name: name.trim() || 'グループ', members });
      state.groupIndex = null;
      state.selected = selected;
      return { groupId: id, ...snapshot() };
    },

    /** 選択に含まれるグループを解除し、解除した構成要素を個別選択にする。 */
    ungroupSelected() {
      const state = activeState();
      const targets = [...state.groups].filter(([, group]) => group.members.some(id => state.selected.has(id)));
      if (!targets.length) return snapshot();
      recordGroupChange(state);
      for (const [id, group] of targets) {
        state.groups.delete(id);
        for (const member of group.members) state.selected.add(member);
      }
      state.groupIndex = null;
      return snapshot();
    },

    /** 原文編集の Undo とは別。UI 側は操作履歴の種類に応じて呼び分ける。 */
    undoGroup() {
      const state = activeState();
      if (!state.undo.length) return snapshot();
      state.redo.push(captureState(state));
      const previous = state.undo.pop();
      state.selected = previous.selected;
      state.groups = previous.groups;
      reconcileState(state);
      return snapshot();
    },

    redoGroup() {
      const state = activeState();
      if (!state.redo.length) return snapshot();
      state.undo.push(captureState(state));
      const next = state.redo.pop();
      state.selected = next.selected;
      state.groups = next.groups;
      reconcileState(state);
      return snapshot();
    },

    movementRoots() {
      const state = activeState();
      return rootsFromIndex(state.selected, state.index);
    },

    snapshot,

    /** 永続化は呼出側の担当。JSON UI リソースへ混入させない。 */
    exportMetadata() {
      return { schema: METADATA_SCHEMA, screens: [...screens.values()].map(state => ({
        identity: state.identity, selectedIds: [...state.selected], groups: [...copyGroups(state.groups).values()],
      })) };
    },

    /** 解析済み JSON を全件検証後にまとめて置換。保存済みの未知画面は useScreen 時に照合。 */
    importMetadata(data) {
      if (!data || data.schema !== METADATA_SCHEMA || !Array.isArray(data.screens) || data.screens.length > maxScreens) {
        throw new TypeError('グループメタデータの形式または画面数が不正です。');
      }
      const replacements = new Map();
      for (const row of data.screens) {
        const identity = requireId(row?.identity, '画面 identity');
        if (replacements.has(identity)) throw new Error('グループメタデータに画面 identity の重複があります。');
        if (!Array.isArray(row.groups) || row.groups.length > MAX_GROUPS
          || !Array.isArray(row.selectedIds) || row.selectedIds.length > MAX_NODES) {
          throw new TypeError('グループメタデータの配列または件数が不正です。');
        }
        const state = emptyState(identity);
        state.index = screens.get(identity)?.index || null;
        state.selected = new Set(row.selectedIds.map(id => requireId(id, '選択 ID')));
        const occupied = new Set();
        for (const value of row.groups) {
          const id = requireId(value?.id, 'グループ ID');
          if (state.groups.has(id) || typeof value.name !== 'string' || value.name.length > 256
            || !Array.isArray(value.members) || value.members.length < 2 || value.members.length > MAX_NODES) {
            throw new TypeError('グループ ID・名前・要素一覧が不正です。');
          }
          const members = value.members.map(member => requireId(member, '構成要素 ID'));
          for (const member of members) {
            if (occupied.has(member)) throw new Error('複数のグループまたは同じグループに構成要素が重複しています。');
            occupied.add(member);
          }
          if (occupied.size > MAX_NODES) throw new RangeError('グループ構成要素の上限を超えています。');
          state.groups.set(id, { id, name: value.name, members });
        }
        reconcileState(state);
        replacements.set(identity, state);
      }
      // 読み込み操作は全置換。空の正しい metadata も明示的な全解除になる。
      const previousActive = activeIdentity;
      screens.clear();
      for (const [identity, state] of replacements) screens.set(identity, state);
      activeIdentity = screens.has(previousActive) ? previousActive : null;
      return snapshot();
    },

    forgetScreen(identity) {
      const removed = screens.delete(identity);
      if (activeIdentity === identity) activeIdentity = null;
      return removed;
    },

    clear() {
      screens.clear();
      activeIdentity = null;
      return snapshot();
    },
  };
}
