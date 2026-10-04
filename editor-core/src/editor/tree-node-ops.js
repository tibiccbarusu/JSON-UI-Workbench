/*
  tree-node-ops.js (S032)

  Pure operations for the simple tree node map used by stub/sample files.

  Structure:
  - nodesById: { [id]: { id, type, props, children: string[] } }
  - rootId: string
*/

/**
 * @param {Record<string, any>} nodesById
 * @param {string} rootId
 * @param {string} childId
 * @returns {string|null}
 */
export function findParentId(nodesById, rootId, childId) {
  if (!nodesById || !childId) return null;
  if (String(childId) === String(rootId)) return null;

  for (const [id, node] of Object.entries(nodesById)) {
    if (!node || !Array.isArray(node.children)) continue;
    if (node.children.some((c) => String(c) === String(childId))) {
      return String(id);
    }
  }
  return null;
}

/**
 * @param {Record<string, any>} nodesById
 * @param {string} parentId
 * @param {string} nodeId
 * @param {number} toIndex
 * @returns {Record<string, any>}
 */
export function reorderChildInNodeMap(nodesById, parentId, nodeId, toIndex) {
  const parent = nodesById && nodesById[String(parentId)];
  if (!parent || !Array.isArray(parent.children)) return nodesById;

  const fromIndex = parent.children.findIndex((c) => String(c) === String(nodeId));
  if (fromIndex < 0) return nodesById;

  const nextChildren = parent.children.slice();
  const [moved] = nextChildren.splice(fromIndex, 1);
  const insertIndex = Math.max(0, Math.min(Number(toIndex) || 0, nextChildren.length));
  nextChildren.splice(insertIndex, 0, moved);

  return {
    ...nodesById,
    [String(parentId)]: {
      ...parent,
      children: nextChildren,
    },
  };
}

/**
 * @param {Set<string>} used
 * @param {string} baseId
 */
function makeUniqueId(used, baseId) {
  const base = String(baseId);
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
 * Add a new child node under the given parent.
 *
 * This is used only for the stub/sample files that are stored as a node map.
 *
 * @param {Record<string, any>} nodesById
 * @param {string} rootId
 * @param {string} parentId
 * @param {string} elementType
 * @param {Record<string, any>} defaultProps
 * @returns {{ nodesById: Record<string, any>, newNodeId: string|null, parentId: string|null }}
 */
export function addChildInNodeMap(nodesById, rootId, parentId, elementType, defaultProps) {
  if (!nodesById) return { nodesById, newNodeId: null, parentId: null };

  const pid = String(parentId || '');
  if (!pid) return { nodesById, newNodeId: null, parentId: null };

  const parent = nodesById[String(pid)];
  if (!parent) return { nodesById, newNodeId: null, parentId: null };

  const type = String(elementType || '').trim().toLowerCase();
  if (!type) return { nodesById, newNodeId: null, parentId: null };

  const props = (defaultProps && typeof defaultProps === 'object' && !Array.isArray(defaultProps))
    ? defaultProps
    : {};

  const used = new Set(Object.keys(nodesById).map(String));
  const baseId = `${pid}/${sanitizeIdPart(type)}`;
  const id = makeUniqueId(used, baseId);

  const name = String(id).split('/').pop() || String(id);
  const nextProps = { ...props };
  if (nextProps.name == null || nextProps.name === '') nextProps.name = name;

  const nextNode = {
    id: String(id),
    type,
    props: nextProps,
    children: [],
  };

  const nextParentChildren = Array.isArray(parent.children) ? parent.children.slice() : [];
  nextParentChildren.push(String(id));

  const nextNodesById = {
    ...nodesById,
    [String(pid)]: {
      ...parent,
      children: nextParentChildren,
    },
    [String(id)]: nextNode,
  };

  return { nodesById: nextNodesById, newNodeId: String(id), parentId: String(pid) };
}

/**
 * @param {Record<string, any>} nodesById
 * @param {string} rootId
 * @param {string} nodeId
 * @returns {{ nodesById: Record<string, any>, newNodeId: string|null, parentId: string|null }}
 */
export function duplicateSubtreeInNodeMap(nodesById, rootId, nodeId) {
  if (!nodesById || !nodeId) return { nodesById, newNodeId: null, parentId: null };
  if (String(nodeId) === String(rootId)) return { nodesById, newNodeId: null, parentId: null };

  const parentId = findParentId(nodesById, rootId, nodeId);
  if (!parentId) return { nodesById, newNodeId: null, parentId: null };

  const parent = nodesById[String(parentId)];
  if (!parent || !Array.isArray(parent.children)) return { nodesById, newNodeId: null, parentId: null };

  const index = parent.children.findIndex((c) => String(c) === String(nodeId));
  if (index < 0) return { nodesById, newNodeId: null, parentId: null };

  const used = new Set(Object.keys(nodesById).map(String));

  /** @type {Map<string, string>} */
  const idMap = new Map();

  // 1) Collect subtree ids via DFS.
  /** @type {string[]} */
  const stack = [String(nodeId)];
  /** @type {string[]} */
  const order = [];
  const visited = new Set();

  while (stack.length > 0) {
    const curId = stack.pop();
    // Stub models must be trees. A repeated/missing child is rejected before
    // mutation instead of looping forever or duplicating a shared branch.
    if (!curId || visited.has(curId) || curId === String(rootId) || !Object.hasOwn(nodesById, curId)) {
      return { nodesById, newNodeId: null, parentId: null };
    }
    const cur = nodesById[String(curId)];
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) {
      return { nodesById, newNodeId: null, parentId: null };
    }
    visited.add(curId);
    order.push(curId);

    if (cur && Array.isArray(cur.children)) {
      for (let i = cur.children.length - 1; i >= 0; i -= 1) {
        stack.push(String(cur.children[i]));
      }
    }
  }

  // 2) Assign new ids.
  for (const oldId of order) {
    const baseNew = `${oldId}_copy`;
    const newId = makeUniqueId(used, baseNew);
    idMap.set(String(oldId), String(newId));
  }

  const newRootId = idMap.get(String(nodeId));
  if (!newRootId) return { nodesById, newNodeId: null, parentId: null };

  // 3) Build cloned nodes.
  /** @type {Record<string, any>} */
  const clonedNodes = {};
  for (const oldId of order) {
    const oldNode = nodesById[String(oldId)];
    const newId = idMap.get(String(oldId));
    if (!oldNode || !newId) continue;

    clonedNodes[String(newId)] = {
      ...oldNode,
      id: String(newId),
      props: { ...(oldNode.props || {}), name: `${(oldNode.props && oldNode.props.name) ? oldNode.props.name : oldId}_copy` },
      children: Array.isArray(oldNode.children) ? oldNode.children.map((c) => idMap.get(String(c)) || String(c)) : [],
    };
  }

  // 4) Insert new root id into parent.
  const nextParentChildren = parent.children.slice();
  nextParentChildren.splice(index + 1, 0, String(newRootId));

  const nextNodesById = {
    ...nodesById,
    ...clonedNodes,
    [String(parentId)]: {
      ...parent,
      children: nextParentChildren,
    },
  };

  return { nodesById: nextNodesById, newNodeId: String(newRootId), parentId: String(parentId) };
}

/**
 * @param {Record<string, any>} nodesById
 * @param {string} rootId
 * @param {string} nodeId
 * @returns {{ nodesById: Record<string, any>, deletedIds: string[], parentId: string|null }}
 */
export function deleteSubtreeInNodeMap(nodesById, rootId, nodeId) {
  if (!nodesById || !nodeId) return { nodesById, deletedIds: [], parentId: null };
  if (String(nodeId) === String(rootId)) return { nodesById, deletedIds: [], parentId: null };

  const parentId = findParentId(nodesById, rootId, nodeId);
  if (!parentId) return { nodesById, deletedIds: [], parentId: null };

  // Collect subtree ids.
  /** @type {string[]} */
  const deletedIds = [];
  /** @type {string[]} */
  const stack = [String(nodeId)];
  const visited = new Set();

  while (stack.length > 0) {
    const curId = stack.pop();
    if (!curId || visited.has(curId) || curId === String(rootId) || !Object.hasOwn(nodesById, curId)) {
      return { nodesById, deletedIds: [], parentId: null };
    }
    const cur = nodesById[String(curId)];
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) {
      return { nodesById, deletedIds: [], parentId: null };
    }
    visited.add(curId);
    deletedIds.push(String(curId));

    if (cur && Array.isArray(cur.children)) {
      for (const childId of cur.children) stack.push(String(childId));
    }
  }

  const parent = nodesById[String(parentId)];
  const nextParentChildren = parent && Array.isArray(parent.children)
    ? parent.children.filter((c) => String(c) !== String(nodeId))
    : [];

  /** @type {Record<string, any>} */
  const nextNodesById = {
    ...nodesById,
    [String(parentId)]: {
      ...parent,
      children: nextParentChildren,
    },
  };

  for (const delId of deletedIds) {
    delete nextNodesById[String(delId)];
  }

  return { nodesById: nextNodesById, deletedIds, parentId: String(parentId) };
}
