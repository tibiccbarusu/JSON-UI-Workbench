import { test, assert, assertDeepEqual, assertEqual } from './test-harness.js';
import { captureBlobRead, captureTextRead } from '../src/pack-io/read-result.js';
import { extractExportRootVariables, scanJsonForExportDeps } from '../src/pack-io/export-dependencies.js';

function scanExportDependencies(value, options = {}) {
  const outUiJsonRefs = new Set();
  const outTextureRefs = new Set();
  const outFontRefs = new Set();
  const outLangKeys = new Set();
  const outUiSymbolRefs = new Set();
  const outNativeRenderers = [];
  const outNativeItemIds = [];
  const outDiagnostics = [];
  const scan = scanJsonForExportDeps({
    value,
    outUiJsonRefs,
    outTextureRefs,
    outFontRefs,
    outLangKeys,
    outUiSymbolRefs,
    outNativeRenderers,
    outNativeItemIds,
    outDiagnostics,
    sourcePath: 'ui/export-test.json',
    ...options,
  });
  return {
    uiJsonRefs: [...outUiJsonRefs].sort(),
    textureRefs: [...outTextureRefs].sort(),
    fontRefs: [...outFontRefs].sort(),
    langKeys: [...outLangKeys].sort(),
    uiSymbolRefs: [...outUiSymbolRefs].sort(),
    nativeRenderers: outNativeRenderers,
    nativeItemIds: outNativeItemIds,
    diagnostics: outDiagnostics,
    complete: scan.complete,
    limitReasons: scan.limitReasons,
    dependencyClosureComplete: scan.dependencyClosureComplete,
    unresolvedUiSymbolReasons: scan.unresolvedUiSymbolReasons,
    stats: scan.stats,
  };
}

test('export text adapter preserves a raw string as an explicit result', async () => {
  const result = await captureTextRead(async () => '{"ok":true}');
  assertEqual(result.ok, true);
  assertEqual(result.ok ? result.text : '', '{"ok":true}');
});

test('export text adapter converts thrown read errors into an explicit failure', async () => {
  const result = await captureTextRead(async () => {
    throw new Error('ZIP_ENTRY_NOT_FOUND');
  });
  assertEqual(result.ok, false);
  assertEqual(result.ok ? '' : result.error, 'ZIP_ENTRY_NOT_FOUND');
});

test('export text adapter rejects a result object where a raw string is required', async () => {
  const result = await captureTextRead(async () => ({ ok: true, text: 'wrong contract' }));
  assertEqual(result.ok, false);
  assertEqual(result.ok ? '' : result.error, 'PACK_TEXT_READ_INVALID_RESULT');
});

test('export blob adapter preserves a raw Blob as an explicit result', async () => {
  const result = await captureBlobRead(async () => new Blob(['safe'], { type: 'text/plain' }));
  assertEqual(result.ok, true);
  assertEqual(result.ok ? result.blob.size : -1, 4);
});

test('export blob adapter rejects a result object where a raw Blob is required', async () => {
  const result = await captureBlobRead(async () => ({ ok: true, blob: new Blob(['wrong']) }));
  assertEqual(result.ok, false);
  assertEqual(result.ok ? '' : result.error, 'PACK_BLOB_READ_INVALID_RESULT');
});

test('export dependency scan resolves exact lexical asset variables and alias chains', () => {
  const result = scanExportDependencies({
    '$icon': 'textures/ui/foo',
    '$font': 'PackFont',
    '$font_alias': '$font',
    '$label_key': 'menu.export.title',
    texture: '$icon',
    font_type: '$font_alias',
    text: '$label_key',
  });

  assertDeepEqual(result.textureRefs, ['textures/ui/foo']);
  assertDeepEqual(result.fontRefs, ['PackFont']);
  assertDeepEqual(result.langKeys, ['menu.export.title']);
  assertDeepEqual(result.diagnostics, []);
});

test('export dependency scan keeps sibling scopes isolated and nearest declarations win', () => {
  const result = scanExportDependencies({
    '$icon': 'textures/ui/root',
    controls: [
      {
        first: {
          '$icon': 'textures/ui/first',
          texture: '$icon',
        },
      },
      {
        second: {
          texture: '$icon',
        },
      },
      {
        third: {
          '$icon': 'textures/ui/third',
          texture: '$icon',
        },
      },
    ],
  });

  assertDeepEqual(result.textureRefs, [
    'textures/ui/first',
    'textures/ui/root',
    'textures/ui/third',
  ]);
  assertDeepEqual(result.diagnostics, []);
});

test('export dependency scan applies global roots, defaults, exact overrides, and self forwarding', () => {
  const rootVariables = extractExportRootVariables({
    format_version: 1,
    variables: {
      icon: 'textures/ui/global',
      '$font': 'GlobalFont',
    },
  });
  const result = scanExportDependencies({
    '$icon|default': 'textures/ui/default_should_not_win',
    '$font': '$font',
    texture: '$icon',
    font_type: '$font',
    controls: [
      {
        local: {
          '$icon|default': 'textures/ui/local_default_should_not_win',
          '$icon': 'textures/ui/local',
          texture: '$icon',
          controls: [
            { forwarded: { '$icon': '$icon', texture: '$icon' } },
          ],
        },
      },
      { sibling: { texture: '$icon' } },
    ],
  }, { rootVariables });

  assertDeepEqual(result.textureRefs, ['textures/ui/global', 'textures/ui/local']);
  assertDeepEqual(result.fontRefs, ['GlobalFont']);
  assertDeepEqual(result.diagnostics, []);
});

test('sparse imported UI resolves lower-pack globals to imported assets and fixed symbols', () => {
  const result = scanExportDependencies({
    namespace: 'overlay',
    screen: {
      texture: '$shared_texture',
      factory: {
        control_name: '$shared_control',
      },
    },
  }, {
    // The active catalog supplies this low-precedence baseline. Asset source
    // selection happens later, so the concrete path may still resolve to the
    // imported overlay without copying any lower-pack asset into the export.
    rootVariables: {
      '$shared_texture': 'textures/ui/imported_override',
      '$shared_control': 'row@base.shared_row',
    },
  });

  assertDeepEqual(result.textureRefs, ['textures/ui/imported_override']);
  assertDeepEqual(result.uiSymbolRefs, ['base.shared_row']);
  assertEqual(result.complete, true);
});

test('export dependency scan shares declaration-free lexical environments and bounds declaration work', () => {
  const rootVariables = {};
  for (let i = 0; i < 256; i += 1) rootVariables[`$global_${i}`] = `value_${i}`;
  rootVariables.$icon = 'textures/ui/shared_global';
  const controls = [];
  for (let i = 0; i < 1_500; i += 1) {
    controls.push({ [`row_${i}`]: { texture: '$icon' } });
  }

  const shared = scanExportDependencies({ controls }, { rootVariables });
  assertEqual(shared.complete, true);
  assertDeepEqual(shared.textureRefs, ['textures/ui/shared_global']);
  assert(shared.stats.environmentEntries < 1_000);

  const bounded = scanExportDependencies({
    controls: [
      { first: { '$local': 'textures/ui/first', texture: '$local' } },
      { second: { '$local': 'textures/ui/second', texture: '$local' } },
    ],
  }, {
    rootVariables: { '$root_a': 'a', '$root_b': 'b' },
    // The persistent environment charges the four authored declarations,
    // rather than repeatedly charging inherited map copies.
    limits: { maxEnvironmentEntries: 3 },
  });
  assertEqual(bounded.complete, false);
  assert(bounded.limitReasons.includes('lexical environment work'));
});

test('export dependency scan conservatively includes conditional variable alternatives', () => {
  const result = scanExportDependencies({
    '$icon': 'textures/ui/base',
    variables: [
      { requires: '$touch', '$icon': 'textures/ui/touch' },
      { requires: 'not $touch', '$icon': 'textures/ui/controller' },
    ],
    texture: '$icon',
  });

  assertDeepEqual(result.textureRefs, [
    'textures/ui/base',
    'textures/ui/controller',
    'textures/ui/touch',
  ]);
  assertDeepEqual(result.diagnostics, []);
});

test('export dependency scan reports unresolved dynamic refs and variable cycles', () => {
  const result = scanExportDependencies({
    '$cycle_a': '$cycle_b',
    '$cycle_b': '$cycle_a',
    texture: '$runtime_icon',
    hover_texture: '#bound_icon',
    pressed_texture: '($icon_expression)',
    font_type: '$cycle_a',
  });

  assertDeepEqual(result.textureRefs, []);
  assertDeepEqual(result.fontRefs, []);
  assert(result.diagnostics.some((item) => item.code === 'EXPORT_ASSET_VARIABLE_UNRESOLVED'
    && item.reference === '$runtime_icon'
    && item.reason === 'missing-variable'));
  assert(result.diagnostics.some((item) => item.code === 'EXPORT_ASSET_VARIABLE_UNRESOLVED'
    && item.reference === '$cycle_a'
    && item.reason === 'variable-cycle'));
  assert(result.diagnostics.some((item) => item.code === 'EXPORT_ASSET_DYNAMIC_REFERENCE'
    && item.reference === '#bound_icon'));
  assert(result.diagnostics.some((item) => item.code === 'EXPORT_ASSET_DYNAMIC_REFERENCE'
    && item.reference === '($icon_expression)'));
  assert(result.diagnostics.every((item) => String(item.message || '').includes('ui/export-test.json')));
});

test('export dependency scan carries caller variables through fixed inheritance and factory templates', () => {
  const records = {
    'composition.base': [{
      id: 'base',
      namespace: 'composition',
      rawKey: 'base',
      value: {
        type: 'image',
        '$asset': 'textures/ui/base_default',
        texture: '$asset',
      },
    }],
    'composition.factory_target': [{
      id: 'factory-target',
      namespace: 'composition',
      rawKey: 'factory_target',
      value: { type: 'image', texture: '$factory_asset' },
    }],
  };
  const result = scanExportDependencies({
    '$asset': 'textures/ui/runtime_caller_asset',
    '$factory_asset': 'textures/ui/runtime_factory_asset',
    factory: {
      control_ids: { row: 'generated@composition.factory_target' },
    },
  }, {
    rootNamespace: 'composition',
    rootAuthoredKey: 'derived@composition.base',
    rootRecordId: 'derived',
    resolveUiSymbolCandidates: (qualifiedName) => records[qualifiedName] || [],
  });

  assertDeepEqual(result.textureRefs, [
    'textures/ui/runtime_caller_asset',
    'textures/ui/runtime_factory_asset',
  ]);
  assertDeepEqual(result.uiSymbolRefs, [
    'composition.base',
    'composition.factory_target',
  ]);
  assertEqual(result.complete, true);
  assertEqual(result.dependencyClosureComplete, true);
  assert(!result.diagnostics.some((item) => item.code === 'EXPORT_ASSET_VARIABLE_UNRESOLVED'));
});

test('export dependency inheritance retains base assets when a caller override is conditional', () => {
  const records = {
    'composition.base': [{
      id: 'base',
      namespace: 'composition',
      rawKey: 'base',
      value: {
        '$asset': 'textures/ui/base_when_requirement_is_false',
        texture: '$asset',
      },
    }],
  };
  const result = scanExportDependencies({
    variables: [{
      requires: '$use_custom_asset',
      '$asset': 'textures/ui/custom_when_requirement_is_true',
    }],
  }, {
    rootNamespace: 'composition',
    rootAuthoredKey: 'derived@composition.base',
    rootRecordId: 'derived',
    resolveUiSymbolCandidates: (qualifiedName) => records[qualifiedName] || [],
  });

  assertDeepEqual(result.textureRefs, [
    'textures/ui/base_when_requirement_is_false',
    'textures/ui/custom_when_requirement_is_true',
  ]);
  assertEqual(result.complete, true);
  assertEqual(result.dependencyClosureComplete, true);
});

test('export dependency inheritance retains a base default only when no base exact value shadows it', () => {
  const records = {
    'composition.base': [{
      id: 'base',
      namespace: 'composition',
      rawKey: 'base',
      value: {
        '$fallback_asset|default': 'textures/ui/base_default_when_requirement_is_false',
        '$shadowed_asset|default': 'textures/ui/base_default_shadowed_by_exact',
        '$shadowed_asset': 'textures/ui/base_exact_when_requirement_is_false',
        controls: [
          { fallback: { type: 'image', texture: '$fallback_asset' } },
          { shadowed: { type: 'image', texture: '$shadowed_asset' } },
        ],
      },
    }],
  };
  const result = scanExportDependencies({
    variables: [{
      requires: '$use_custom_assets',
      '$fallback_asset': 'textures/ui/custom_fallback_when_requirement_is_true',
      '$shadowed_asset': 'textures/ui/custom_shadowed_when_requirement_is_true',
    }],
  }, {
    rootNamespace: 'composition',
    rootAuthoredKey: 'derived@composition.base',
    rootRecordId: 'derived',
    resolveUiSymbolCandidates: (qualifiedName) => records[qualifiedName] || [],
  });

  assertDeepEqual(result.textureRefs, [
    'textures/ui/base_default_when_requirement_is_false',
    'textures/ui/base_exact_when_requirement_is_false',
    'textures/ui/custom_fallback_when_requirement_is_true',
    'textures/ui/custom_shadowed_when_requirement_is_true',
  ]);
  assertEqual(result.complete, true);
  assertEqual(result.dependencyClosureComplete, true);
});

test('export dependency inheritance retains conditional base defaults when a caller exact is conditional', () => {
  const records = {
    'composition.base': [{
      id: 'base',
      namespace: 'composition',
      rawKey: 'base',
      value: {
        variables: [{
          requires: '$base_branch',
          '$asset|default': 'textures/ui/base_conditional_default',
        }],
        controls: [{ image: { type: 'image', texture: '$asset' } }],
      },
    }],
  };
  const result = scanExportDependencies({
    variables: [{
      requires: '$caller_branch',
      '$asset': 'textures/ui/caller_conditional_exact',
    }],
  }, {
    rootNamespace: 'composition',
    rootAuthoredKey: 'derived@composition.base',
    rootRecordId: 'derived',
    resolveUiSymbolCandidates: (qualifiedName) => records[qualifiedName] || [],
  });

  assertDeepEqual(result.textureRefs, [
    'textures/ui/base_conditional_default',
    'textures/ui/caller_conditional_exact',
  ]);
  assertEqual(result.complete, true);
  assertEqual(result.dependencyClosureComplete, true);
});

test('export dependency conditional defaults are independent of sibling branch order', () => {
  const firstExact = scanExportDependencies({
    variables: [
      { requires: '$a', '$asset': 'textures/ui/exact_a' },
      { requires: '$b', '$asset|default': 'textures/ui/default_b' },
    ],
    texture: '$asset',
  });
  const firstDefault = scanExportDependencies({
    variables: [
      { requires: '$b', '$asset|default': 'textures/ui/default_b' },
      { requires: '$a', '$asset': 'textures/ui/exact_a' },
    ],
    texture: '$asset',
  });

  const expected = ['textures/ui/default_b', 'textures/ui/exact_a'];
  assertDeepEqual(firstExact.textureRefs, expected);
  assertDeepEqual(firstDefault.textureRefs, expected);
  assertEqual(firstExact.complete, true);
  assertEqual(firstDefault.complete, true);
});

test('export dependency composition traversal fails closed at its shared record limit', () => {
  const records = {
    'composition.a': [{
      id: 'a', namespace: 'composition', rawKey: 'a@composition.b', value: { texture: '$asset' },
    }],
    'composition.b': [{
      id: 'b', namespace: 'composition', rawKey: 'b@composition.c', value: { texture: '$asset' },
    }],
    'composition.c': [{
      id: 'c', namespace: 'composition', rawKey: 'c', value: { texture: '$asset' },
    }],
  };
  const result = scanExportDependencies({ '$asset': 'textures/ui/caller' }, {
    rootNamespace: 'composition',
    rootAuthoredKey: 'derived@composition.a',
    rootRecordId: 'derived',
    resolveUiSymbolCandidates: (qualifiedName) => records[qualifiedName] || [],
    limits: { maxCompositionRecordVisits: 1 },
  });

  assertEqual(result.complete, false);
  assert(result.limitReasons.includes('UI composition record visits'));
});

test('export dependency scan bounds conditional branches and alias depth with warnings', () => {
  const result = scanExportDependencies({
    '$icon': 'textures/ui/base',
    '$alias_a': '$alias_b',
    '$alias_b': '$alias_c',
    '$alias_c': 'textures/ui/too_deep',
    variables: [
      { requires: '$first', '$icon': 'textures/ui/first' },
      { requires: '$second', '$icon': 'textures/ui/second' },
    ],
    texture: '$icon',
    hover_texture: '$alias_a',
  }, {
    limits: {
      maxConditionalBranches: 1,
      maxVariableDepth: 1,
    },
  });

  assertDeepEqual(result.textureRefs, ['textures/ui/base', 'textures/ui/first']);
  assert(result.diagnostics.some((item) => item.code === 'EXPORT_DEPENDENCY_SCAN_LIMIT'
    && item.reason === 'conditional variable branches'));
  assert(result.diagnostics.some((item) => item.code === 'EXPORT_ASSET_VARIABLE_UNRESOLVED'
    && item.reference === '$alias_a'
    && item.reason === 'variable-depth-limit'));
});

test('export dependency scan normalizes safe UI refs and diagnoses unsafe paths without throwing', () => {
  const result = scanExportDependencies({
    safe_ref: 'ui/nested/safe.jsonc',
    backslash_ref: 'ui\\nested\\unsafe.jsonc',
    traversal_ref: '../ui/escape.json',
    absolute_ref: '/ui/absolute.json',
  });

  assertDeepEqual(result.uiJsonRefs, ['ui/nested/safe.jsonc', 'ui/nested/unsafe.jsonc']);
  assertEqual(result.diagnostics.filter((item) => item.code === 'EXPORT_UI_REFERENCE_INVALID').length, 2);
  assert(result.diagnostics.every((item) => String(item.message || '').includes('ui/export-test.json')));
});

test('export dependency scan collects bounded native renderer props from unopened UI JSON', () => {
  const result = scanExportDependencies({
    '$renderer_name': 'inventory_item_renderer',
    controls: [
      {
        payment: {
          type: 'custom',
          renderer: '$renderer_name',
          property_bag: { '#item_id_aux': 742 * 0x1_0000 },
        },
      },
      {
        book: {
          type: 'custom',
          renderer: 'enchanting_book_renderer',
        },
      },
    ],
  });

  assertEqual(result.nativeRenderers.length, 2);
  assertEqual(result.nativeRenderers[0].props.renderer, 'inventory_item_renderer');
  assertEqual(result.nativeRenderers[0].props.property_bag['#item_id_aux'], 742 * 0x1_0000);
  assertEqual(result.nativeRenderers[1].props.renderer, 'enchanting_book_renderer');
  assertDeepEqual(result.diagnostics, []);
});

test('export dependency scan diagnoses dynamic native renderers and bounds their collection', () => {
  const result = scanExportDependencies({
    controls: [
      { dynamic: { type: 'custom', renderer: '#runtime_renderer' } },
      { first: { type: 'custom', renderer: 'inventory_item_renderer' } },
      { second: { type: 'custom', renderer: 'live_horse_renderer' } },
    ],
  }, { limits: { maxNativeRenderers: 1 } });

  assertEqual(result.nativeRenderers.length, 1);
  assert(result.diagnostics.some((item) => item.code === 'EXPORT_NATIVE_RENDERER_DYNAMIC'
    && item.reason === 'dynamic-reference'));
  assert(result.diagnostics.some((item) => item.code === 'EXPORT_DEPENDENCY_SCAN_LIMIT'
    && item.reason === 'native renderer controls'));
});

test('export dependency scan retains item ids separated from composed native templates', () => {
  const result = scanExportDependencies({
    namespace: 'beacon',
    item_renderer: {
      type: 'custom',
      renderer: 'inventory_item_renderer',
    },
    'netherite@beacon.item_renderer': {
      property_bag: { '#item_id_aux': 742 * 0x1_0000 },
    },
  });

  assertEqual(result.nativeRenderers.length, 1);
  assertEqual(result.nativeItemIds.length, 1);
  assertEqual(result.nativeItemIds[0].props['#item_id_aux'], 742 * 0x1_0000);
});

test('export dependency scan diagnoses non-fixed native item ids', () => {
  const result = scanExportDependencies({
    specialized: {
      property_bag: { '#item_id_aux': '#runtime_item_id' },
    },
  });
  assert(result.diagnostics.some((item) => item.code === 'EXPORT_NATIVE_ITEM_ID_DYNAMIC'
    && item.reason === 'non-fixed-packed-item-id'));
  assertEqual(result.nativeItemIds.length, 0);
});

test('export dependency scan treats signed packed Bedrock item ids as fixed facts', () => {
  const result = scanExportDependencies({
    loom_item: { '#item_id_aux': -13_369_344 },
  });
  assertEqual(result.nativeItemIds.length, 1);
  assertEqual(result.nativeItemIds[0].props['#item_id_aux'], -13_369_344);
  assert(!result.diagnostics.some((item) => item.code === 'EXPORT_NATIVE_ITEM_ID_DYNAMIC'));
});

test('export dependency scan exposes fixed composition and template symbols for lower-pack closure', () => {
  const external = scanExportDependencies({
    namespace: 'custom',
    'overlay@vanilla.native_base': {
      size: [20, 20],
      grid_item_template: '@vanilla.row',
      collection_item_template: 'local_row',
      factory: { control_name: 'custom.factory_row' },
    },
  });
  assertDeepEqual(external.uiSymbolRefs, [
    'custom.factory_row',
    'custom.local_row',
    'vanilla.native_base',
    'vanilla.row',
  ]);

  const local = scanExportDependencies({
    namespace: 'custom',
    'overlay@custom.native_base': { size: [20, 20] },
  });
  assertDeepEqual(local.uiSymbolRefs, ['custom.native_base']);
});

test('export dependency scan parses the instance prefix in factory control_name references', () => {
  const result = scanExportDependencies({
    namespace: 'content_log_history',
    messages_stack_panel: {
      type: 'stack_panel',
      factory: {
        name: 'messages_factory',
        control_name: 'content_log_message@content_log_history.content_log_message_panel',
      },
    },
  });

  assertDeepEqual(result.uiSymbolRefs, ['content_log_history.content_log_message_panel']);
  assert(!result.diagnostics.some((item) => item.code === 'EXPORT_UI_SYMBOL_DYNAMIC'));
});

test('export dependency scan collects literal control_ids from structural and standalone factories', () => {
  const result = scanExportDependencies({
    namespace: 'chat',
    messages_stack_panel: {
      factory: {
        name: 'messages_factory',
        control_ids: {
          chat_screen_messages: 'chat_screen_messages@chat.message_tts_wrapper',
          plain_message: 'chat.plain_message',
        },
      },
    },
    popup_dialog_factory: {
      type: 'factory',
      control_name: '@chat.standalone_row',
      control_ids: {
        toast_message: '@chat.popup_toast',
      },
    },
  });

  assertDeepEqual(result.uiSymbolRefs, [
    'chat.message_tts_wrapper',
    'chat.plain_message',
    'chat.popup_toast',
    'chat.standalone_row',
  ]);
});

test('export dependency scan resolves variable-object factory control_ids', () => {
  const result = scanExportDependencies({
    namespace: 'common',
    '$slider_step_factory_control_ids': {
      slider_step: '@common.slider_step',
      slider_step_hover: 'hover@common.slider_step_hover',
    },
    slider: {
      factory: {
        name: 'slider_step_factory',
        control_ids: '$slider_step_factory_control_ids',
      },
    },
  });

  assertDeepEqual(result.uiSymbolRefs, [
    'common.slider_step',
    'common.slider_step_hover',
  ]);
  assert(!result.diagnostics.some((item) => item.code === 'EXPORT_UI_SYMBOL_DYNAMIC'));
  assertEqual(result.dependencyClosureComplete, true);
});

test('export dependency scan exposes unresolved inherited factory context as an open closure', () => {
  const result = scanExportDependencies({
    namespace: 'inherited_export',
    base: {
      type: 'stack_panel',
      factory: { name: 'rows_factory', control_ids: '$ids' },
    },
    target: { type: 'label', text: 'target' },
    'screen@inherited_export.base': {
      '$ids': { only: 'row@inherited_export.target' },
    },
  });

  // The raw scanner intentionally does not execute cross-definition
  // inheritance. The catalog closes this edge composition-aware; callers that
  // use the scanner alone must not mistake a warning-only result for a closed
  // dependency graph.
  assertEqual(result.complete, true);
  assertEqual(result.dependencyClosureComplete, false);
  assert(result.unresolvedUiSymbolReasons.includes('missing-variable'));
  assert(result.diagnostics.some((item) => (
    item.code === 'EXPORT_UI_SYMBOL_DYNAMIC'
      && item.property === 'control_ids'
      && item.reason === 'missing-variable'
  )));
});

test('export dependency scan resolves exact variables in grid templates and definition suffixes', () => {
  const result = scanExportDependencies({
    namespace: 'common',
    '$grid_template': 'common.container_item',
    '$item_renderer': 'common.item_renderer',
    inventory_grid: {
      type: 'grid',
      grid_item_template: '$grid_template',
    },
    item_panel: {
      controls: [
        { '$item_renderer@$item_renderer': {} },
      ],
    },
  });

  assertDeepEqual(result.uiSymbolRefs, [
    'common.container_item',
    'common.item_renderer',
  ]);
  assert(!result.diagnostics.some((item) => item.code === 'EXPORT_UI_SYMBOL_DYNAMIC'));
});

test('export dependency scan retains numeric packed item ids reached through static variables', () => {
  const result = scanExportDependencies({
    '$payment_item': 742 * 0x1_0000,
    payment: { property_bag: { '#item_id_aux': '$payment_item' } },
  });
  assertEqual(result.nativeItemIds.length, 1);
  assertEqual(result.nativeItemIds[0].props['#item_id_aux'], 742 * 0x1_0000);
  assert(!result.diagnostics.some((item) => item.code === 'EXPORT_NATIVE_ITEM_ID_DYNAMIC'));
});

test('dependency scan completion remains false when diagnostic capacity hides a native limit', () => {
  const controls = [];
  for (let index = 0; index < 70; index += 1) {
    controls.push({ [`dynamic_${index}`]: { texture: `#runtime_${index}` } });
  }
  controls.push({ first: { renderer: 'inventory_item_renderer' } });
  controls.push({ second: { renderer: 'live_horse_renderer' } });
  const result = scanExportDependencies({ controls }, {
    limits: { maxDiagnostics: 2, maxNativeRenderers: 1 },
  });
  assertEqual(result.nativeRenderers.length, 1);
  assertEqual(result.complete, false);
  assert(result.limitReasons.includes('diagnostics'));
  assert(result.limitReasons.includes('native renderer controls'));
});

test('dependency scan completion is false for every variable-resolution safety bound', () => {
  const depthLimited = scanExportDependencies({
    '$a': '$b',
    '$b': '$c',
    '$c': 'textures/ui/depth',
    texture: '$a',
  }, { limits: { maxVariableDepth: 1 } });
  assertEqual(depthLimited.complete, false, 'variable depth limit must fail closed');
  assert(depthLimited.diagnostics.some((item) => item.reason === 'variable-depth-limit'));

  const stepLimited = scanExportDependencies({
    '$a': '$b',
    '$b': 'textures/ui/steps',
    texture: '$a',
  }, { limits: { maxVariableSteps: 1 } });
  assertEqual(stepLimited.complete, false, 'variable step limit must fail closed');
  assert(stepLimited.diagnostics.some((item) => item.reason === 'variable-step-limit'));

  const alternativeLimited = scanExportDependencies({
    '$a': '$b',
    '$b': 'textures/ui/first',
    '$c': 'textures/ui/third',
    variables: [
      { requires: '$use_c', '$a': '$c' },
      { requires: '$use_second_b', '$b': 'textures/ui/second' },
    ],
    texture: '$a',
  }, { limits: { maxAlternatives: 2 } });
  assertEqual(alternativeLimited.complete, false, 'variable alternative limit must fail closed');
  assert(alternativeLimited.diagnostics.some((item) => item.reason === 'alternative-limit'));
});
