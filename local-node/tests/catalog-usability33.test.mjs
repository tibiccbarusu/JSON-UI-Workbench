import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog, listEffectiveDefinitionsForPath, selectUiDefinition } from '../../editor-core/src/engine/ui-catalog.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

function source(id, documents, precedence = 1) {
  return { id, kind: precedence > 1 ? 'imported' : 'vanilla', precedence,
    filePaths: Object.keys(documents), readText: async path => JSON.stringify(documents[path]) };
}
function createCatalog(documents, options = {}) {
  return buildUiCatalog({ parseJsonc, sources: [source('pack', documents)], ...options });
}
function record(catalog, name) { return catalog.records.find(row => row.qualifiedName === name); }

test('名前にscreenを含まない別ファイルの継承画面を初期選択する', async () => {
  const catalog = await createCatalog({
    'ui/base.json': { namespace: 'base', template: { type: 'screen' }, 'middle@base.template': {} },
    'ui/custom.json': { namespace: 'custom', aaa_panel: { type: 'panel' }, 'workspace@base.middle': {} },
  });
  const selected = selectUiDefinition(listEffectiveDefinitionsForPath(catalog, 'ui/custom.json'));
  assert.equal(selected.qualifiedName, 'custom.workspace');
  assert.equal(selected.classification, 'SCREEN');
  assert.equal(selected.typeResolution.type, 'screen');
  assert.equal(selected.typeResolution.inheritedDepth, 2);
});

test('明示panelでscreen型を上書きした定義を画面として優先しない', async () => {
  const catalog = await createCatalog({ 'ui/a.json': { namespace: 'x', base_screen: { type: 'screen' },
    'panel@x.base_screen': { type: 'panel' }, 'actual@x.base_screen': {} } });
  assert.notEqual(record(catalog, 'x.panel').classification, 'SCREEN');
  assert.equal(record(catalog, 'x.actual').classification, 'SCREEN');
});

test('anim_typeを持つ名称任意のanimationとその継承をデータに分類する', async () => {
  const catalog = await createCatalog({ 'ui/a.json': { namespace: 'x', fade: { anim_type: 'alpha', from: 0, to: 1 },
    'fade_more@x.fade': {}, visual: { type: 'panel' }, root: { type: 'panel', controls: [{ 'use@x.fade': {} }] } } });
  assert.equal(record(catalog, 'x.fade').classification, 'ANIMATION_OR_DATA');
  assert.equal(record(catalog, 'x.fade_more').classification, 'ANIMATION_OR_DATA');
  const selected = selectUiDefinition([record(catalog, 'x.fade'), record(catalog, 'x.visual')]);
  assert.equal(selected.qualifiedName, 'x.visual');
});

test('画面名ヒューリスティックは未指定型だけに使用し、動的型の確定を主張しない', async () => {
  const catalog = await createCatalog({ 'ui/a.json': { namespace: 'x',
    visual_screen: { type: 'label' }, guessed_screen: {}, dynamic_screen: { type: '$runtime' },
    'missing@x.absent': {}, 'loop_a@x.loop_b': {}, 'loop_b@x.loop_a': {} } });
  assert.notEqual(record(catalog, 'x.visual_screen').classification, 'SCREEN');
  assert.equal(record(catalog, 'x.guessed_screen').classification, 'SCREEN');
  assert.equal(record(catalog, 'x.guessed_screen').classificationBasis, 'name-heuristic');
  assert.equal(record(catalog, 'x.dynamic_screen').typeResolution.status, 'dynamic');
  assert.equal(record(catalog, 'x.missing').typeResolution.status, 'missing-base');
  assert.equal(record(catalog, 'x.loop_a').typeResolution.status, 'cycle');
});

test('同名overlayとmodificationsのみのoverlayは低優先度の型を追う', async () => {
  const sources = [
    source('vanilla', { 'ui/a.json': { namespace: 'x', workspace: { type: 'screen' }, shell: { type: 'screen' } } }),
    source('custom', { 'ui/a.json': { namespace: 'x', 'workspace@x.workspace': {},
      shell: { modifications: [{ array_name: 'controls', operation: 'insert_back', value: { child: { type: 'panel' } } }] } } }, 2),
  ];
  const catalog = await createCatalog({}, { sources });
  const definitions = listEffectiveDefinitionsForPath(catalog, 'ui/a.json');
  assert.equal(definitions.length, 2);
  assert(definitions.every(row => row.classification === 'SCREEN'));
  assert(definitions.every(row => row.typeResolution.inheritedDepth === 1));
});

test('同順位の継承候補は型を捏造せず曖昧と記録する', async () => {
  const catalog = await createCatalog({
    'ui/a.json': { namespace: 'x', root: { type: 'screen' } },
    'ui/b.json': { namespace: 'x', root: { type: 'panel' } },
    'ui/c.json': { namespace: 'x', 'screen@x.root': {} },
  });
  assert.equal(record(catalog, 'x.screen').typeResolution.status, 'ambiguous-base');
  assert.equal(record(catalog, 'x.screen').typeResolution.type, null);
});

test('型候補の累積探索予算を超えた結果は未確定として記録する', async () => {
  const catalog = await createCatalog({ 'ui/a.json': { namespace: 'x', template: { type: 'screen' },
    'middle@x.template': {}, 'workspace@x.middle': {} } }, { limits: { maxTypeLookupOperations: 1 } });
  assert.equal(record(catalog, 'x.middle').typeResolution.type, 'screen');
  assert.equal(record(catalog, 'x.workspace').typeResolution.status, 'work-limit');
  assert.equal(catalog.summary.typeLookupOperations, 1);
  assert.equal(catalog.summary.typeLookupLimitedDefinitions, 1);
});

test('参照走査開始の進捗通知から中断でき、完了catalogを返さない', async () => {
  const controller = new AbortController();
  const phases = [];
  await assert.rejects(createCatalog({ 'ui/a.json': { namespace: 'x', a: { type: 'panel' } } }, {
    signal: controller.signal,
    onProgress(progress) { phases.push(progress.phase); if (progress.phase === 'reference-direct') controller.abort(); },
  }), /UI_CATALOG_ABORTED/);
  assert(phases.includes('parse'));
  assert(phases.includes('reference-direct'));
});

test('参照走査の途中でtimerによる中断を処理できる', async () => {
  const controller = new AbortController();
  const body = { namespace: 'x' };
  for (let index = 0; index < 100; index += 1) body[`item${index}`] = { type: 'panel' };
  let lastProcessed = 0;
  await assert.rejects(createCatalog({ 'ui/a.json': body }, {
    signal: controller.signal,
    onProgress(progress) {
      if (progress.phase !== 'reference-direct') return;
      lastProcessed = progress.processed;
      if (progress.processed === 32) setTimeout(() => controller.abort(), 0);
    },
  }), /UI_CATALOG_ABORTED/);
  assert.equal(lastProcessed, 32);
});

test('大きなcatalogの参照走査に直接/継承/型分類の完了進捗がある', async () => {
  const body = { namespace: 'x' };
  for (let index = 0; index < 100; index += 1) body[`item${index}`] = { type: 'panel' };
  const phases = [];
  const catalog = await createCatalog({ 'ui/a.json': body }, { onProgress(progress) { phases.push(progress); } });
  assert.equal(catalog.records.length, 100);
  for (const phase of ['reference-direct', 'reference-context', 'classify']) {
    assert(phases.some(row => row.phase === phase && row.processed === 100 && row.total === 100), phase);
  }
});
