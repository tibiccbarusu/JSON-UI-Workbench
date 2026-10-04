import { test, assert, assertDeepEqual, assertEqual } from './test-harness.js';
import { evaluateBindingsForUiModel, safeEvalExpression } from '../src/bindings/bindings-evaluator.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';

test('evaluateBindingsForUiModel applies global + view bindings', () => {
  const uiModel = {
    root: {
      id: 'root',
      key: { local_name: 'root', raw: 'root' },
      type: 'panel',
      props: { visible: true },
      bindings: [],
      children: [
        {
          id: 'a',
          key: { local_name: 'a', raw: 'a' },
          type: 'label',
          props: { visible: true },
          children: [],
          bindings: [
            {
              binding_type: 'global',
              binding_name: '#mock_visible',
              binding_name_override: '#visible',
            },
          ],
        },
        {
          id: 'b',
          key: { local_name: 'b', raw: 'b' },
          type: 'label',
          props: { visible: true },
          children: [],
          bindings: [
            {
              binding_type: 'view',
              source_control_name: 'a',
              source_property_name: '(#visible == true)',
              target_property_name: '#visible',
            },
          ],
        },
      ],
    },
  };

  const res = evaluateBindingsForUiModel(uiModel, { mockData: { '#mock_visible': false } });
  assert(res && res.propsById && typeof res.propsById === 'object', 'Expected propsById');

  // Node a: global binding sets visible=false
  assertEqual(Boolean(res.propsById.a.visible), false);

  // Node b: view binding reads a.visible and sets itself
  assertEqual(Boolean(res.propsById.b.visible), false);

  // Basic stats sanity
  assert(res.stats.nodeCount === 3, 'Expected nodeCount=3');
  assert(res.stats.bindingsSeen === 2, 'Expected bindingsSeen=2');
});

test('missing runtime visibility remains unresolved instead of becoming visible', () => {
  const uiModel = {
    root: {
      id: 'root',
      key: { local_name: 'root', raw: 'root' },
      type: 'panel',
      props: {},
      bindings: [],
      children: [{
        id: 'runtime',
        key: { local_name: 'runtime', raw: 'runtime' },
        type: 'panel',
        props: { visible: true },
        bindings: [{
          binding_type: 'global',
          binding_name: '#device_only',
          binding_name_override: '#visible',
        }],
        children: [],
      }],
    },
  };

  const res = evaluateBindingsForUiModel(uiModel, { mockData: {} });
  assertEqual(res.stats.bindingsApplied, 0);
  assertEqual(res.stats.bindingsSkipped, 1);
  assertEqual(typeof res.propsById.runtime.visible, 'string');
  assert(String(res.propsById.runtime.visible).includes('unresolved_runtime_visibility'));
});

test('missing global runtime clip_ratio fails closed instead of drawing a full progress image', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'progress', key: { local_name: 'progress', raw: 'progress' }, type: 'image',
        props: { clip_ratio: 1, texture: 'textures/ui/progress' }, children: [],
        bindings: [{
          binding_type: 'global', binding_name: '#runtime_progress', binding_name_override: '#clip_ratio',
        }],
      }],
    },
  };

  const res = evaluateBindingsForUiModel(uiModel, { mockData: {} });
  assertEqual(res.propsById.progress.clip_ratio, 0);
  assertEqual(res.stats.bindingsApplied, 0);
  assertEqual(res.stats.bindingsSkipped, 1);
});

test('missing view runtime clip_ratio fails closed', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        { id: 'state', key: { local_name: 'state', raw: 'state' }, type: 'panel', props: {}, bindings: [], children: [] },
        {
          id: 'progress', key: { local_name: 'progress', raw: 'progress' }, type: 'image',
          props: { clip_ratio: 1 }, children: [],
          bindings: [{
            binding_type: 'view', source_control_name: 'state', source_property_name: '#runtime_progress',
            target_property_name: '#clip_ratio',
          }],
        },
      ],
    },
  };

  const res = evaluateBindingsForUiModel(uiModel, { mockData: {} });
  assertEqual(res.propsById.progress.clip_ratio, 0);
  assertEqual(res.stats.bindingsApplied, 0);
  assertEqual(res.stats.bindingsSkipped, 1);
});

test('resolved clip_ratio bindings override the fail-closed default', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        {
          id: 'global_progress', key: { local_name: 'global_progress', raw: 'global_progress' }, type: 'image',
          props: { clip_ratio: 1 }, children: [],
          bindings: [{
            binding_type: 'global', binding_name: '#global_progress', binding_name_override: '#clip_ratio',
          }],
        },
        {
          id: 'state', key: { local_name: 'state', raw: 'state' }, type: 'panel',
          props: { progress: 0.75 }, bindings: [], children: [],
        },
        {
          id: 'view_progress', key: { local_name: 'view_progress', raw: 'view_progress' }, type: 'image',
          props: { clip_ratio: 1 }, children: [],
          bindings: [{
            binding_type: 'view', source_control_name: 'state', source_property_name: '#progress',
            target_property_name: '#clip_ratio',
          }],
        },
      ],
    },
  };

  const res = evaluateBindingsForUiModel(uiModel, { mockData: { '#global_progress': 0.5 } });
  assertEqual(res.propsById.global_progress.clip_ratio, 0.5);
  assertEqual(res.propsById.view_progress.clip_ratio, 0.75);
  assertEqual(res.stats.bindingsApplied, 2);
  assertEqual(res.stats.bindingsSkipped, 0);
});

test('missing unrelated runtime properties retain their authored values', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        { id: 'state', key: { local_name: 'state', raw: 'state' }, type: 'panel', props: {}, bindings: [], children: [] },
        {
          id: 'global_image', key: { local_name: 'global_image', raw: 'global_image' }, type: 'image',
          props: { texture: 'textures/ui/authored_global' }, children: [],
          bindings: [{
            binding_type: 'global', binding_name: '#runtime_texture', binding_name_override: '#texture',
          }],
        },
        {
          id: 'view_image', key: { local_name: 'view_image', raw: 'view_image' }, type: 'image',
          props: { texture: 'textures/ui/authored_view' }, children: [],
          bindings: [{
            binding_type: 'view', source_control_name: 'state', source_property_name: '#runtime_texture',
            target_property_name: '#texture',
          }],
        },
      ],
    },
  };

  const res = evaluateBindingsForUiModel(uiModel, { mockData: {} });
  assertEqual(res.propsById.global_image.texture, 'textures/ui/authored_global');
  assertEqual(res.propsById.view_image.texture, 'textures/ui/authored_view');
  assertEqual(res.stats.bindingsApplied, 0);
  assertEqual(res.stats.bindingsSkipped, 2);
});

test('literal hash collection names and grid positions select the matching scoped rows', () => {
  const makeCell = (id, row) => ({
    id,
    key: { local_name: id, raw: id },
    type: 'panel',
    props: { grid_position: [0, row], text: 'authored' },
    children: [],
    bindings: [{
      binding_type: 'collection',
      binding_collection_name: '#runtime_rows',
      binding_name: '#row_text',
      binding_name_override: '#text',
    }],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'grid', key: { local_name: 'grid', raw: 'grid' }, type: 'grid',
        props: { grid_dimensions: [1, 3] }, bindings: [],
        children: [makeCell('row_0', 0), makeCell('row_1', 1), makeCell('row_2', 2)],
      }],
    },
  };

  const res = evaluateBindingsForUiModel(uiModel, {
    collectionData: {
      '#runtime_rows': [
        { '#row_text': 'first' },
        { '#row_text': 'second' },
        { '#row_text': 'third' },
      ],
    },
  });
  assertEqual(res.propsById.row_0.text, 'first');
  assertEqual(res.propsById.row_1.text, 'second');
  assertEqual(res.propsById.row_2.text, 'third');
  assertEqual(res.stats.bindingsApplied, 3);
});

test('vertical collection grids derive row indices in authored fill order', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'grid',
      props: { grid_dimensions: [2, 2], grid_fill_direction: 'vertical' }, bindings: [],
      children: [{
        id: 'cell', key: { local_name: 'cell', raw: 'cell' }, type: 'label',
        props: { grid_position: [1, 0], text: 'authored' }, children: [],
        bindings: [{
          binding_type: 'collection', binding_collection_name: '#rows',
          binding_name: '#text', binding_name_override: '#text',
        }],
      }],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, {
    collectionData: { '#rows': [{ '#text': '0' }, { '#text': '1' }, { '#text': '2' }, { '#text': '3' }] },
  });
  assertEqual(res.propsById.cell.text, '2');
});

test('fixed decorative grids keep separate singleton collections on row zero', () => {
  const makeCell = (id, column, collectionName) => ({
    id, key: { local_name: id, raw: id }, type: 'label',
    props: { grid_position: [column, 0], text: 'authored' }, children: [],
    bindings: [{
      binding_type: 'collection', binding_collection_name: collectionName,
      binding_name: '#text', binding_name_override: '#text',
    }],
  });
  const uiModel = {
    root: {
      id: 'grid', key: { local_name: 'grid', raw: 'grid' }, type: 'grid',
      props: { grid_dimensions: [4, 1] }, bindings: [],
      children: [
        makeCell('ingredient_a', 0, 'ingredient_a_items'),
        makeCell('ingredient_b', 1, 'ingredient_b_items'),
        makeCell('result', 3, 'result_items'),
      ],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, {
    collectionData: {
      ingredient_a_items: [{ '#text': 'emerald' }],
      ingredient_b_items: [{ '#text': 'iron' }],
      result_items: [{ '#text': 'diamond' }],
    },
  });
  assertEqual(result.propsById.ingredient_a.text, 'emerald');
  assertEqual(result.propsById.ingredient_b.text, 'iron');
  assertEqual(result.propsById.result.text, 'diamond');
});

test('global binding expressions use representative mock values safely', () => {
  const uiModel = {
    root: {
      id: 'root',
      key: { local_name: 'root', raw: 'root' },
      type: 'panel',
      props: {},
      bindings: [],
      children: [{
        id: 'creative',
        key: { local_name: 'creative', raw: 'creative' },
        type: 'panel',
        props: { visible: false },
        bindings: [{
          binding_type: 'global',
          binding_name: '(not #is_survival_layout)',
          binding_name_override: '#visible',
        }],
        children: [],
      }],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, { mockData: { '#is_survival_layout': false } });
  assertEqual(res.propsById.creative.visible, true);
  assertEqual(res.stats.bindingsApplied, 1);
});

test('collection_details supplies one bounded row context independent of binding order', () => {
  const makeNode = (id, index) => ({
    id,
    key: { local_name: id, raw: id },
    type: 'label',
    props: {
      collection_index: index,
      __jsonui_preview_collection_name: 'offers',
      text: 'authored',
      visible: false,
    },
    children: [],
    bindings: [
      { binding_name: '#row_text', binding_name_override: '#text' },
      { binding_type: 'collection_details', binding_collection_name: 'offers' },
      { binding_name: '#row_visible', binding_name_override: '#visible' },
    ],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [makeNode('first', 0), makeNode('second', 1)],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, {
    collectionData: {
      offers: [
        { '#row_text': 'first row', '#row_visible': true },
        { '#row_text': 'second row', '#row_visible': false },
      ],
    },
  });
  assertEqual(result.propsById.first.text, 'first row');
  assertEqual(result.propsById.first.visible, true);
  assertEqual(result.propsById.second.text, 'second row');
  assertEqual(result.propsById.second.visible, false);
});

test('collection_details keeps null values and supplies explicit global bindings row-first', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'row', key: { local_name: 'row', raw: 'row' }, type: 'label',
        props: { collection_index: 0, __jsonui_preview_collection_name: 'rows', text: 'authored' }, children: [],
        bindings: [
          { binding_type: 'collection_details', binding_collection_name: 'rows' },
          { binding_name: '#nullable', binding_name_override: '#text' },
          { binding_type: 'global', binding_name: '#global_value', binding_name_override: '#color' },
          { binding_type: 'global', binding_name: '#global_fallback', binding_name_override: '#font_type' },
        ],
      }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, {
    collectionData: { rows: [{ '#nullable': null, '#global_value': 'row must not win' }] },
    mockData: {
      '#nullable': 'global must not replace null',
      '#global_value': 'global fallback must not replace row',
      '#global_fallback': 'global fallback',
    },
  });
  assertEqual(result.propsById.row.text, null);
  assertEqual(result.propsById.row.color, 'row must not win');
  assertEqual(result.propsById.row.font_type, 'global fallback');
});

test('collection_details fails closed when bindings change the selected row context', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'owner', key: { local_name: 'owner', raw: 'owner' }, type: 'collection_panel',
        props: { collection_name: 'a', next_collection: 'b' },
        bindings: [{
          binding_type: 'view', source_property_name: '#next_collection',
          target_property_name: '#collection_name',
        }],
        children: [{
          id: 'row', key: { local_name: 'row', raw: 'row' }, type: 'label',
          props: { text: 'authored' },
          bindings: [
            { binding_type: 'collection_details' },
            { binding_type: 'global', binding_name: '#label', binding_name_override: '#text' },
          ],
          children: [],
        }],
      }, {
        id: 'observer', key: { local_name: 'observer', raw: 'observer' }, type: 'label',
        props: { text: 'observer authored' },
        bindings: [{
          binding_type: 'view', source_control_name: 'row', source_property_name: '#text',
          target_property_name: '#text',
        }],
        children: [],
      }, {
        id: 'stable_source', key: { local_name: 'stable_source', raw: 'stable_source' }, type: 'panel',
        props: { text: 'independent resolved' }, bindings: [], children: [],
      }, {
        id: 'independent', key: { local_name: 'independent', raw: 'independent' }, type: 'label',
        props: { text: 'independent authored' },
        bindings: [{
          binding_type: 'view', source_control_name: 'stable_source', source_property_name: '#text',
          target_property_name: '#text',
        }],
        children: [],
      }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, {
    collectionData: {
      a: [{ '#label': 'stale A' }],
      b: [{ '#label': 'unreached B' }],
    },
  });
  assertEqual(result.propsById.owner.collection_name, 'a');
  assertEqual(result.propsById.row.text, 'authored');
  assertEqual(result.propsById.observer.text, 'observer authored');
  assertEqual(result.propsById.independent.text, 'independent resolved');
  assertEqual(Object.prototype.hasOwnProperty.call(
    result.propsById.row,
    '__jsonui_preview_collection_details',
  ), false);
  assert(result.warnings.includes('COLLECTION_CONTEXT_RUNTIME_DEPENDENT:count=1'));
});

test('an optional collection-details descriptor with no collection context is a no-op', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel',
      props: { text: 'authored' }, children: [],
      bindings: [{ binding_type: 'collection_details' }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel);
  assertEqual(result.propsById.root.text, 'authored');
  assert(!result.warnings.some((warning) => warning.startsWith('COLLECTION_NAME_')));
});

test('prefixed collection details warn only for branches active in the representative view', () => {
  const detailBinding = {
    binding_type: 'collection_details',
    binding_collection_name: 'rows',
    binding_collection_prefix: 'row',
  };
  const makeNode = (id, props, bindings = [detailBinding]) => ({
    id, key: { local_name: id, raw: id }, type: 'panel', props, bindings, children: [],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        makeNode('inactive', { ignored: true }),
        makeNode('active', { ignored: false }),
        makeNode('runtime', { visible: false }, [
          detailBinding,
          { binding_type: 'view', source_property_name: '#missing', target_property_name: '#visible' },
        ]),
      ],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, { mockData: {} });
  assert(result.warnings.includes('COLLECTION_DETAILS_PREFIX_RUNTIME_DEPENDENT:count=2'));
});

test('nested collection boundaries do not reuse an outer row index for a singleton inner grid', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'outer', key: { local_name: 'outer', raw: 'outer' }, type: 'panel',
        props: { collection_index: 1, __jsonui_preview_collection_name: 'offers' }, bindings: [],
        children: [{
          id: 'inner_grid', key: { local_name: 'inner_grid', raw: 'inner_grid' }, type: 'grid',
          props: { collection_name: 'items', grid_dimensions: [1, 1] }, bindings: [],
          children: [{
            id: 'item', key: { local_name: 'item', raw: 'item' }, type: 'label',
            props: { text: 'authored', grid_position: [0, 0] }, children: [],
            bindings: [
              { binding_type: 'collection_details' },
              { binding_name: '#name', binding_name_override: '#text' },
            ],
          }],
        }],
      }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, {
    collectionData: {
      offers: [{}, {}],
      items: [{ '#name': 'inner row zero' }, { '#name': 'wrong outer index' }],
    },
  });
  assertEqual(result.propsById.item.text, 'inner row zero');
});

test('an unscoped decorative grid preserves its outer named collection row', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'offer', key: { local_name: 'offer', raw: 'offer' }, type: 'panel',
        props: { collection_index: 1, __jsonui_preview_collection_name: 'offers' }, bindings: [],
        children: [{
          id: 'decoration', key: { local_name: 'decoration', raw: 'decoration' }, type: 'grid',
          props: { grid_dimensions: [1, 1] }, bindings: [],
          children: [{
            id: 'label', key: { local_name: 'label', raw: 'label' }, type: 'label',
            props: { grid_position: [0, 0], text: 'authored' }, children: [],
            bindings: [{
              binding_type: 'collection', binding_collection_name: 'offers',
              binding_name: '#name', binding_name_override: '#text',
            }],
          }],
        }],
      }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, {
    collectionData: { offers: [{ '#name': 'row zero' }, { '#name': 'row one' }] },
  });
  assertEqual(result.propsById.label.text, 'row one');
});

test('view expressions with missing references do not invent boolean results', () => {
  const uiModel = {
    root: {
      id: 'root',
      key: { local_name: 'root', raw: 'root' },
      type: 'panel',
      props: {},
      bindings: [],
      children: [{
        id: 'source',
        key: { local_name: 'source', raw: 'source' },
        type: 'panel',
        props: {},
        bindings: [],
        children: [],
      }, {
        id: 'target',
        key: { local_name: 'target', raw: 'target' },
        type: 'panel',
        props: { visible: true },
        bindings: [{
          binding_type: 'view',
          source_control_name: 'source',
          source_property_name: '(not #missing)',
          target_property_name: '#visible',
          resolve_sibling_scope: true,
        }],
        children: [],
      }],
    },
  };

  const res = evaluateBindingsForUiModel(uiModel, { mockData: {} });
  assertEqual(res.stats.bindingsApplied, 0);
  assertEqual(res.stats.bindingsSkipped, 1);
  assert(String(res.propsById.target.visible).includes('unresolved_runtime_visibility'));
});

test('implicit global binding targets expose local runtime properties', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'label', key: { local_name: 'label', raw: 'label' }, type: 'label',
        props: { text: '#item_name' }, children: [],
        bindings: [{ binding_type: 'global', binding_name: '#item_name' }],
      }],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, { mockData: { '#item_name': '名札a' } });
  assertEqual(res.propsById.label.item_name, '名札a');
  assertEqual(res.stats.bindingsApplied, 1);
});

test('view bindings converge independently of inverse dependency order', () => {
  const makeNode = (id, props, bindings) => ({
    id, key: { local_name: id, raw: id }, type: 'panel', props, bindings, children: [],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        makeNode('a', { visible: true }, [{
          binding_type: 'view', source_control_name: 'b', source_property_name: '#visible', target_property_name: '#visible',
        }]),
        makeNode('b', { visible: true }, [{
          binding_type: 'view', source_control_name: 'c', source_property_name: '#visible', target_property_name: '#visible',
        }]),
        makeNode('c', { visible: true }, [{
          binding_type: 'global', binding_name: '#runtime_visible', binding_name_override: '#visible',
        }]),
      ],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, { mockData: { '#runtime_visible': false } });
  assertEqual(res.propsById.a.visible, false);
  assertEqual(res.propsById.b.visible, false);
  assertEqual(res.propsById.c.visible, false);
  assert(!res.warnings.some((warning) => warning.includes('NONCONVERGENT')));
});

test('long acyclic view-binding chains converge within the operation budget', () => {
  const children = [];
  for (let index = 0; index < 20; index += 1) {
    const id = `chain_${String(index).padStart(2, '0')}`;
    const nextId = `chain_${String(index + 1).padStart(2, '0')}`;
    children.push({
      id, key: { local_name: id, raw: id }, type: 'panel', props: { visible: true }, children: [],
      bindings: [{
        binding_type: 'view', source_control_name: nextId, source_property_name: '#visible',
        target_property_name: '#visible',
      }],
    });
  }
  children.push({
    id: 'chain_20', key: { local_name: 'chain_20', raw: 'chain_20' }, type: 'panel',
    props: { visible: false }, bindings: [], children: [],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel',
      props: {}, bindings: [], children,
    },
  };
  const result = evaluateBindingsForUiModel(uiModel);
  assertEqual(result.propsById.chain_00.visible, false);
  assert(!result.warnings.some((warning) => warning.includes('NONCONVERGENT')));
});

test('a view-bound ignored target continues updating until the chain converges', () => {
  const node = (id, props, bindings = []) => ({
    id, key: { local_name: id, raw: id }, type: 'panel', props, bindings, children: [],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        node('truth', { value: false }),
        node('gate', { value: true }, [{
          binding_type: 'view', source_control_name: 'truth', source_property_name: '#value',
          target_property_name: '#value', resolve_sibling_scope: true,
        }]),
        node('branch', { ignored: false }, [{
          binding_type: 'view', source_control_name: 'gate', source_property_name: '#value',
          target_property_name: '#ignored', resolve_sibling_scope: true,
        }]),
      ],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel);
  assertEqual(result.propsById.gate.value, false);
  assertEqual(result.propsById.branch.ignored, false);
  assert(!result.warnings.some((warning) => warning.includes('NONCONVERGENT')));
});

test('explicit sibling scope wins over a same-name ancestor', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'owner', key: { local_name: 'dup', raw: 'dup' }, type: 'panel', props: { visible: true }, bindings: [],
        children: [
          { id: 'sibling', key: { local_name: 'dup', raw: 'dup' }, type: 'panel', props: { visible: false }, bindings: [], children: [] },
          {
            id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'panel', props: { visible: true }, children: [],
            bindings: [{
              binding_type: 'view', source_control_name: 'dup', source_property_name: '#visible',
              target_property_name: '#visible', resolve_sibling_scope: true,
            }],
          },
        ],
      }],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel);
  assertEqual(res.propsById.target.visible, false);
  assert(!res.warnings.some((warning) => warning.includes('AMBIGUOUS')));
});

test('ambiguous global view sources fail closed instead of picking the first match', () => {
  const makeNode = (id, localName, visible) => ({
    id, key: { local_name: localName, raw: localName }, type: 'panel', props: { visible }, bindings: [], children: [],
  });
  const target = makeNode('target', 'target', true);
  target.bindings = [{
    binding_type: 'view', source_control_name: 'dup', source_property_name: '#visible', target_property_name: '#visible',
  }];
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [makeNode('first', 'dup', true), makeNode('second', 'dup', false), target],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel);
  assert(String(res.propsById.target.visible).includes('unresolved_runtime_visibility'));
  assert(res.warnings.some((warning) => warning.includes('VIEW_SOURCE_AMBIGUOUS')));
});

test('nonconvergent view bindings restore deterministic fail-closed gates', () => {
  const makeNode = (id, visible, binding) => ({
    id, key: { local_name: id, raw: id }, type: 'panel', props: { visible }, bindings: [binding], children: [],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        makeNode('a', false, { binding_type: 'view', source_control_name: 'b', source_property_name: '#visible', target_property_name: '#visible' }),
        makeNode('b', false, { binding_type: 'view', source_control_name: 'a', source_property_name: '(not #visible)', target_property_name: '#visible' }),
      ],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel);
  assert(String(res.propsById.a.visible).includes('unresolved_runtime_visibility'));
  assert(String(res.propsById.b.visible).includes('unresolved_runtime_visibility'));
  assertEqual(res.stats.bindingsApplied, 0);
  assertEqual(res.stats.bindingsSkipped, 2);
  assert(res.warnings.some((warning) => warning.includes('NONCONVERGENT')));
});

test('a view binding that later becomes unresolved is not counted as applied', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        {
          id: 'source', key: { local_name: 'source', raw: 'source' }, type: 'panel', props: {}, bindings: [], children: [],
        },
        {
          id: 'b', key: { local_name: 'b', raw: 'b' }, type: 'panel', props: { visible: true }, children: [],
          bindings: [{ binding_type: 'view', source_control_name: 'source', source_property_name: '#missing', target_property_name: '#visible' }],
        },
        {
          id: 'a', key: { local_name: 'a', raw: 'a' }, type: 'panel', props: { visible: true }, children: [],
          bindings: [{ binding_type: 'view', source_control_name: 'b', source_property_name: '#visible', target_property_name: '#visible' }],
        },
      ],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel);
  assert(String(res.propsById.a.visible).includes('unresolved_runtime_visibility'));
  assert(String(res.propsById.b.visible).includes('unresolved_runtime_visibility'));
  assertEqual(res.stats.bindingsApplied, 0);
  assertEqual(res.stats.bindingsSkipped, 2);
});

test('view binding budgets fail closed for truncated enabled gates', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{ id: 'source', key: { local_name: 'source', raw: 'source' }, type: 'panel', props: { enabled: true }, bindings: [], children: [] }, {
        id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'panel', props: { enabled: true }, children: [],
        bindings: [
          { binding_type: 'view', source_control_name: 'source', source_property_name: '#enabled', target_property_name: '#visible' },
          { binding_type: 'view', source_control_name: 'source', source_property_name: '#enabled', target_property_name: '#enabled' },
        ],
      }],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, { maxViewBindings: 1 });
  assert(String(res.propsById.target.enabled).includes('unresolved_runtime_visibility'));
  assert(res.warnings.some((warning) => warning.includes('VIEW_BINDING_BUDGET_EXCEEDED')));
});

test('collection bindings remain scoped by collection name and nearest index', () => {
  const collectionLabel = (id, collectionName, index) => ({
    id, key: { local_name: id, raw: id }, type: 'label', props: { text: '#item_name', collection_index: index }, children: [],
    bindings: [{ binding_type: 'collection', binding_collection_name: collectionName, binding_name: '#item_name' }],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        collectionLabel('input', 'anvil_input_items', 0),
        collectionLabel('material', 'anvil_material_items', 0),
        collectionLabel('result', 'anvil_result_items', 0),
      ],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, {
    mockData: { '#item_name': 'FLAT_MUST_NOT_LEAK' },
    collectionData: {
      anvil_input_items: [{ '#item_name': 'Input' }],
      anvil_material_items: [{ item_name: 'Material' }],
      anvil_result_items: [{ '#item_name': 'Result' }],
    },
  });
  assertEqual(res.propsById.input.item_name, 'Input');
  assertEqual(res.propsById.material.item_name, 'Material');
  assertEqual(res.propsById.result.item_name, 'Result');
});

test('collection-scope ambiguity ignores provably hard-inactive branches', () => {
  const collectionLabel = (id, collectionName) => ({
    id, key: { local_name: id, raw: id }, type: 'label',
    props: { text: 'authored' }, children: [],
    bindings: [{
      binding_type: 'collection', binding_collection_name: collectionName,
      binding_name: '#label', binding_name_override: '#text',
    }],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [], children: [
        {
          id: 'dead', key: { local_name: 'dead', raw: 'dead' }, type: 'panel',
          props: { ignored: true }, bindings: [], children: [collectionLabel('dead-label', 'dead_rows')],
        },
        collectionLabel('live-label', 'live_rows'),
      ],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, {
    mockData: { '#label': 'flat live value' },
  });
  assertEqual(result.propsById['live-label'].text, 'flat live value');
  assert(!result.warnings.some((warning) => warning.startsWith('COLLECTION_SCOPE_AMBIGUOUS')));
});

test('collection-name expressions resolve lexical variables without cross-collection fallback', () => {
  const makeModel = (prefix) => buildUiScreenModelFromJson({
    namespace: 'collection_expression',
    label: {
      type: 'label', '$panel_prefix': prefix, text: 'authored',
      bindings: [{
          binding_type: 'collection', binding_collection_name: '($panel_prefix + _panel)',
          binding_name: '#item_name', binding_name_override: '#text',
      }],
    },
  }, { filePath: 'ui/collection-expression.json' });
  const labelId = (model) => model.root.children.find((node) => node.key.local_name === 'label').id;

  const resolvedModel = makeModel('storage');
  const resolved = evaluateBindingsForUiModel(resolvedModel, {
    collectionData: { storage_panel: [{ '#item_name': 'Storage row' }] },
  });
  assertEqual(resolved.propsById[labelId(resolvedModel)].text, 'Storage row');
  assert(!resolved.warnings.some((warning) => warning.startsWith('COLLECTION_NAME_')));

  const unresolvedModel = makeModel('$missing_prefix');
  const unresolved = evaluateBindingsForUiModel(unresolvedModel, {
    mockData: { '#item_name': 'FLAT_MUST_NOT_LEAK' },
  });
  assertEqual(unresolved.propsById[labelId(unresolvedModel)].text, 'authored');
  assert(unresolved.warnings.includes(`COLLECTION_NAME_UNRESOLVED:${labelId(unresolvedModel)}`));

  const oversizedModel = makeModel('x'.repeat(513));
  const oversized = evaluateBindingsForUiModel(oversizedModel, {
    collectionData: { [`${'x'.repeat(513)}_panel`]: [{ '#item_name': 'MUST_NOT_APPLY' }] },
  });
  assertEqual(oversized.propsById[labelId(oversizedModel)].text, 'authored');
  assert(oversized.warnings.includes(`COLLECTION_NAME_INVALID:${labelId(oversizedModel)}`));
});

test('conditional variables provide bounded lexical collection-name parts', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'conditional_collection_expression',
    label: {
      type: 'label',
      '$kind': 'storage',
      variables: [
        { requires: '($kind = storage)', '$panel_prefix': 'storage' },
        { requires: '($panel_prefix = storage)', '$panel_suffix': '_panel' },
      ],
      text: 'authored',
      bindings: [{
        binding_type: 'collection',
        binding_collection_name: '($panel_prefix + $panel_suffix)',
        binding_name: '#item_name',
        binding_name_override: '#text',
      }],
    },
  }, { filePath: 'ui/conditional-collection-expression.json' });
  const label = model.root.children.find((node) => node.key.local_name === 'label');
  const result = evaluateBindingsForUiModel(model, {
    collectionData: { storage_panel: [{ '#item_name': 'Conditional row' }] },
  });
  assertEqual(result.propsById[label.id].text, 'Conditional row');
  assert(!result.warnings.some((warning) => warning.startsWith('COLLECTION_NAME_')));

  const malformedModel = buildUiScreenModelFromJson({
    namespace: 'malformed_conditional_collection',
    label: {
      type: 'label',
      variables: [{ requires: '(', '$panel_prefix': 'storage' }],
      text: 'authored',
      bindings: [{
        binding_type: 'collection', binding_collection_name: '($panel_prefix + _panel)',
        binding_name: '#item_name', binding_name_override: '#text',
      }],
    },
  }, { filePath: 'ui/malformed-conditional-collection.json' });
  const malformedLabel = malformedModel.root.children.find((node) => node.key.local_name === 'label');
  const malformed = evaluateBindingsForUiModel(malformedModel, {
    mockData: { '#item_name': 'FLAT_MUST_NOT_LEAK' },
    collectionData: { storage_panel: [{ '#item_name': 'MUST_NOT_APPLY' }] },
  });
  assertEqual(malformed.propsById[malformedLabel.id].text, 'authored');
  assert(malformed.warnings.includes(`COLLECTION_NAME_UNRESOLVED:${malformedLabel.id}`));
});

test('binding expressions resolve lexical dollar aliases transitively and fail closed on cycles', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'lexical_alias',
    resolved: {
      type: 'panel', '$a': '$b', '$b': 'hover', visible: false,
      bindings: [{
        binding_type: 'view', source_property_name: '($a = hover)', target_property_name: '#visible',
      }],
    },
    cyclic: {
      type: 'panel', '$a': '$b', '$b': '$a', visible: true,
      bindings: [{
        binding_type: 'view', source_property_name: '($a = hover)', target_property_name: '#visible',
      }],
    },
  }, { filePath: 'ui/lexical-alias.json' });
  const resolved = model.root.children.find((node) => node.key.local_name === 'resolved');
  const cyclic = model.root.children.find((node) => node.key.local_name === 'cyclic');
  const result = evaluateBindingsForUiModel(model);
  assertEqual(result.propsById[resolved.id].visible, true);
  assert(String(result.propsById[cyclic.id].visible).includes('unresolved_runtime_visibility'));
});

test('view-binding expressions inherit lexical variables from parsed ancestor controls', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'lexical_view',
    screen: {
      type: 'panel',
      controls: [
        { source: { type: 'panel', '#ready': true, '$local_gate': false } },
        { target: {
          type: 'panel', visible: false, '$local_gate': true,
          bindings: [{
            binding_type: 'view', source_control_name: 'source', resolve_sibling_scope: true,
            source_property_name: '(#ready and $local_gate)', target_property_name: '#visible',
          }],
        } },
      ],
    },
  }, { filePath: 'ui/lexical-view.json' });
  const screen = model.root.children[0];
  const target = screen.children.find((node) => node.key.local_name === 'target');
  const result = evaluateBindingsForUiModel(model);
  assertEqual(result.propsById[target.id].visible, true);
});

test('collection row lookup honors grid dimensions supplied by a runtime binding', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'grid', key: { local_name: 'grid', raw: 'grid' }, type: 'grid',
        props: { grid_dimension_binding: '#shape', grid_fill_direction: 'horizontal' },
        bindings: [{ binding_type: 'global', binding_name: '#runtime_shape', binding_name_override: '#shape' }],
        children: [{
          id: 'cell', key: { local_name: 'cell', raw: 'cell' }, type: 'label',
          props: { grid_position: [1, 1], text: '' }, children: [],
          bindings: [{
            binding_type: 'collection', binding_collection_name: '#runtime_cells',
            binding_name: '#item_name', binding_name_override: '#text',
          }],
        }],
      }],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, {
    mockData: { '#runtime_shape': [2, 2] },
    collectionData: {
      '#runtime_cells': [
        { '#item_name': 'zero' },
        { '#item_name': 'one' },
        { '#item_name': 'two' },
        { '#item_name': 'three' },
      ],
    },
  });
  assertDeepEqual(res.propsById.grid.shape, [2, 2]);
  assertEqual(res.propsById.cell.text, 'three');
});

test('ambiguous flat collection data does not leak across Anvil collections', () => {
  const makeLabel = (id, collectionName, sourceKey = '#item_name') => ({
    id, key: { local_name: id, raw: id }, type: 'label', props: { item_name: '' }, children: [],
    bindings: [{
      binding_type: 'collection', binding_collection_name: collectionName,
      binding_name: sourceKey, target_property_name: '#item_name',
    }],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [makeLabel('input', 'anvil_input_items', '#item_name'), makeLabel('result', 'anvil_result_items', 'item_name')],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, { mockData: { '#item_name': 'FLAT' } });
  assertEqual(res.propsById.input.item_name, '');
  assertEqual(res.propsById.result.item_name, '');
  assert(res.warnings.some((warning) => warning.includes('COLLECTION_SCOPE_AMBIGUOUS')));
});

test('property_bag values are lexical view defaults and explicit props win', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'source', key: { local_name: 'source', raw: 'source' }, type: 'panel',
        props: { property_bag: { '#toggle_state': true, '#visible': false }, visible: true }, bindings: [], children: [],
      }, {
        id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'panel', props: { visible: false }, children: [],
        bindings: [{ binding_type: 'view', source_control_name: 'source', source_property_name: '#toggle_state', target_property_name: '#visible' }],
      }],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel);
  assertEqual(res.propsById.source.visible, true);
  assertEqual(res.propsById.source.toggle_state, true);
  assertEqual(res.propsById.target.visible, true);
});

test('view source properties never fall through to same-name flat mock data', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{ id: 'source', key: { local_name: 'source', raw: 'source' }, type: 'panel', props: {}, bindings: [], children: [] }, {
        id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'panel', props: { visible: true }, children: [],
        bindings: [{ binding_type: 'view', source_control_name: 'source', source_property_name: '#same_name', target_property_name: '#visible' }],
      }],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, { mockData: { '#same_name': true } });
  assert(String(res.propsById.target.visible).includes('unresolved_runtime_visibility'));
});

test('duplicate view targets use declaration-order last write without a false cycle', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [
        { id: 'off', key: { local_name: 'off', raw: 'off' }, type: 'panel', props: { visible: false }, bindings: [], children: [] },
        { id: 'on', key: { local_name: 'on', raw: 'on' }, type: 'panel', props: { visible: true }, bindings: [], children: [] },
        {
          id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'panel', props: { visible: true }, children: [],
          bindings: [
            { binding_type: 'view', source_control_name: 'off', source_property_name: '#visible', target_property_name: '#visible' },
            { binding_type: 'view', source_control_name: 'on', source_property_name: '#visible', target_property_name: '#visible' },
          ],
        },
      ],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel);
  assertEqual(res.propsById.target.visible, true);
  assert(!res.warnings.some((warning) => warning.includes('NONCONVERGENT')));
});

test('oversized binding expressions fail closed within fixed budgets', () => {
  const expression = `(${Array.from({ length: 3000 }, () => '#gate').join(' or ')})`;
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [],
      children: [{
        id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'panel', props: { visible: true }, children: [],
        bindings: [{ binding_type: 'global', binding_name: expression, binding_name_override: '#visible' }],
      }],
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, { mockData: { '#gate': true } });
  assert(String(res.propsById.target.visible).includes('unresolved_runtime_visibility'));
});

test('total binding descriptor budgets fail closed at the screen root', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: { visible: true },
      children: [],
      bindings: Array.from({ length: 4 }, (_, index) => ({
        binding_type: 'global', binding_name: `#gate_${index}`, binding_name_override: '#visible',
      })),
    },
  };
  const res = evaluateBindingsForUiModel(uiModel, {
    maxTotalBindings: 2,
    mockData: { '#gate_0': true, '#gate_1': true, '#gate_2': true, '#gate_3': true },
  });
  assert(String(res.propsById.root.visible).includes('unresolved_runtime_visibility'));
  assert(String(res.propsById.root.enabled).includes('unresolved_runtime_visibility'));
  assert(res.warnings.some((warning) => warning.includes('BINDING_BUDGET_EXCEEDED')));
});

test('view bindings without source_control_name read the current node', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel',
      props: { property_bag: { '#ready': true }, visible: false }, children: [],
      bindings: [{
        binding_type: 'view',
        source_property_name: '(#ready and $desktop_screen)',
        target_property_name: '#visible',
      }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, { mockData: { '$desktop_screen': true } });
  assertEqual(result.propsById.root.visible, true);
  assert(!result.warnings.some((warning) => warning.includes('VIEW_BINDING_SOURCE_MISSING')));
});

test('safe expression grammar handles arithmetic, aliases and string concatenation', () => {
  const context = {
    mockData: {
      '$desktop_screen': true,
      '$alias': '$desktop_screen',
      '#count': 4,
    },
    props: {},
  };
  assertEqual(safeEvalExpression('($alias and (#count * 3 + 2 = 14))', context), true);
  assertEqual(safeEvalExpression("'slot-' + (#count % 3)", context), 'slot-1');
  assertEqual(safeEvalExpression('#count / 0', context), undefined);
  assertEqual(safeEvalExpression('1.2.3', context), undefined);
  assertEqual(safeEvalExpression("'unterminated", context), undefined);
});

test('safe expressions preserve marker namespaces and short-circuit unknown values', () => {
  const context = {
    mockData: {
      '$left': 9,
      '$right': 4,
      '$alias': '$right',
    },
    props: { right: 99 },
  };
  assertEqual(safeEvalExpression('$left-$right', context), 5);
  assertEqual(safeEvalExpression('$alias', context), 4);
  assertEqual(safeEvalExpression('false and $missing', context), false);
  assertEqual(safeEvalExpression('true or $missing', context), true);
  assertEqual(safeEvalExpression('$missing and false', context), false);
  assertEqual(safeEvalExpression('$missing or true', context), true);
  assertEqual(safeEvalExpression('true and $missing', context), undefined);
  assertEqual(safeEvalExpression('not $missing', context), undefined);
  assertEqual(safeEvalExpression('-$missing', context), undefined);
});

test('safe expressions treat unquoted Bedrock enum names as literals', () => {
  assertEqual(safeEvalExpression('($button_state = hover)', {
    mockData: { '$button_state': 'hover' }, props: {},
  }), true);
  assertEqual(safeEvalExpression('(($tab_state = checked_hover) or ($tab_state = pressed))', {
    mockData: { '$tab_state': 'checked_hover' }, props: {},
  }), true);
  assertEqual(safeEvalExpression('($visible_binding_type = collection)', {
    mockData: { '$visible_binding_type': 'collection' }, props: {},
  }), true);
});

test('binding targets cannot mutate object prototypes', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, children: [],
      bindings: [{ binding_type: 'global', binding_name: '#payload', binding_name_override: '#__proto__' }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, { mockData: { '#payload': { polluted: true } } });
  assertEqual(Object.prototype.polluted, undefined);
  assertEqual(Object.prototype.hasOwnProperty.call(result.propsById.root, '__proto__'), false);
});

test('binding_condition none is sampled once while binding_type none remains inactive', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, children: [
        {
          id: 'sampled', key: { local_name: 'sampled', raw: 'sampled' }, type: 'panel',
          props: { visible: true }, children: [], bindings: [{
            binding_type: 'global', binding_condition: 'none', binding_name: '#gate', binding_name_override: '#visible',
          }],
        },
        {
          id: 'disabled', key: { local_name: 'disabled', raw: 'disabled' }, type: 'panel',
          props: { visible: true }, children: [], bindings: [{
            binding_type: 'none', binding_name: '#gate', binding_name_override: '#visible',
          }],
        },
      ], bindings: [],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, { mockData: { '#gate': false } });
  assertEqual(result.propsById.sampled.visible, false);
  assertEqual(result.propsById.disabled.visible, true);
});

test('dynamic view sources and expression-produced marker keys resolve one bounded level', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [], children: [
        {
          id: 'state', key: { local_name: 'state', raw: 'state' }, type: 'panel',
          props: { chat_coordinate_dropdown: false }, bindings: [], children: [],
        },
        {
          id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'panel', props: { visible: true },
          localVariables: { '$source_name': 'state', '$dropdown_name': 'chat_coordinate_dropdown' }, children: [],
          bindings: [{
            binding_type: 'view', source_control_name: '($source_name)',
            source_property_name: "('#' + $dropdown_name)", target_property_name: '#visible',
          }],
        },
      ],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel);
  assertEqual(result.propsById.target.visible, false);
  assert(!result.warnings.some((warning) => /VIEW_SOURCE_(?:UNRESOLVED|AMBIGUOUS)/u.test(warning)));
  assertEqual(result.diagnostics.find(row => row.nodeId === 'target').sourceResolution, 'global_fallback');
});

test('dynamic view source failures do not silently read the current control', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: { visible: true }, children: [],
      bindings: [{
        binding_type: 'view', source_control_name: '($missing)', source_property_name: '#visible', target_property_name: '#visible',
      }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel);
  assert(String(result.propsById.root.visible).includes('unresolved_runtime_visibility'));
  assert(result.warnings.some((warning) => warning.includes('VIEW_SOURCE_UNRESOLVED')));
});

test('inactive structural branches do not make global view sources ambiguous', () => {
  const source = (id) => ({
    id, key: { local_name: 'state', raw: 'state' }, type: 'panel', props: { ready: true }, bindings: [], children: [],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [], children: [
        { id: 'inactive', key: { local_name: 'inactive', raw: 'inactive' }, type: 'panel', props: { ignored: true }, bindings: [], children: [source('hidden-state')] },
        source('active-state'),
        {
          id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'panel', props: { visible: false }, children: [],
          bindings: [{ binding_type: 'view', source_control_name: 'state', source_property_name: '#ready', target_property_name: '#visible' }],
        },
      ],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel);
  assertEqual(result.propsById.target.visible, true);
  assert(!result.warnings.some((warning) => warning.includes('VIEW_SOURCE_AMBIGUOUS')));
});

test('collection expressions prefer the selected row over authored properties', () => {
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel',
      props: { ready: false, collection_index: 0 }, children: [],
      bindings: [{
        binding_type: 'collection', binding_collection_name: 'items',
        binding_name: '(#ready)', binding_name_override: '#visible',
      }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, { collectionData: { items: [{ '#ready': true }] } });
  assertEqual(result.propsById.root.visible, true);
});

test('collection indices never leak across a mismatching generated boundary', () => {
  const uiModel = {
    root: {
      id: 'outer', key: { local_name: 'outer', raw: 'outer' }, type: 'panel',
      props: { __jsonui_preview_collection_name: 'outer' }, bindings: [], children: [{
        id: 'leaf', key: { local_name: 'leaf', raw: 'leaf' }, type: 'label', props: { collection_index: 1 }, children: [],
        bindings: [{
          binding_type: 'collection', binding_collection_name: 'inner',
          binding_name: '#label', binding_name_override: '#text',
        }],
      }],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, {
    collectionData: { inner: [{ '#label': 'row-zero' }, { '#label': 'wrong-row-one' }] },
  });
  assertEqual(result.propsById.leaf.text, undefined);
  assert(result.warnings.some(warning => warning.startsWith('COLLECTION_INDEX_UNRESOLVED:')));
});

test('global-bound inactive ancestors are excluded from view source candidates', () => {
  const source = (id) => ({
    id, key: { local_name: 'state', raw: 'state' }, type: 'panel', props: { ready: true }, bindings: [], children: [],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [], children: [
        {
          id: 'inactive', key: { local_name: 'inactive', raw: 'inactive' }, type: 'panel', props: { visible: true }, children: [source('hidden')],
          bindings: [{ binding_type: 'global', binding_name: '#show_inactive', binding_name_override: '#visible' }],
        },
        source('active'),
        {
          id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'panel', props: { visible: false }, children: [],
          bindings: [{ binding_type: 'view', source_control_name: 'state', source_property_name: '#ready', target_property_name: '#visible' }],
        },
      ],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, { mockData: { '#show_inactive': false } });
  assertEqual(result.propsById.target.visible, true);
  assert(!result.warnings.some((warning) => warning.includes('VIEW_SOURCE_AMBIGUOUS')));
});

test('a resolved unchanged visibility gate still refreshes view-source activity', () => {
  const state = (id) => ({
    id, key: { local_name: 'state', raw: 'state' }, type: 'panel',
    props: { text: id }, bindings: [], children: [],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [], children: [
        {
          id: 'hidden-owner', key: { local_name: 'hidden-owner', raw: 'hidden-owner' }, type: 'panel',
          props: { visible: false },
          bindings: [{ binding_type: 'global', binding_name: '#show_hidden', binding_name_override: '#visible' }],
          children: [state('hidden-state')],
        },
        state('active-state'),
        {
          id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'label',
          props: { text: 'authored' }, children: [],
          bindings: [{
            binding_type: 'view', source_control_name: 'state', source_property_name: '#text',
            target_property_name: '#text',
          }],
        },
      ],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel, { mockData: { '#show_hidden': false } });
  assertEqual(result.propsById.target.text, 'active-state');
  assert(!result.warnings.some((warning) => warning.includes('VIEW_SOURCE_AMBIGUOUS')));
});

test('view-bound inactive ancestors stop contributing duplicate source candidates after convergence', () => {
  const state = (id, value) => ({
    id, key: { local_name: 'state', raw: 'state' }, type: 'panel',
    props: { value }, bindings: [], children: [],
  });
  const uiModel = {
    root: {
      id: 'root', key: { local_name: 'root', raw: 'root' }, type: 'panel', props: {}, bindings: [], children: [
        {
          id: 'gate', key: { local_name: 'gate', raw: 'gate' }, type: 'panel',
          props: { show_branch: false }, bindings: [], children: [],
        },
        {
          id: 'inactive', key: { local_name: 'inactive', raw: 'inactive' }, type: 'panel',
          props: { visible: true }, children: [state('hidden', 'hidden')],
          bindings: [{
            binding_type: 'view', source_control_name: 'gate',
            source_property_name: '#show_branch', target_property_name: '#visible',
          }],
        },
        state('active', 'active'),
        {
          id: 'target', key: { local_name: 'target', raw: 'target' }, type: 'label',
          props: { text: 'authored' }, children: [],
          bindings: [{
            binding_type: 'view', source_control_name: 'state',
            source_property_name: '#value', target_property_name: '#text',
          }],
        },
      ],
    },
  };
  const result = evaluateBindingsForUiModel(uiModel);
  assertEqual(result.propsById.inactive.visible, false);
  assertEqual(result.propsById.target.text, 'active');
  assert(!result.warnings.some((warning) => warning.includes('VIEW_SOURCE_AMBIGUOUS')));
});
