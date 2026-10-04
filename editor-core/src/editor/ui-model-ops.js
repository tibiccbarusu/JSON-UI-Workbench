/*
  ui-model-ops.js (S032)

  Pure operations for editing UiScreenModel structure from tree actions:
  - reorder children within a parent
  - duplicate a node subtree
  - delete a node subtree

  Notes:
  - These operations are designed to be immutable (they do not mutate the input model).
  - They intentionally focus on structure (children arrays) only.
*/

/**
 * @typedef {import('../model/ui-screen-model.js').UiScreenModel} UiScreenModel
 */

/**
 * @typedef {import('../model/ui-screen-model.js').UiNode} UiNode
 */

/**
 * @param {UiNode} root
 * @returns {Set<string>}
 */
function collectIds(root) {
  const used = new Set();
  (function walk(node) {
    used.add(String(node.id));
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  })(root);
  return used;
}

/**
 * @param {UiNode} root
 * @returns {{ nodeCount: number, maxDepth: number }}
 */
function computeStats(root) {
  let nodeCount = 0;
  let maxDepth = 0;

  (function walk(node, depth) {
    nodeCount += 1;
    if (depth > maxDepth) maxDepth = depth;
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child, depth + 1);
    }
  })(root, 0);

  return { nodeCount, maxDepth };
}

/**
 * Update a node's props within a UiScreenModel.
 *
 * Notes:
 * - Sets propsPresent[k]=true so the serializer will emit the property even
 *   if it was omitted in the origin JSON.
 * - Sets propsValid[k]=true (caller is expected to pass normalized values).
 * - Removes unknownProps[k] so the serializer prefers the edited value.
 *
 * @param {UiScreenModel} model
 * @param {string} nodeId
 * @param {Record<string, any>} propPatch
 * @returns {UiScreenModel}
 */
export function updateUiModelNodeProps(model, nodeId, propPatch) {
  if (!model || !model.root) return model;

  const patch = propPatch && typeof propPatch === 'object' ? propPatch : null;
  const keys = patch ? Object.keys(patch) : [];
  if (!patch || keys.length === 0) return model;

  const nextRoot = updateNodeById(model.root, nodeId, (n) => {
    if (!n) return n;

    const nextProps = { ...(n.props || {}) };
    const nextPresent = { ...(n.propsPresent || {}) };
    const nextValid = { ...(n.propsValid || {}) };
    const nextUnknown = { ...(n.unknownProps || {}) };

    let changed = false;

    for (const k of keys) {
      const key = String(k);
      const v = patch[key];

      if (nextProps[key] !== v) changed = true;
      nextProps[key] = v;

      if (nextPresent[key] !== true) changed = true;
      nextPresent[key] = true;

      if (nextValid[key] !== true) changed = true;
      nextValid[key] = true;

      if (Object.prototype.hasOwnProperty.call(nextUnknown, key)) {
        delete nextUnknown[key];
        changed = true;
      }
    }

    if (!changed) return n;

    return {
      ...n,
      props: nextProps,
      propsPresent: nextPresent,
      propsValid: nextValid,
      unknownProps: nextUnknown,
    };
  });

  if (nextRoot === model.root) return model;

  // Props changes do not affect counts/depth; keep stats as-is.
  return {
    ...model,
    root: nextRoot,
  };
}

/**
 * @param {string} s
 */
function sanitizeIdPart(s) {
  return String(s)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'node';
}

/**
 * @param {string} parentId
 * @param {string} hint
 * @param {Set<string>} used
 * @returns {string}
 */
function makeUniqueChildId(parentId, hint, used) {
  const base = `${String(parentId)}/${sanitizeIdPart(hint)}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let n = 2;
  while (true) {
    const candidate = `${base}~${n}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    n += 1;
  }
}

/**
 * Create a duplicated key for a cloned node.
 *
 * @param {any} originalKey
 * @param {string} parentId
 * @param {Set<string>} usedIds
 * @returns {{ id: string, key: any }}
 */
function makeClonedIdAndKey(originalKey, parentId, usedIds) {
  const baseLocal = originalKey && originalKey.local_name ? String(originalKey.local_name) : originalKey && originalKey.raw ? String(originalKey.raw) : 'node';
  const baseRef = originalKey && originalKey.base_ref_raw ? String(originalKey.base_ref_raw) : originalKey && originalKey.base_ref ? String(originalKey.base_ref) : null;

  const localCopyBase = `${baseLocal}_copy`;
  const baseId = `${String(parentId)}/${sanitizeIdPart(localCopyBase)}`;
  const id = makeUniqueChildId(parentId, localCopyBase, usedIds);

  // Mirror the numeric suffix from the id into local_name, when present.
  let localFinal = localCopyBase;
  if (id.startsWith(baseId) && id.length > baseId.length) {
    const suffix = id.slice(baseId.length); // ex: "~2"
    localFinal = `${localCopyBase}${suffix}`;
  }

  const raw = baseRef ? `${localFinal}@${baseRef}` : localFinal;

  const nextKey = {
    ...originalKey,
    raw,
    local_name: localFinal,
    base_ref_raw: baseRef,
    base_ref: baseRef,
  };

  return { id, key: nextKey };
}

/**
 * Clone a UiNode subtree with new ids/keys.
 *
 * @param {UiNode} node
 * @param {string} parentId
 * @param {Set<string>} usedIds
 * @returns {UiNode}
 */
function cloneSubtree(node, parentId, usedIds) {
  const { id: newId, key: newKey } = makeClonedIdAndKey(node.key, parentId, usedIds);

  const children = Array.isArray(node.children)
    ? node.children.map((child) => cloneSubtree(child, newId, usedIds))
    : [];

  // Best-effort shallow clones for object fields.
  const nextNode = {
    ...node,
    id: newId,
    key: newKey,
    props: { ...(node.props || {}) },
    unknownProps: { ...(node.unknownProps || {}) },
    localVariables: { ...(node.localVariables || {}) },
    propsPresent: { ...(node.propsPresent || {}) },
    propsValid: { ...(node.propsValid || {}) },
    bindings: Array.isArray(node.bindings) ? node.bindings.map((b) => ({ ...b })) : [],
    children,
  };

  return nextNode;
}

/**
 * Immutable update helper.
 *
 * @param {UiNode} node
 * @param {string} targetId
 * @param {(n: UiNode) => UiNode} updater
 * @returns {UiNode}
 */
function updateNodeById(node, targetId, updater) {
  if (String(node.id) === String(targetId)) {
    return updater(node);
  }

  if (!Array.isArray(node.children) || node.children.length === 0) {
    return node;
  }

  let changed = false;
  const nextChildren = node.children.map((child) => {
    const nextChild = updateNodeById(child, targetId, updater);
    if (nextChild !== child) changed = true;
    return nextChild;
  });

  if (!changed) return node;
  return {
    ...node,
    children: nextChildren,
  };
}

/**
 * Find a node's parent and index.
 *
 * @param {UiNode} root
 * @param {string} targetId
 * @returns {{ parent: UiNode, index: number, node: UiNode } | null}
 */
function findParentAndIndex(root, targetId) {
  /** @type {Array<{ parent: UiNode, node: UiNode, index: number }>} */
  const stack = [{ parent: null, node: root, index: -1 }];

  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) break;

    const node = cur.node;
    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const child = node.children[i];
        if (String(child.id) === String(targetId)) {
          return { parent: node, index: i, node: child };
        }
        stack.push({ parent: node, node: child, index: i });
      }
    }
  }

  return null;
}

/**
 * Reorder a child within a parent node.
 *
 * @param {UiScreenModel} model
 * @param {string} parentId
 * @param {string} nodeId
 * @param {number} toIndex
 * @returns {UiScreenModel}
 */
export function reorderUiModelChild(model, parentId, nodeId, toIndex) {
  if (!model || !model.root) return model;

  const nextRoot = updateNodeById(model.root, parentId, (parent) => {
    if (!Array.isArray(parent.children)) return parent;

    const fromIndex = parent.children.findIndex((c) => String(c.id) === String(nodeId));
    if (fromIndex < 0) return parent;

    const children = parent.children.slice();
    const [moved] = children.splice(fromIndex, 1);

    const insertIndex = Math.max(0, Math.min(Number(toIndex) || 0, children.length));
    children.splice(insertIndex, 0, moved);

    return {
      ...parent,
      children,
    };
  });

  if (nextRoot === model.root) return model;

  const stats = computeStats(nextRoot);
  return {
    ...model,
    root: nextRoot,
    stats: {
      ...(model.stats || {}),
      ...stats,
    },
  };
}


/**
 * Add a new child node under the given parent.
 *
 * The new node gets:
 * - id: <parentId>/<sanitizedType>[~N] (unique within the model)
 * - key.raw/local_name mirrored from the id suffix (so siblings are unique)
 * - props set to the provided defaults with propsPresent/propsValid=true
 * - controlsPresent=false and children=[]
 *
 * @param {UiScreenModel} model
 * @param {string} parentId
 * @param {string} elementType
 * @param {Record<string, any>} defaultProps
 * @returns {{ model: UiScreenModel, newNodeId: string|null, parentId: string|null }}
 */
export function addUiModelChild(model, parentId, elementType, defaultProps) {
  if (!model || !model.root) return { model, newNodeId: null, parentId: null };

  const pid = String(parentId || '');
  if (!pid) return { model, newNodeId: null, parentId: null };

  const type = String(elementType || '').trim().toLowerCase();
  if (!type) return { model, newNodeId: null, parentId: null };

  const props = (defaultProps && typeof defaultProps === "object" && !Array.isArray(defaultProps)) ? defaultProps : {};

  const usedIds = collectIds(model.root);

  const localBase = sanitizeIdPart(type);
  const baseId = `${pid}/${sanitizeIdPart(localBase)}`;
  const id = makeUniqueChildId(pid, localBase, usedIds);

  // Mirror the numeric suffix from the id into local_name, when present.
  let localFinal = localBase;
  if (id.startsWith(baseId) && id.length > baseId.length) {
    const suffix = id.slice(baseId.length); // ex: "~2"
    localFinal = `${localBase}${suffix}`;
  }

  /** @type {UiNode} */
  const newNode = {
    id: String(id),
    key: {
      raw: String(localFinal),
      local_name: String(localFinal),
      base_ref_raw: null,
      base_ref: null,
    },
    type,
    props: { ...props },
    propsPresent: {},
    propsValid: {},
    unknownProps: {},
    localVariables: {},
    children: [],
    controlsPresent: false,
    bindings: [],
    bindingsPresent: false,
    unknown_fields: {},
  };

  for (const k of Object.keys(props)) {
    const key = String(k);
    newNode.propsPresent[key] = true;
    newNode.propsValid[key] = true;
  }

  let inserted = false;
  const nextRoot = updateNodeById(model.root, pid, (parent) => {
    if (!parent) return parent;
    inserted = true;

    const kids = Array.isArray(parent.children) ? parent.children.slice() : [];
    kids.push(newNode);

    return {
      ...parent,
      children: kids,
      // Ensure serializer emits controls for the parent.
      controlsPresent: true,
    };
  });

  if (!inserted || nextRoot === model.root) {
    return { model, newNodeId: null, parentId: null };
  }

  const stats = computeStats(nextRoot);
  const nextModel = {
    ...model,
    root: nextRoot,
    stats: {
      ...(model.stats || {}),
      ...stats,
    },
  };

  return { model: nextModel, newNodeId: String(id), parentId: pid };
}

/**
 * Duplicate a node subtree and insert it next to the original under the same parent.
 *
 * @param {UiScreenModel} model
 * @param {string} nodeId
 * @returns {{ model: UiScreenModel, newNodeId: string|null, parentId: string|null }}
 */
export function duplicateUiModelNode(model, nodeId) {
  if (!model || !model.root) return { model, newNodeId: null, parentId: null };
  if (String(nodeId) === String(model.root.id)) return { model, newNodeId: null, parentId: null };

  const info = findParentAndIndex(model.root, nodeId);
  if (!info) return { model, newNodeId: null, parentId: null };

  const usedIds = collectIds(model.root);
  const cloned = cloneSubtree(info.node, info.parent.id, usedIds);

  const nextRoot = updateNodeById(model.root, info.parent.id, (parent) => {
    if (!Array.isArray(parent.children)) return parent;

    const children = parent.children.slice();
    children.splice(info.index + 1, 0, cloned);

    return {
      ...parent,
      children,
    };
  });

  if (nextRoot === model.root) return { model, newNodeId: null, parentId: null };

  const stats = computeStats(nextRoot);
  const nextModel = {
    ...model,
    root: nextRoot,
    stats: {
      ...(model.stats || {}),
      ...stats,
    },
  };

  return { model: nextModel, newNodeId: String(cloned.id), parentId: String(info.parent.id) };
}

/**
 * Delete a node subtree by removing it from its parent children array.
 *
 * @param {UiScreenModel} model
 * @param {string} nodeId
 * @returns {{ model: UiScreenModel, deleted: boolean, parentId: string|null }}
 */
export function deleteUiModelNode(model, nodeId) {
  if (!model || !model.root) return { model, deleted: false, parentId: null };
  if (String(nodeId) === String(model.root.id)) return { model, deleted: false, parentId: null };

  const info = findParentAndIndex(model.root, nodeId);
  if (!info) return { model, deleted: false, parentId: null };

  const nextRoot = updateNodeById(model.root, info.parent.id, (parent) => {
    if (!Array.isArray(parent.children)) return parent;

    const children = parent.children.filter((c) => String(c.id) !== String(nodeId));
    if (children.length === parent.children.length) return parent;

    return {
      ...parent,
      children,
    };
  });

  if (nextRoot === model.root) return { model, deleted: false, parentId: null };

  const stats = computeStats(nextRoot);
  const nextModel = {
    ...model,
    root: nextRoot,
    stats: {
      ...(model.stats || {}),
      ...stats,
    },
  };

  return { model: nextModel, deleted: true, parentId: String(info.parent.id) };
}
