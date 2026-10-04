import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

const nest = (value, depth) => {
  for (let index = 0; index < depth; index += 1) value = { inside: value };
  return value;
};
async function inspect(document, limits = {}) {
  const catalog = await buildUiCatalog({ parseJsonc, limits, sources: [{
    id: 'depth37', kind: 'imported', precedence: 20,
    filePaths: ['ui/boundary.json'], readText: async () => JSON.stringify(document),
  }] });
  const record = catalog.records.find(item => item.qualifiedName === 'm.screen');
  return { catalog, record, diagnostic: catalog.diagnostics.find(item =>
    item.code === 'UI_REFERENCE_SCAN_LIMIT' && item.definition === record.rawKey) };
}

test('R37: depth 96 で収集済みの参照 scalar によって coverage を下げない', async () => {
  const { record, diagnostic } = await inspect({ namespace: 'm',
    screen: nest({ grid_item_template: 'm.leaf', layer: 2, visible: true, ignored: null }, 96),
    leaf: { type: 'panel' },
  });
  assert.deepEqual(record.references, ['m.leaf']);
  assert.equal(record.referenceScanComplete, true);
  assert.equal(diagnostic, undefined);
});

test('R37: depth 97 に実参照 object があれば引き続き不完全として停止する', async () => {
  const { record, diagnostic } = await inspect({ namespace: 'm',
    screen: nest({ grid_item_template: 'm.leaf' }, 97), leaf: { type: 'panel' },
  });
  assert.deepEqual(record.references, []);
  assert.equal(record.referenceScanComplete, false);
  assert(diagnostic.reasons.includes('depth'));
  assert.equal(diagnostic.metrics.depthLimit, 96);
  assert.equal(diagnostic.metrics.depthStops['syntax-child'], 1);
  assert.equal(diagnostic.metrics.depthSamples[0].depth, 97);
});

test('R37: ファイルをまたぐ合成深さ・共有ノード予算の上限を維持する', async () => {
  const document = { namespace: 'm', screen: { type: 'screen', $marker: true,
    controls: [{ 'start@m.node0': {} }] } };
  for (let index = 0; index < 28; index += 1) document[`node${index}`] = {
    type: 'panel', $pick: `m.node${index + 1}`, controls: [{ host: { type: 'panel', controls: [
      { factory: { type: 'factory', control_name: '$pick' } },
    ] } }],
  };
  document.node28 = { type: 'panel' };
  const { record, diagnostic } = await inspect(document);
  assert.equal(record.referenceScanComplete, false);
  assert(diagnostic.reasons.includes('depth'));
  assert(diagnostic.metrics.maxObservedDepth > diagnostic.metrics.depthLimit);
  assert(diagnostic.metrics.depthSamples.length > 0);
  assert(diagnostic.metrics.depthSamples.length <= 8);
  assert(diagnostic.metrics.depthSamples.every(item => item.definitionTrail.length <= 8));
  const bounded = await inspect(document, { maxReferenceNodesTotal: 5 });
  assert.equal(bounded.record.referenceScanComplete, false);
  assert(bounded.diagnostic.reasons.includes('global-nodes'));
});

test('R37: 診断サンプル数を制限し、幅のある正常な UI を depth と誤認しない', async () => {
  const wide = { namespace: 'm', screen: { type: 'screen', controls: Array.from({ length: 256 },
    (_, index) => ({ [`item${index}@m.leaf`]: {} })) }, leaf: { type: 'panel' } };
  assert.equal((await inspect(wide)).record.referenceScanComplete, true);
  const overflow = { namespace: 'm', screen: { controls: Array.from({ length: 30 },
    () => ({ child: nest({ grid_item_template: 'm.leaf' }, 8) })) }, leaf: { type: 'panel' } };
  const { diagnostic } = await inspect(overflow, { maxScanDepth: 4 });
  assert.equal(diagnostic.metrics.depthSamples.length, 8);
  assert.equal(diagnostic.metrics.depthStops['syntax-child'], 30);
});
