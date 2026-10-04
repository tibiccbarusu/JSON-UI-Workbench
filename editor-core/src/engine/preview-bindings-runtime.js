// Shared deterministic Classic context for both browser and Node frame evaluation.
// No DOM, filesystem, dynamic code evaluation, or mutable application state.
import { evaluateBindingsForUiModel } from '../bindings/bindings-evaluator.js';
import { mergeRepresentativeCollectionMockData } from './effective-ui-resolver.js';
import { buildRepresentativeClassicCollections, buildRepresentativeClassicCollectionData,
  buildRepresentativeClassicBindingMockData, buildRepresentativeClassicResolverVariables } from './representative-classic-runtime.js';

const REPRESENTATIVE_CLASSIC_MOCK_DATA = Object.freeze({
  '#is_survival_layout': true,
  '#is_creative_layout': false,
  '#is_creative_and_creative_layout': false,
  '#is_creative_and_recipe_book_layout': false,
  '#is_recipe_book_layout': false,
  '#is_creative_mode': false,
  '#is_left_tab_inventory': true,
  '#using_touch': false,
  '#using_gamepad': false,
  '#gamepad_helper_visible': false,
  '#gamepad_cursor_visible': false,
  '#close_button_visible': true,
  '#help_button_visible': true,
  '#text_box_enabled': true,
  '#is_mouse': true,
});


export function buildEffectivePreviewMockData(userMockData, qualifiedName = '', representativeCollections = null) {
  const userCollectionData = userMockData?.__collections && typeof userMockData.__collections === 'object'
    && !Array.isArray(userMockData.__collections)
    ? userMockData.__collections
    : {};
  const collections = representativeCollections && typeof representativeCollections === 'object'
    && !Array.isArray(representativeCollections)
    ? representativeCollections
    : buildRepresentativeClassicCollections({ qualifiedName, collectionData: userCollectionData });
  return {
    ...REPRESENTATIVE_CLASSIC_MOCK_DATA,
    ...buildRepresentativeClassicBindingMockData({ qualifiedName, userMockData }),
    ...buildRepresentativeClassicResolverVariables({ qualifiedName, userVariables: userMockData }),
    ...mergeRepresentativeCollectionMockData(collections, userMockData),
  };
}

export function evaluateBindingsWithRepresentativeRuntime(uiModel, qualifiedName, userMockData, localContext = {}) {
  if (!uiModel) return null;
  const safeUserMockData = userMockData && typeof userMockData === 'object' ? userMockData : {};
  const userCollectionData = safeUserMockData.__collections
    && typeof safeUserMockData.__collections === 'object'
    && !Array.isArray(safeUserMockData.__collections)
    ? safeUserMockData.__collections
    : {};
  const representativeCollections = buildRepresentativeClassicCollections({
    qualifiedName,
    collectionData: userCollectionData,
  });
  const collectionData = buildRepresentativeClassicCollectionData(
    representativeCollections,
    userCollectionData,
  );
  const mockData = buildEffectivePreviewMockData(
    safeUserMockData,
    qualifiedName,
    representativeCollections,
  );
  return evaluateBindingsForUiModel(uiModel, { mockData, collectionData,
    uiInstanceId: localContext.uiInstanceId, localToggleState: localContext.localToggleState });
}
