/*
  screen-tree.js

  Build a simple, read-only element hierarchy tree from a Minecraft Bedrock
  JSON UI screen file.

  This step (S028) intentionally does not implement full Bedrock JSON UI
  semantics (template resolution, inheritance merging, bindings evaluation, etc.).
  The goal is to:
  - parse the UI screen JSON
  - extract UI element definitions
  - traverse "controls" hierarchies
  - produce nodes compatible with the current app store/tree renderer.

  References:
  - UI screen files use a namespace-based structure where each JSON key (except
    'namespace') defines a UI element, and element keys may use '@' inheritance.
*/

const RESERVED_TOP_LEVEL_KEYS = new Set(['namespace', 'format_version', '$schema']);

/**
 * @typedef {Object} TreeNode
 * @property {string} id
 * @property {string} type
 * @property {Record<string, any>} props
 * @property {string[]} children
 */

/**
 * @typedef {Object} BuildTreeResult
 * @property {string} rootId
 * @property {Record<string, TreeNode>} nodesById
 * @property {{ nodeCount: number, truncated: boolean }} stats
 */

/**
 * Return a safe-ish string label for the tree UI.
 * @param {any} v
 */
function toShortString(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v == null) return '';
  return '';
}

/**
 * Make a conservative, machine-friendly id segment.
 *
 * @param {string} raw
 */
function sanitizeIdPart(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.:@-]/g, '_')
    .replace(/_+/g, '_');
}

/**
 * Extract UI element definitions from a UI screen JSON root object.
 *
 * Per Bedrock JSON UI convention, each top-level key except 'namespace' defines
 * an element/template.
 *
 * @param {any} root
 * @returns {{ key: string, value: any }[]}
 */
export function extractTopLevelUiElements(root) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
  const out = [];
  for (const [k, v] of Object.entries(root)) {
    if (RESERVED_TOP_LEVEL_KEYS.has(k)) continue;
    if (!v || typeof v !== 'object') continue;
    out.push({ key: k, value: v });
  }
  return out;
}

/**
 * Build a tree compatible with /src/main.js' current file/tree renderer.
 *
 * @param {any} rootJson Parsed JSON value from a UI screen file.
 * @param {{
 *   fileLabel?: string,
 *   maxNodes?: number,
 *   maxDepth?: number,
 * }} [options]
 * @returns {BuildTreeResult}
 */
export function buildUiScreenTree(rootJson, options = {}) {
  const fileLabel = typeof options.fileLabel === 'string' ? options.fileLabel : 'ui_screen.json';
  // Root must always exist. Invalid or unbounded caller limits cannot disable
  // the tree's finite traversal or create dangling child references.
  const maxNodes = Number.isSafeInteger(options.maxNodes)
    ? Math.max(1, Math.min(5000, options.maxNodes)) : 5000;
  const maxDepth = Number.isSafeInteger(options.maxDepth)
    ? Math.max(0, Math.min(60, options.maxDepth)) : 60;

  /** @type {Record<string, TreeNode>} */
  const nodesById = {};
  let nodeCount = 0;
  let truncated = false;

  function addNode(node) {
    if (nodeCount >= maxNodes) {
      truncated = true;
      return false;
    }
    nodesById[node.id] = node;
    nodeCount += 1;
    return true;
  }

  function makeId(base) {
    // Ensure uniqueness even if a JSON UI file reuses names.
    let id = base;
    let i = 2;
    while (nodesById[id]) {
      id = `${base}~${i}`;
      i += 1;
    }
    return id;
  }

  /**
   * Parse a single control spec into a node.
   *
   * JSON UI controls in the wild commonly appear in two shapes:
   *  1) "inline" control object:
   *     { "type": "label", "text": "Hello" }
   *  2) named control (optionally inheriting):
   *     { "my_label@common.label": { "text": "Hello" } }
   *
   * @param {any} spec
   * @param {string} suggestedName
   * @param {string} parentId
   * @param {number} index
   * @param {number} depth
   * @returns {string|null} created node id
   */
  function walkControl(spec, suggestedName, parentId, index, depth) {
    if (depth > maxDepth) {
      truncated = true;
      return null;
    }

    // Named control wrapper: { "name@base": { ... } }
    let name = suggestedName;
    let obj = null;
    let baseRef = null;

    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      if (typeof spec.type === 'string') {
        obj = spec;
      } else {
        const keys = Object.keys(spec);
        if (keys.length === 1 && spec[keys[0]] && typeof spec[keys[0]] === 'object' && !Array.isArray(spec[keys[0]])) {
          name = keys[0];
          obj = spec[keys[0]];
          if (name.includes('@')) {
            const parts = name.split('@');
            baseRef = parts.slice(1).join('@');
          }
        } else {
          // Unknown object shape; still represent it.
          obj = spec;
        }
      }
    }

    if (typeof spec === 'string') {
      name = spec;
      obj = null;
    }

    const type = obj && typeof obj.type === 'string' ? obj.type : (baseRef ? 'ref' : (obj ? 'object' : 'ref'));

    // Node naming: prefer explicit name; else fall back to type + index.
    const prettyName = name || (obj && typeof obj.name === 'string' ? obj.name : '') || `${type}#${index + 1}`;
    const nodeId = makeId(`${parentId}/${sanitizeIdPart(prettyName)}`);

    /** @type {TreeNode} */
    const node = {
      id: nodeId,
      type,
      props: {
        name: prettyName,
      },
      children: [],
    };

    // Surface a few common fields (read-only, for debugging).
    if (baseRef) node.props.base = baseRef;
    if (obj && typeof obj.text === 'string') node.props.text = obj.text;
    if (obj && Array.isArray(obj.size)) node.props.size = obj.size;
    if (obj && Array.isArray(obj.offset)) node.props.offset = obj.offset;
    if (obj && typeof obj.texture === 'string') node.props.texture = obj.texture;

    if (!addNode(node)) return null;

    // Recurse into controls if present.
    if (obj && obj.controls != null) {
      const controls = obj.controls;
      if (Array.isArray(controls)) {
        for (let i = 0; i < controls.length; i += 1) {
          if (nodeCount >= maxNodes) {
            truncated = true;
            break;
          }
          const childId = walkControl(controls[i], '', nodeId, i, depth + 1);
          if (childId) node.children.push(childId);
        }
      } else if (controls && typeof controls === 'object') {
        const entries = Object.entries(controls);
        for (let i = 0; i < entries.length; i += 1) {
          if (nodeCount >= maxNodes) {
            truncated = true;
            break;
          }
          const [k, v] = entries[i];
          const childId = walkControl(v, k, nodeId, i, depth + 1);
          if (childId) node.children.push(childId);
        }
      }
    }

    return nodeId;
  }

  const rootId = 'root';
  addNode({
    id: rootId,
    type: 'file',
    props: { name: fileLabel },
    children: [],
  });

  const defs = extractTopLevelUiElements(rootJson);
  if (defs.length === 0) {
    // Fallback: show a placeholder node for unknown JSON.
    const placeholderId = makeId('root/unknown');
    const added = addNode({
      id: placeholderId,
      type: 'unknown',
      props: {
        name: 'No UI element definitions found',
      },
      children: [],
    });
    if (added) nodesById[rootId].children.push(placeholderId);
  } else {
    for (let i = 0; i < defs.length; i += 1) {
      const { key, value } = defs[i];
      if (nodeCount >= maxNodes) {
        truncated = true;
        break;
      }
      const defType = value && typeof value === 'object' && typeof value.type === 'string' ? value.type : 'object';
      const defId = makeId(`${rootId}/${sanitizeIdPart(key)}`);
      /** @type {TreeNode} */
      const defNode = {
        id: defId,
        type: defType,
        props: {
          name: key,
        },
        children: [],
      };
      if (value && typeof value.text === 'string') defNode.props.text = value.text;
      if (value && typeof value.namespace === 'string') defNode.props.namespace = value.namespace;
      if (!addNode(defNode)) break;
      nodesById[rootId].children.push(defId);

      // Traverse children controls, if any.
      const controls = value && typeof value === 'object' ? value.controls : null;
      if (Array.isArray(controls)) {
        for (let j = 0; j < controls.length; j += 1) {
          if (nodeCount >= maxNodes) {
            truncated = true;
            break;
          }
          const childId = walkControl(controls[j], '', defId, j, 1);
          if (childId) defNode.children.push(childId);
        }
      } else if (controls && typeof controls === 'object') {
        const entries = Object.entries(controls);
        for (let j = 0; j < entries.length; j += 1) {
          if (nodeCount >= maxNodes) {
            truncated = true;
            break;
          }
          const [k, v] = entries[j];
          const childId = walkControl(v, k, defId, j, 1);
          if (childId) defNode.children.push(childId);
        }
      }
    }
  }

  if (truncated) {
    const warnId = makeId('root/TRUNCATED');
    const added = addNode({
      id: warnId,
      type: 'warning',
      props: {
        name: `TRUNCATED (maxNodes=${maxNodes})`,
      },
      children: [],
    });
    if (added) nodesById[rootId].children.push(warnId);
  }

  return {
    rootId,
    nodesById,
    stats: { nodeCount, truncated },
  };
}
