/*
  ui-model-tree.js (S032)

  Build tree-view nodes from UiScreenModel.

  Why:
  - Tree node ids MUST match UiNode.id so tree actions can edit the model.
  - The editor tree UI expects a flat nodesById map.
*/

/**
 * @param {any} model
 */
export function buildTreeFromUiScreenModel(model) {
  const fallback = { rootId: 'root', nodesById: {}, stats: { nodeCount: 0, maxDepth: 0 } };
  if (!model || !model.root) return fallback;

  /** @type {Record<string, any>} */
  const nodesById = {};
  let nodeCount = 0;
  let maxDepth = 0;

  /**
   * @param {any} node
   * @param {number} depth
   */
  function visit(node, depth) {
    nodeCount += 1;
    if (depth > maxDepth) maxDepth = depth;

    const isFileRoot = node && node.id === model.root.id;
    const name = isFileRoot
      ? model.filePath || model.fileId || String(node.id)
      : node && node.key && node.key.raw
        ? String(node.key.raw)
        : String(node.id);

    // Preserve unknown properties for preview/layout usage (e.g., keep_ratio, placeholder_text,
    // grid_position) by merging them into props. Usually normalized known props win, but when
    // normalization explicitly failed we must retain the authored raw expression. Otherwise a
    // runtime-dependent `visible` value is silently replaced by its schema default and safe
    // preview paints branches that may be mutually exclusive on-device.
    const unknownProps = node && node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {};
    const knownProps = node && node.props && typeof node.props === 'object' ? node.props : {};
    const propsValid = node && node.propsValid && typeof node.propsValid === 'object' ? node.propsValid : {};

    const props = { ...unknownProps, ...knownProps, name };
    for (const [key, valid] of Object.entries(propsValid)) {
      if (valid === false && Object.prototype.hasOwnProperty.call(unknownProps, key)) {
        props[key] = unknownProps[key];
      }
    }
    const children = Array.isArray(node && node.children) ? node.children.map((c) => String(c.id)) : [];

    nodesById[String(node.id)] = {
      id: String(node.id),
      type: String((node && node.type) || 'unknown'),
      isFileRoot,
      props,
      propsPresent: { ...(node && node.propsPresent ? node.propsPresent : {}) },
      unknownProps,
      propsValid,
      children,
      descendantCount: 0,
    };

    let subtreeCount = 1;
    if (Array.isArray(node && node.children)) {
      for (const child of node.children) {
        subtreeCount += visit(child, depth + 1);
      }
    }
    nodesById[String(node.id)].descendantCount = subtreeCount - 1;
    return subtreeCount;
  }

  visit(model.root, 0);

  return {
    rootId: String(model.root.id),
    nodesById,
    stats: { nodeCount, maxDepth },
  };
}

function isPreviewSlotNode(node) {
  if (!node) return false;
  const id = String(node.id || '');
  const name = String(node.props && node.props.name ? node.props.name : '');
  return /(?:^|\/)preview_slot_\d+$/.test(id) || /^preview_slot_\d+(?:@|$)/.test(name);
}

/**
 * Large resolved subtrees and generated collection skeletons can contain
 * thousands of inspectable nodes. Collapse them below the file root by
 * default; callers can still persist an explicit `collapsed: false` override.
 */
export function shouldDefaultCollapseGeneratedCollectionNode(node, nodesById) {
  if (!node || node.isFileRoot) return false;
  if (Number(node.descendantCount) > 200) return true;
  if (isPreviewSlotNode(node)) return true;
  const children = Array.isArray(node.children) ? node.children : [];
  return children.length > 0 && children.every((id) => isPreviewSlotNode(nodesById && nodesById[String(id)]));
}
