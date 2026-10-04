import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { planWorkspaceExport, buildWorkspaceExport } from '../workspace-export.mjs';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

const fixtureUi = process.env.JSONUI_VANILLA_FIXTURE_DIR;
let loaded;
async function fixture() {
  if (!loaded) loaded = (async () => {
    const root = dirname(resolve(fixtureUi));
    const paths = (await readdir(root, { recursive: true, withFileTypes: true })).filter(row => row.isFile())
      .map(row => join(row.parentPath ?? row.path, row.name).slice(root.length + 1).replaceAll('\\', '/'));
    const raw = await readFile(join(root, 'ui/ui_common.json'), 'utf8');
    return { root, paths, raw, document: parseJsonc(raw).value };
  })();
  return loaded;
}
async function options(overrides = {}) {
  const { root, paths } = await fixture();
  return { sources: [{ id: 'vanilla', kind: 'vanilla', paths, overrides,
    readText: path => readFile(join(root, path), 'utf8'), readBytes: path => readFile(join(root, path)) }],
    selections: [{ filePath: 'ui/anvil_screen.json', definition: 'anvil.anvil_screen' }] };
}
const cases = { skip: !fixtureUi && 'JSONUI_VANILLA_FIXTURE_DIR に固定公開資料の ui ディレクトリが必要' };

test('同じ共通原文の保存だけでは標準popup依存の認定を解除しない', cases, async () => {
  const { raw } = await fixture(), result = await planWorkspaceExport(await options({ 'ui/ui_common.json': raw }));
  assert(result.ok, JSON.stringify(result.plan.unresolved));
  assert(result.plan.engineFactoryProof.verified);
  assert(result.plan.engineFactoryProof.branches.every(branch => branch.considered && branch.used));
});

test('実際のclose_button_image親へ新button追加・位置・寸法変更を選択ZIPに保持', cases, async () => {
  const document = structuredClone((await fixture()).document);
  const value = { type: 'button', size: [28, 16], offset: [13, 7], text: 'Export 19' };
  document.close_button_panel.controls[0]['close_button_image@close_button_image'].controls = [{ new_button_1: value }];
  const result = await buildWorkspaceExport(await options({ 'ui/ui_common.json': JSON.stringify(document) }));
  assert(result.ok, JSON.stringify(result.plan.unresolved)); assert(result.bytes.length > 0);
  assert(result.plan.includedDefinitions.includes('common.close_button_panel'));
  assert(result.plan.engineFactoryProof.branches.some(branch => branch.checks.some(check =>
    check.code === 'CHANGED_DEPENDENCY_INCLUDED' && check.definition === 'common.close_button_panel')));
});

test('変更した共通定義の固定画像が欠けていればZIPは返さない', cases, async () => {
  const document = structuredClone((await fixture()).document);
  document.close_button_panel.controls.push({ new_image: { type: 'image', texture: 'textures/revision19_missing' } });
  const result = await buildWorkspaceExport(await options({ 'ui/ui_common.json': JSON.stringify(document) }));
  assert(!result.ok); assert.equal(result.bytes, undefined);
  assert(result.plan.unresolved.some(row => row.code === 'EXPORT_TEXTURE_MISSING'));
});

test('直接描画されないstorage依存の原ZIP改変も未収録なら検出する', cases, async () => {
  const opts = await options(), source = opts.sources[0], originalRead = source.readText;
  source.readText = async path => {
    const raw = await originalRead(path);
    if (path !== 'ui/ui_template_buttons.json') return raw;
    const document = parseJsonc(raw).value;
    document['light_content_button@light_button_assets'] = { type: 'image', texture: 'textures/revision19_missing' };
    return JSON.stringify(document);
  };
  const result = await buildWorkspaceExport(opts);
  assert(!result.ok); assert.equal(result.bytes, undefined);
  assert(result.plan.unresolved.some(row => row.code === 'EXPORT_ENGINE_UI_CHANGED_DEPENDENCY_UNRESOLVED'));
});

test('factory対象改変の未認定理由をconsideredな診断として返す', cases, async () => {
  const opts = await options(), source = opts.sources[0];
  const path = 'ui/storage_management_popup.json', document = parseJsonc(await source.readText(path)).value;
  document['storage_dependency_modal@popup_dialog.modal_input_panel'] = { type: 'image', texture: 'textures/revision19_missing' };
  source.overrides[path] = JSON.stringify(document);
  const result = await planWorkspaceExport(opts);
  assert(!result.ok);
  const proof = result.plan.engineFactoryProof.branches.find(branch => branch.definition.endsWith('.storage_dependency_modal'));
  assert(proof.considered); assert(!proof.used); assert(!proof.verified);
  assert(proof.checks.some(row => row.code === 'FACTORY_TARGET_CHANGED'));
});

test('未使用global変数の追記を許可し、到達変数の変更は未認定にする', cases, async () => {
  const { root } = await fixture(), path = 'ui/_global_variables.json';
  const document = parseJsonc(await readFile(join(root, path), 'utf8')).value;
  document.$revision19_unrelated = 'unused';
  const result = await planWorkspaceExport(await options({ [path]: JSON.stringify(document) }));
  assert(result.ok, JSON.stringify(result.plan.unresolved));
  document.$light_button_default_text_color = [0.2, 0.3, 0.4];
  const changed = await planWorkspaceExport(await options({ [path]: JSON.stringify(document) }));
  assert(changed.plan.engineFactoryProof.branches.some(branch => branch.checks.some(row => row.code === 'DEPENDENCY_GLOBAL_VARIABLE_CHANGED')));
});

test('共通定義を収録していても別controller文脈の新bindingを無条件に認定しない', cases, async () => {
  const document = structuredClone((await fixture()).document);
  document.close_button_panel.controls.push({ dynamic_image: { type: 'image', texture: '#controller_face_left_icon',
    bindings: [{ binding_name: '#controller_face_left_icon' }] } });
  const result = await buildWorkspaceExport(await options({ 'ui/ui_common.json': JSON.stringify(document) }));
  assert(!result.ok); assert.equal(result.bytes, undefined);
  assert(result.plan.unresolved.some(row => row.code === 'EXPORT_ENGINE_UI_CHANGED_RUNTIME_INPUT_UNRESOLVED'));
});
