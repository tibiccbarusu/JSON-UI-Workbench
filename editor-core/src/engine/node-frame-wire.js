/**
 * Authoring origin.raw recursively duplicates source subtrees and is not read
 * by the runtime. Send an execution-only model once; subsequent frames use ID.
 * Property values remain untouched so bindings, textures and unknown props
 * retain the same semantics as the editor model.
 */
export function prepareNodeFrameFile(file) {
  let uiModel = null;
  if (file?.uiModel?.root) {
    const copyNode = node => ({ id: node.id, key: node.key, type: node.type,
      props: node.props, propsPresent: node.propsPresent, propsValid: node.propsValid,
      localVariables: node.localVariables, bindings: node.bindings,
      unknownProps: node.unknownProps, children: [] });
    const root = copyNode(file.uiModel.root), pending = [[file.uiModel.root, root]];
    const seen = new Set();
    while (pending.length) {
      const [source, target] = pending.pop();
      if (seen.has(source) || seen.size >= 50000) throw new Error('NODE_FRAME_MODEL_TREE_INVALID');
      seen.add(source);
      for (const child of source.children || []) {
        const next = copyNode(child); target.children.push(next); pending.push([child, next]);
      }
    }
    uiModel = { namespace: file.uiModel.namespace, filePath: file.uiModel.filePath, fileId: file.uiModel.fileId,
      stats: file.uiModel.stats,
      unknownFields: { $pocket_screen: file.uiModel.unknownFields?.$pocket_screen }, root };
  }
  return { rootId: file.rootId, nodesById: file.nodesById, uiModel,
    meta: { selectedDefinition: file.meta?.selectedDefinition,
      resolution: { animationDefinitions: file.meta?.resolution?.animationDefinitions, evaluation: file.meta?.resolution?.evaluation } } };
}
