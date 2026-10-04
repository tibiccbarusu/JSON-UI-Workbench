import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { planWorkspaceExport, buildWorkspaceExport } from '../workspace-export.mjs';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

const fixtureUi = process.env.JSONUI_VANILLA_FIXTURE_DIR;
const cases = { skip: !fixtureUi && 'JSONUI_VANILLA_FIXTURE_DIR に固定公式資料の ui ディレクトリが必要' };
let loaded;
async function fixture() {
  if (!loaded) loaded = (async () => {
    const root = dirname(resolve(fixtureUi));
    const paths = (await readdir(root, { recursive: true, withFileTypes: true })).filter(row => row.isFile())
      .map(row => join(row.parentPath ?? row.path, row.name).slice(root.length + 1).replaceAll('\\', '/'));
    const common = parseJsonc(await readFile(join(root, 'ui/ui_common.json'), 'utf8')).value;
    const registry = parseJsonc(await readFile(join(root, 'ui/_ui_defs.json'), 'utf8')).value;
    const source = (kind, overrides = {}, sourcePaths = paths) => ({
      id: kind, kind, paths: sourcePaths, overrides,
      readText: path => readFile(join(root, path), 'utf8'),
      readBytes: path => readFile(join(root, path)),
    });
    return { root, paths, common, registry, source };
  })();
  return loaded;
}

const rootValue = base => ({
  [base]: {
    '$screen_content': 'common.base_screen_empty_panel',
    '$additional_screen_content': 'common.base_screen_empty_panel',
  },
});

async function options({ kind = 'vanilla', namespace = 'common', path = 'ui/ui_common.json',
  baseRef = '', bodyChange, scope = {}, duplicateOriginal = false, duplicateClone = false, globals } = {}) {
  const f = await fixture(), clone = structuredClone(f.common.screen_panel);
  bodyChange?.(clone);
  const cloneKey = 'review_clone' + (baseRef ? '@' + baseRef : '');
  const document = {
    ...(kind === 'vanilla' && path === 'ui/ui_common.json' && namespace === 'common' ? structuredClone(f.common) : { namespace }),
    ...scope, [cloneKey]: clone,
    ...rootValue(`review_root@${namespace}.review_clone`),
  };
  const overrides = { [path]: JSON.stringify(document) };
  const registry = structuredClone(f.registry);
  if (path !== 'ui/ui_common.json') registry.ui_defs.push(path);
  if (duplicateOriginal || duplicateClone) {
    const extraPath = 'ui/zz_review_duplicate.json';
    overrides[extraPath] = JSON.stringify({ namespace: 'common',
      ...(duplicateOriginal ? { screen_panel: { type: 'panel', controls: [] } } : {}),
      ...(duplicateClone ? { review_clone: structuredClone(f.common.screen_panel) } : {}),
    });
    registry.ui_defs.push(extraPath);
  }
  if (path !== 'ui/ui_common.json' || duplicateOriginal || duplicateClone) overrides['ui/_ui_defs.json'] = JSON.stringify(registry);
  if (globals) {
    const globalsPath = 'ui/_global_variables.json';
    overrides[globalsPath] = JSON.stringify({
      ...parseJsonc(await readFile(join(f.root, globalsPath), 'utf8')).value, ...globals,
    });
  }
  if (kind === 'imported') overrides['manifest.json'] = JSON.stringify({
    format_version: 2,
    header: { name: 'Clone proof review', description: '独立レビューfixture',
      uuid: '291b8d36-f8f1-4af7-b6bf-992d1d828eae', version: [1, 0, 0], min_engine_version: [1, 21, 0] },
    modules: [{ type: 'resources', uuid: 'f754ec69-02fa-46cb-aa04-8b5f36f4c1bf', version: [1, 0, 0] }],
  });
  return {
    sources: kind === 'vanilla' ? [f.source(kind, overrides)] : [f.source('vanilla'), f.source(kind, overrides, Object.keys(overrides))],
    selections: [{ filePath: path, definition: namespace + '.review_root', sourceId: kind }],
  };
}

const caller = (result, name = 'common.review_clone') =>
  result.plan.engineFactoryProof.factory.equivalentCallers.find(row => row.definition === name);

test('認定の対照: 名前prefixに依存しない完全同値cloneと上位層cloneを許可する', cases, async () => {
  for (const kind of ['vanilla', 'imported']) {
    const result = await planWorkspaceExport(await options({ kind }));
    assert.equal(result.ok, true, JSON.stringify(result.plan.unresolved));
    assert(caller(result));
    assert.equal(result.plan.engineFactoryProof.verified, true);
    assert.equal(result.plan.externalUiDefinitions.length, 2);
    assert(result.plan.engineFactoryProof.branches.every(branch => branch.used && branch.verified));
  }
});

test('認定元screen_panelが同順位で重複した場合は同値clone経由でも認定しない', cases, async () => {
  const result = await buildWorkspaceExport(await options({ duplicateOriginal: true }));
  assert.equal(result.ok, false);
  assert.equal(result.bytes, undefined);
  assert.equal(result.plan.engineFactoryProof.verified, false);
  assert.equal(caller(result), undefined);
  assert(result.plan.engineFactoryProof.branches.every(branch => !branch.used));
});

test('同値clone自身の同順位重複候補を辞書順winnerだけで認定しない', cases, async () => {
  const result = await buildWorkspaceExport(await options({ duplicateClone: true }));
  assert.equal(result.ok, false);
  assert.equal(result.bytes, undefined);
  assert.equal(caller(result), undefined);
  assert(result.plan.unresolved.some(row => row.code === 'EXPORT_UI_SYMBOL_AMBIGUOUS'));
});

test('同値の原callerを上位パックで置き換えても vanilla の認定元として扱わない', cases, async () => {
  const opts = await options({ kind: 'imported' });
  const imported = opts.sources.find(source => source.kind === 'imported');
  const document = JSON.parse(imported.overrides['ui/ui_common.json']);
  document.screen_panel = structuredClone((await fixture()).common.screen_panel);
  imported.overrides['ui/ui_common.json'] = JSON.stringify(document);
  const result = await buildWorkspaceExport(opts);
  assert.equal(result.ok, false);
  assert.equal(result.bytes, undefined);
  assert.equal(result.plan.engineFactoryProof.verified, false);
  assert.equal(caller(result), undefined);
});

for (const [name, changes] of [
  ['namespace', { kind: 'imported', namespace: 'review_namespace' }],
  ['元ファイルpath', { path: 'ui/review_clone.json' }],
  ['baseRef', { baseRef: 'common.screen_panel' }],
  ['原文body', { bodyChange: body => { body.offset = [1, 2]; } }],
  ['文書の字句スコープ', { kind: 'imported', scope: { '$review_scope': 1 } }],
]) test(`同値判定境界: ${name} が違うcloneへ証明を流用しない`, cases, async () => {
  const result = await planWorkspaceExport(await options(changes));
  assert.equal(caller(result, (changes.namespace || 'common') + '.review_clone'), undefined);
  assert.equal(result.ok, false, '証明対象外のstorage分岐は既存の厳格な依存検査へ進む');
});

test('同値clone認定後も到達global変数変更の拒否ゲートを維持する', cases, async () => {
  const result = await buildWorkspaceExport(await options({ globals: { '$light_button_default_text_color': [0.2, 0.3, 0.4] } }));
  assert(caller(result), 'caller同値判定と依存証明は別のゲート');
  assert.equal(result.ok, false);
  assert.equal(result.bytes, undefined);
  assert.equal(result.plan.engineFactoryProof.verified, false);
  assert(result.plan.engineFactoryProof.branches.some(branch => branch.checks.some(check => check.code === 'DEPENDENCY_GLOBAL_VARIABLE_CHANGED')));
});
