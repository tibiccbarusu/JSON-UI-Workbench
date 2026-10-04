/**
 * Collection ownership shared by binding evaluation and preview interaction.
 * This is a bounded preview contract, not a Minecraft engine implementation.
 * Names and dimensions are resolved by the caller's existing lexical adapter.
 */
const OWNER_TYPES = new Set(['collection_panel', 'stack_panel', 'grid']);
const MAX_INDEX = 1_000_000;
const validIndex = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_INDEX;
const text = value => typeof value === 'string' ? value.trim() : '';

/** Observed native contract, deliberately not a global property whitelist.
 * Mojang's store_common.json authors collection_index on immediate children
 * of collection_panel. The supplied Expedition Control 1.0.1 Content Log
 * rejects the same declaration below ordinary decorative panels. A generated
 * preview row is internal evidence produced by grid/factory expansion.
 * Preserve legacy address evaluation, but do not certify that shape as native.
 */
export function nativeCollectionIndexContextRejected({ props, parentType } = {}) {
  if (!props || !Object.hasOwn(props, 'collection_index')) return false;
  if (text(props.__jsonui_preview_collection_name)) return false;
  return !isCollectionOwnerType(parentType);
}

/** Whether a native control type owns an authored collection of child rows. */
export function isCollectionOwnerType(type) {
  return OWNER_TYPES.has(text(type).toLowerCase());
}

/** Accept an otherwise unscoped address only for one own data row at index 0. */
export function confirmCollectionRowAddress(address, rows) {
  if (address.status === 'resolved' && rows && typeof rows === 'object') {
    const entry = Object.getOwnPropertyDescriptor(rows, String(address.index));
    if (!entry) return { ...address, status: 'invalid', index: null,
      warning: `COLLECTION_ROW_MISSING:${address.collection}:${address.index}` };
    if (!Object.prototype.hasOwnProperty.call(entry, 'value') || !entry.value
      || typeof entry.value !== 'object' || Array.isArray(entry.value)) {
      return { ...address, status: 'invalid', index: null,
        warning: `COLLECTION_ROW_INVALID:${address.collection}:${address.index}` };
    }
  }
  if (address.status !== 'fallback') return address;
  const singleton = rows && typeof rows === 'object'
    && (Array.isArray(rows) ? rows.length === 1 : Object.keys(rows).length === 1)
    && Object.getOwnPropertyDescriptor(rows, '0')?.value;
  if (address.index === 0 && singleton && typeof singleton === 'object' && !Array.isArray(singleton)) {
    return { ...address, status: 'resolved' };
  }
  return { ...address, status: 'invalid', index: null,
    warning: `COLLECTION_INDEX_UNRESOLVED:${address.ownerId || 'unscoped'}:${address.collection}` };
}

/**
 * Resolve an explicit/generated/grid row without treating an ordinary panel as
 * a collection owner. `fallback` is not a confirmed address: callers may use
 * it only after proving that the requested collection is a singleton.
 *
 * @param {{currentId:string, collectionName:string, getNode:Function,
 * getParentId:Function, getProps:Function, resolveName:Function,
 * resolveDimensions:Function, unscopedGridInfo?:Function,
 * collectionScopeScanTruncated?:boolean}} options
 * @returns {{status:string,index:number|null,collection:string,ownerId:string|null,warning:string|null}}
 */
export function resolveCollectionRowAddress({
  currentId, collectionName, getNode, getParentId, getProps,
  resolveName, resolveDimensions, unscopedGridInfo = () => null,
  collectionScopeScanTruncated = false,
}) {
  let pendingIndex = null;
  let inferredGridIndex = false;
  let sawBoundary = false;
  let cursor = String(currentId || '');
  const seen = new Set();
  const result = (status, index, ownerId = null, warning = null) => ({
    status, index, collection: collectionName, ownerId, warning,
  });
  for (let depth = 0; cursor && depth < 64; depth += 1) {
    if (seen.has(cursor)) return result('invalid', null, cursor, `COLLECTION_SCOPE_CYCLE:${cursor}`);
    seen.add(cursor);
    const node = getNode(cursor);
    const props = getProps(cursor) || {};
    const index = props.collection_index;
    const hasIndex = Object.prototype.hasOwnProperty.call(props, 'collection_index');
    const marker = text(props.__jsonui_preview_collection_name);
    const rawName = text(props.collection_name);
    // A generated row can itself own a nested collection. On descendants the
    // nested owner wins; on the node itself the generated parent row wins.
    if (marker && !(depth > 0 && rawName)) {
      sawBoundary = true;
      if (marker === collectionName) {
        if (!validIndex(index)) return result('invalid', null, cursor, `COLLECTION_INDEX_INVALID:${cursor}`);
        return result('resolved', index, cursor);
      }
      // Explicit bindings can name an outer collection (vanilla ModalForm
      // radio focus does this). Discard this row's index, then require a
      // matching ancestor owner/marker rather than borrowing the inner row.
      pendingIndex = null;
      inferredGridIndex = false;
      const parentId = getParentId(cursor);
      cursor = parentId == null ? '' : String(parentId);
      continue;
    }

    if (rawName) {
      sawBoundary = true;
      if (!isCollectionOwnerType(node?.type || props.type)) {
        return result('invalid', null, cursor, `COLLECTION_OWNER_INVALID:${cursor}:${text(node?.type || props.type) || 'unknown'}`);
      }
      const name = resolveName(rawName, props);
      if (!name) return result('invalid', null, cursor, `COLLECTION_NAME_UNRESOLVED:${cursor}`);
      if (name === collectionName) {
        // An owner's own collection_index addresses its parent's row; only an
        // index found strictly below this owner selects one of its child rows.
        return pendingIndex === null
          ? result('fallback', 0, cursor)
          : result('resolved', pendingIndex, cursor);
      }
      // The child index belonged to this different collection. The owner's
      // own index, if present, can in turn address its parent's collection.
      pendingIndex = null;
      inferredGridIndex = false;
    }
    if (hasIndex && !validIndex(index)) {
      return result('invalid', null, cursor, `COLLECTION_INDEX_INVALID:${cursor}`);
    }
    const authoredIndex = Object.prototype.hasOwnProperty.call(node?.props || {}, 'collection_index')
      || Object.prototype.hasOwnProperty.call(node?.unknownProps || {}, 'collection_index');
    if (hasIndex && !authoredIndex && props.property_bag
      && ['collection_index', '#collection_index', '$collection_index']
        .some(key => Object.prototype.hasOwnProperty.call(props.property_bag, key))) {
      return result('invalid', null, cursor, `COLLECTION_INDEX_SOURCE_UNSUPPORTED:${cursor}`);
    }
    if (validIndex(index) && pendingIndex === null) pendingIndex = index;

    const parentId = getParentId(cursor);
    const parentNode = parentId ? getNode(parentId) : null;
    const parentProps = parentId ? getProps(parentId) || {} : {};
    const parentRawName = text(parentProps.collection_name);
    const parentMarker = text(parentProps.__jsonui_preview_collection_name);
    const parentName = parentRawName ? resolveName(parentRawName, parentProps) : '';
    const parentHasBoundary = Boolean(parentRawName || parentMarker);
    const info = !parentHasBoundary ? unscopedGridInfo(parentId) : null;
    const inferredGridMatches = !collectionScopeScanTruncated && !sawBoundary
      && info?.uncertain !== true && info?.names instanceof Set
      && info.names.size === 1 && info.names.has(collectionName);
    const parentMatches = parentRawName ? parentName === collectionName
      : parentMarker ? parentMarker === collectionName : inferredGridMatches;
    if (text(parentNode?.type || parentProps.type).toLowerCase() === 'grid' && parentMatches) {
      const position = props.grid_position;
      const dimensions = resolveDimensions(parentProps);
      if (Array.isArray(position) && Array.isArray(dimensions)
        && position.length === 2 && dimensions.length === 2
        && dimensions.every(value => Number.isSafeInteger(value) && value > 0 && value <= 2048)
        && position.every((value, axis) => Number.isSafeInteger(value) && value >= 0 && value < dimensions[axis])) {
        const direction = text(parentProps.grid_fill_direction).toLowerCase() || 'horizontal';
        if (!['horizontal', 'vertical'].includes(direction)) {
          return result('invalid', null, parentId, `COLLECTION_GRID_DIRECTION_INVALID:${parentId}`);
        }
        const gridIndex = direction === 'vertical'
          ? position[0] * dimensions[1] + position[1]
          : position[1] * dimensions[0] + position[0];
        if (!validIndex(gridIndex)) return result('invalid', null, parentId, `COLLECTION_INDEX_INVALID:${parentId}`);
        if (parentHasBoundary) return result('resolved', gridIndex, parentId);
        if (pendingIndex === null) { pendingIndex = gridIndex; inferredGridIndex = true; }
      } else if (position !== undefined) {
        return result('invalid', null, cursor, `COLLECTION_GRID_POSITION_INVALID:${cursor}`);
      }
    }
    cursor = parentId == null ? '' : String(parentId);
  }
  if (cursor) return result('invalid', null, cursor, `COLLECTION_SCOPE_DEPTH_LIMIT:${cursor}`);
  // Named singleton controls exist outside collection panels in vanilla. An
  // unscoped explicit index is retained for the caller's singleton check only.
  return result(!sawBoundary && inferredGridIndex ? 'resolved' : 'fallback', sawBoundary ? 0 : pendingIndex ?? 0);
}
