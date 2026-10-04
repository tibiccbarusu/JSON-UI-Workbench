#!/usr/bin/env node
/** JSON UI CLI. Node.js >=22.14.0; no package installation or browser required. */
import path from 'node:path';
import { cliCapabilities28 } from './cli-capabilities28.mjs';
import { lstat } from 'node:fs/promises';
import { resolveLanguage, languageHint, localizeConsoleResult } from './console-i18n.mjs';
import { pathToFileURL } from 'node:url';
import { CliClient } from './cli-client.mjs';
import { cliError, checkedPath, readJson, readRegularText, readRegularBytes, lockSession, readSession, saveSession, atomicWrite, checkOutputPath } from './cli-files.mjs';
import { buildStructureSvg } from './cli-preview.mjs';
import { readHistory, historySummary, sourceSnapshot, appendHistory, restoreSnapshot } from './cli-history.mjs';
import { loadRasterBackend } from './frame-raster13.mjs';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { activeClassicUiScale, logicalCanvasPreset, inferPackUiScaleFromBuildInfo } from '../editor-core/src/preview/preview-viewport16.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
import { buildPreviewQuality } from './cli-quality38.mjs';
import { checkedSettings, finiteNumber, DEFAULT_SETTINGS } from './preview-settings.mjs';
import { preparePreview } from './preview-pipeline.mjs';
import { prepareTypedCliState, settingsChangeInvalidatesState } from './cli-state38.mjs';
import { checkedApiRequest, apiPreviewSettings } from './api-request.mjs';
import { prepareInteraction, prepareSound } from './api-interaction.mjs';

const SCHEMA = 'jsonui-cli-result-v1';
const COMMON = ['session', 'json', 'language'];
const FLAGS = new Set(['json', 'force', 'plan', 'cascade', 'help', 'allow-partial', 'strict-semantics', 'replace-state', 'draw-evidence', 'strict-animation', 'frame-summary']);
const COMMANDS = Object.freeze({
  help: [], features: [], status: ['live'], import: ['pack', 'vanilla', 'resource-pack'], list: ['kind'],
  definitions: ['file', 'kind', 'definition'], read: ['file', 'kind', 'out', 'force'],
  validate: ['file', 'definition', 'kind', 'out', 'force', 'strict-semantics'],
  preview: ['file', 'definition', 'kind', 'frame', 'fps', 'width', 'height', 'ui-scale', 'format', 'out', 'force', 'allow-partial', 'strict-semantics', 'draw-evidence', 'strict-animation', 'frame-summary'],
  interact: ['request-file', 'out', 'force'], 'resolve-sound': ['request-file', 'out', 'force'],
  draft: ['operation', 'file', 'definition', 'kind', 'out', 'force', 'width', 'height', 'ui-scale', 'frame', 'fps'],
  settings: ['file', 'state-file', 'replace-state'], edit: ['operation', 'file', 'kind', 'text-file', 'action', 'pointer', 'value', 'name', 'parent-pointer', 'base-ref', 'index', 'cascade'],
  export: ['file', 'definition', 'kind', 'selections', 'out', 'force', 'plan', 'pack-options', 'pack-icon'],
  diagnostics: ['out', 'force'],
  workflow: ['file'], undo: [], redo: [],
});
FLAGS.add('live');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const HELP_JA = `JSON UI Workbench コマンドモード (Node.js 22.14.0 以降)
標準入口はCLIです。Node SDKはlocal-node/api.mjsのcreateRenderer、
常駐HTTPはnpm run api、実験版GUIはnpm run gui。CLI/SDK/APIは画面を起動しません。
使い方: node local-node/cli.mjs <コマンド> --session <session.json> [オプション]

import      --pack <pack.zip|pack.mcpack|addon.mcaddon> [--vanilla <vanilla.zip>] [--resource-pack <UUID>]
            バニラ単体は --vanilla のみ。指定した層を交換し、その層の編集をリセット。
list        [--kind imported|vanilla]  読込済み UI ファイル一覧
definitions [--file ui/example.json] [--definition namespace.name] [--kind ...]
read        --file ui/example.json [--kind imported|vanilla] [--out authored.json]
interact    --request-file interaction.json [--out interaction-result.json]
            SDKと同じJSONでローカル操作を投影。状態は応答を次の要求へ渡します。
resolve-sound --request-file sound.json [--out sound-result.json]
            soundIdを登録済み音源へ解決し、形式・ハッシュ等を返します。発音はしません。
validate    --file ui/example.json --definition namespace.screen [--out validation.json]
preview     --file ui/example.json --definition namespace.screen
            [--frame N] [--fps 60] [--width 1920] [--height 1080] [--ui-scale auto|1..8]
            [--format json|svg|png] [--out frame.json|frame.svg|frame.png] [--allow-partial]
            [--frame-summary] JSON転送上限に達した場合の件数・打切り診断（画像なし）
features    サイトとCLIの対応範囲をJSONで表示（セッション不要）
draft       --operation operation.json --file ui/example.json --definition namespace.screen
            [--out draft.json] [--width 1920] [--height 1080] [--ui-scale auto|1..8] [--frame N] [--fps 60]
            原文・履歴・セッションを変更しない草稿フレームJSON。
settings    [--file settings.json]  設定表示、または JSON の設定を上書き保存
            [--state-file state.json] [--replace-state]  共有型付き状態を読込。file と排他。
edit        --operation operation.json  UI と同じ原文編集 API を実行
edit        --file ui/example.json --text-file edited.json  原文を直接置換
edit        --action set|move|add|inherit|planDelete|delete --file ui/example.json
            --pointer /screen/controls/0/title [--kind imported|vanilla] [--value <JSON>] [--cascade]
undo        直前の原文編集を取り消す。別プロセスでも保存履歴から復元。
redo        取り消した原文編集を再適用。新規編集・パック交換で再適用履歴を破棄。
export      --file ui/example.json --definition namespace.screen --out selected.mcpack
            または --selections selections.json。--plan は依存計画のみ。
            [--pack-options pack-options.json] [--pack-icon icon.png]
diagnostics [--out diagnostics.json]  現在の CLI 処理と Node の診断を保存。
status      [--live]  保存済み状態。--live は元 ZIP を検証して作業領域も点検。
workflow    --file workflow.json  1 回の起動で複数コマンド。各成功変更を保存。
help        [--json]  この説明

共通: --language ja|en。省略時は JSONUI_LANGUAGE、保存設定 language、日本語の順。
settings の language はコンソール表示、locale はパックの文字列・フォントです。
width/height は出力画像のピクセル数、ui_scale はサイトの UI 倍率です。auto は
パックの校正値または既定 4 倍。旧版の等倍座標が必要な場合は --ui-scale 1。
target_engine_version はバニラ単体の3D対象版（既定1.26.40）。通常パックがあれば
サイトと同じくそのmanifestのmin_engine_versionを優先します。
workflow 内の各コマンドに language は指定できません。設定変更は次の診断に反映。

通常の stdout は成功・失敗とも JSON 1 件です。失敗時は非ゼロ終了。
同名成果物の置換には --force が必要。元 ZIP とアプリ本体の上書きは不可。
セッションは元 ZIP の絶対パスと SHA-256、編集差分、設定を保存します。
編集履歴は最大 64 件 / 8 MiB。上限超過時は古い履歴から削除して status に記録。
元 ZIP が変わった場合は復元を停止します。各コマンドは専用ローカルサーバーを
自動起動し、終了時に停止します。複数操作には workflow が効率的です。
SVG は実 API のレイアウト境界図です。テクスチャ・文字・3D を描画する製品画像
ではありません。PNG は利用可能な @napi-rs/canvas とパック素材で描画します。
PNG のフレーム未指定時は開始約 1 秒後を撮影します。--frame 0 は開始時刻を厳密に指定します。
PNG に未解決素材があれば既定で出力を止めます。--allow-partial は診断用の
不完全出力を明示的に許可します。実機の画素一致を保証する機能ではありません。
JSON には投影原文とフレーム IR、検査結果を含めます。
validate/preview --strict-semantics は選択投影の解決エラー・不明状態で停止します。
preview では行参照と表示・入力bindingのエラー・不明状態でも停止し、allow-partialよりstrictが優先します。
validate は実行時行・binding評価を実施しません。PNG は通常、未解決bindingでも停止します。
preview --strict-animation はアニメーション品質の未対応・不明・捕捉不足で出力を停止します。allow-partial より優先し、実機一致を保証しません。
preview_complete は資産・行参照・表示入力bindingの完了、draft:true は明示的な不完全PNGです。
PNG --draw-evidence は文字・画像の最終描画入力を上限付きで追加します（通常は省略）。
quality は意味論・明示状態・素材・操作・実機比較を分離します。complete は素材描画のみです。
PNG の final_frame_summary は実フォント測定後の最終座標 digest・件数を返します。
settings.event_factory_selections で選択イベントを指定できます。祖先定義を選択してください。
settings.ui_instance_id（既定jsonui-cli）とlocal_toggle_stateで静的ローカル状態を注入できます。
local_toggle_stateはversion:1/instanceId/revision/valuesの形式、値は要素IDごとの真偽値です。
replace-stateはローカル状態も初期化します。CLIはポインター操作・音声出力を実行しません。
Pocket UI は参照・編集可能、プレビュー不可です。
--file / --definition は候補が複数あれば省略できません。
`;

export const HELP_EN = `JSON UI Workbench command mode (Node.js 22.14.0 or later)
CLI is the primary entry. Node SDK: createRenderer in local-node/api.mjs.
Persistent HTTP: npm run api. Experimental GUI: npm run gui. CLI/SDK/API do not open a browser.
Usage: node local-node/cli.mjs <command> --session <session.json> [options]

import      --pack <pack.zip|pack.mcpack|addon.mcaddon> [--vanilla <vanilla.zip>] [--resource-pack <UUID>]
            Use --vanilla alone for a vanilla-only workspace. Replaces the selected layer and resets its edits.
list        [--kind imported|vanilla]  List imported UI files.
definitions [--file ui/example.json] [--definition namespace.name] [--kind ...]
read        --file ui/example.json [--kind imported|vanilla] [--out authored.json]
interact    --request-file interaction.json [--out interaction-result.json]
            Projects local input with the SDK JSON contract. Pass returned state to the next request.
resolve-sound --request-file sound.json [--out sound-result.json]
            Resolves a registered soundId to bounded audio metadata; does not play audio.
validate    --file ui/example.json --definition namespace.screen [--out validation.json]
preview     --file ui/example.json --definition namespace.screen
            [--frame N] [--fps 60] [--width 1920] [--height 1080] [--ui-scale auto|1..8]
            [--format json|svg|png] [--out frame.json|frame.svg|frame.png] [--allow-partial]
            [--frame-summary] Bounded counts and truncation diagnostics (no renderable frame)
features    Show CLI/site capability boundaries without opening a session.
draft       --operation operation.json --file ui/example.json --definition namespace.screen
            [--out draft.json] [--width 1920] [--height 1080] [--ui-scale auto|1..8] [--frame N] [--fps 60]
            Return draft frame JSON without committing sources, history, or session.
settings    [--file settings.json]  Show settings or merge and save a settings JSON file.
            [--state-file state.json] [--replace-state]  Shared typed state, exclusive with file.
edit        --operation operation.json  Use the same source-editing API as the site.
edit        --file ui/example.json --text-file edited.json  Replace source text directly.
edit        --action set|move|add|inherit|planDelete|delete --file ui/example.json
            --pointer /screen/controls/0/title [--kind imported|vanilla] [--value <JSON>] [--cascade]
undo        Undo the last source edit, including edits saved by another process.
redo        Reapply an undone edit. A new edit or pack replacement clears redo history.
export      --file ui/example.json --definition namespace.screen --out selected.mcpack
            Or use --selections selections.json. --plan returns the dependency plan only.
            [--pack-options pack-options.json] [--pack-icon icon.png]
diagnostics [--out diagnostics.json]  Save current CLI and Node diagnostics.
status      [--live]  Inspect saved state. --live also checks source ZIPs and the workspace.
workflow    --file workflow.json  Execute several commands in one process, saving each successful change.
help        [--json]  Show this help.

Common: --language ja|en. Precedence: option, JSONUI_LANGUAGE, saved language, Japanese.
The language setting controls console messages. locale controls resource-pack text and fonts.
width/height are output pixels; ui_scale matches the site UI scale. auto uses pack calibration
or the default 4x. Use --ui-scale 1 for the previous one-pixel-per-logical-unit output.
target_engine_version selects vanilla-only native models (default 1.26.40); an imported
pack uses its manifest min_engine_version, matching the site.
A workflow command cannot override language. Settings changes affect subsequent diagnostics.

Regular stdout contains one JSON object on success or failure. Failures exit nonzero.
Use --force to replace an existing generated artifact. Source archives and application files are protected.
A session stores source archive paths and SHA-256 hashes, source overrides, settings, and editing history.
History is bounded to 64 entries / 8 MiB; discarded oldest entries are reported by status.
Changed source archives stop session restoration. Commands automatically start and stop their own
local server. Use workflow to share one server across several operations.
SVG is a layout-boundary diagnostic diagram, not a texture, glyph, or 3D preview.
PNG uses the available @napi-rs/canvas backend and resource-pack assets. Unresolved assets block
PNG output by default. PNG without --frame captures approximately one second after entrance;
an explicit --frame 0 captures the exact initial state. --allow-partial explicitly permits incomplete diagnostic output.
PNG output does not guarantee pixel parity with Minecraft. JSON includes source projection,
frame IR, and validation results. Pocket UI can be read and edited, but cannot be previewed.
Specify --file and --definition when more than one candidate is available.
validate/preview --strict-semantics stops on selected-resolution errors or uncertainty.
For preview it also stops on collection-row and visual/input binding uncertainty; strict takes precedence over allow-partial.
validate does not evaluate runtime rows or bindings. PNG normally rejects uncertain visual/input bindings.
preview --strict-animation rejects unsupported, unknown or incomplete animation evidence, even with allow-partial; it does not certify native parity.
preview_complete covers assets, collection rows and visual/input bindings; draft:true identifies an explicitly partial PNG.
PNG --draw-evidence adds bounded final text/image draw inputs (omitted by default).
quality separates semantics, explicit state, assets, interaction and native comparison; complete covers raster assets only.
PNG final_frame_summary describes the final geometry after resource-font measurement.
settings.event_factory_selections selects an explicit event; select its actual ancestor definition.
settings.ui_instance_id (default jsonui-cli) and local_toggle_state inject a static local state snapshot.
local_toggle_state uses version:1/instanceId/revision/values, with boolean values keyed by node ID.
replace-state clears local state too. CLI does not execute pointer input or audio output.
`;

export function parseArguments(argv) {
  let command = null; const options = {};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (!argument.startsWith('--')) {
      if (command === null) { command = argument; continue; }
      throw cliError('CLI_ARGUMENT_UNKNOWN', '位置引数が多すぎます。help を確認してください。');
    }
    const equal = argument.indexOf('='), key = argument.slice(2, equal < 0 ? undefined : equal);
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw cliError('CLI_ARGUMENT_UNKNOWN', 'このオプションは使用できません。', { option: key });
    if (!key || Object.hasOwn(options, key)) throw cliError('CLI_ARGUMENT_DUPLICATE', 'オプションが重複しています。', { option: key });
    if (FLAGS.has(key)) {
      if (equal >= 0) throw cliError('CLI_ARGUMENT_VALUE_INVALID', '真偽フラグに値は指定しないでください。', { option: key });
      options[key] = true;
    } else {
      const value = equal < 0 ? argv[++i] : argument.slice(equal + 1);
      if (value === undefined || value.startsWith('--')) throw cliError('CLI_ARGUMENT_VALUE_REQUIRED', 'オプションの値が必要です。', { option: key });
      options[key] = value;
    }
  }
  if (options.help || !command) command = 'help';
  validateOptions(command, options);
  return { command, options };
}

function validateOptions(command, options) {
  if (!Object.hasOwn(COMMANDS, command)) throw cliError('CLI_COMMAND_UNKNOWN', '不明なコマンドです。help を確認してください。');
  const allowed = new Set([...COMMON, ...COMMANDS[command], 'help']);
  for (const [key, value] of Object.entries(options)) {
    if (!allowed.has(key)) throw cliError('CLI_ARGUMENT_UNKNOWN', 'このコマンドでは使えないオプションです。', { option: key });
    if (FLAGS.has(key) ? typeof value !== 'boolean' : typeof value !== 'string') throw cliError('CLI_ARGUMENT_TYPE_INVALID', 'オプションの型が不正です。', { option: key });
  }
}

function assertResult(result, fallback = 'CLI_OPERATION_FAILED') {
  if (!object(result) || result.ok === false) {
    const code = typeof result?.error === 'string' ? result.error : result?.error?.code || fallback;
    throw cliError(/^[A-Z0-9_]{1,100}$/u.test(code) ? code : fallback, '要求された操作を完了できません。', { result });
  }
  return result;
}

function sourceSummary(source) {
  return { kind: source.kind, name: source.name || path.basename(source.path), size_bytes: source.size_bytes,
    checksum_sha256: source.checksum_sha256, edited_files: Object.keys(source.overrides || {}).length,
    ...(source.resource_pack_uuid ? { resource_pack_uuid: source.resource_pack_uuid, resource_pack_sha256: source.resource_pack_sha256 || null } : {}) };
}

class ExecutionContext {
  constructor(sessionPath, session, signal) { this.sessionPath = sessionPath; this.session = session; this.signal = signal; this.client = null; this.workspace = null; this.catalog = null; this.inputPaths = new Set(session.sources.map(source => source.path)); this.importedPackMetadata = null; }
  protectedPaths() { return [...this.session.sources.map(source => source.path), ...this.inputPaths]; }
  async resetRemote() { if (this.client) await this.client.close(); this.client = null; this.workspace = null; this.catalog = null; }
  async ensureWorkspace() {
    this.signal?.throwIfAborted();
    if (this.workspace) return this.workspace;
    if (!this.session.sources.length) throw cliError('CLI_PACK_REQUIRED', '先に import コマンドでパックを取り込んでください。');
    this.client ||= await CliClient.start({ signal: this.signal });
    const wireSources = [], descriptors = []; this.importedPackMetadata = null;
    for (const source of this.session.sources) {
      const imported = await this.client.importPack(source.path, source.checksum_sha256 ? source : null,
        source.resource_pack_uuid ? { resourcePack: source.resource_pack_uuid } : {});
      if (source.kind === 'imported') this.importedPackMetadata = { ...imported.metadata, id: imported.id, overrides: source.overrides || {} };
      descriptors.push({ ...imported.source, kind: source.kind, overrides: source.overrides || {} });
      wireSources.push({ id: imported.id, kind: source.kind, overrides: source.overrides || {} });
    }
    this.workspace = assertResult(await this.client.request('/api/node/workspace-open', { payload: { sources: wireSources } }));
    this.session.sources = descriptors;
    return this.workspace;
  }
  async previewViewport(settings, options, width, height) {
    const requested = options['ui-scale'] ?? settings.ui_scale;
    if (requested !== 'auto') {
      const uiScale = finiteNumber(requested, 4, { minimum: 1, maximum: 8, integer: true });
      return { uiScale, scaleSource: 'manual', preset: logicalCanvasPreset({ width, height }, uiScale) };
    }
    let observedUiScale, scaleSource = 'classic-default';
    const pack = this.importedPackMetadata;
    const buildInfoPath = pack?.packPaths?.find(name => name.toLowerCase() === 'build-info.json');
    if (buildInfoPath) {
      // Same optional authored calibration and bounded fallback as the site.
      try {
        const text = pack.overrides?.[buildInfoPath] ?? (await this.client.request(`/api/node/packs/${pack.id}/read?path=${encodeURIComponent(`${pack.rootPrefix || ''}${buildInfoPath}`)}&maxBytes=${2 * 1024 * 1024}`, { method: 'GET', binary: true, maximum: 2 * 1024 * 1024 })).toString('utf8');
        const parsed = parseJsonc(text, { filePath: buildInfoPath, allowTrailingComma: true });
        if (parsed.ok) { observedUiScale = inferPackUiScaleFromBuildInfo(parsed.value); scaleSource = buildInfoPath; }
      } catch { /* Calibration is optional, matching browser import policy. */ }
    }
    const uiScale = activeClassicUiScale({ observedUiScale });
    return { uiScale, scaleSource, preset: logicalCanvasPreset({ width, height }, uiScale) };
  }
  async status() {
    await this.ensureWorkspace();
    this.workspace = assertResult(await this.client.request('/api/node/workspace-status', { payload: { workspaceId: this.workspace.workspaceId } }));
    return this.workspace;
  }
  async capture() {
    const status = await this.status();
    if (!Array.isArray(status.sources) || status.sources.length !== this.session.sources.length) throw cliError('CLI_WORKSPACE_STATE_INVALID', '編集状態を安全に保存できません。');
    const nextSources = this.session.sources.map(source => {
      const remote = status.sources.find(item => item.kind === source.kind);
      if (!remote || !object(remote.overrides)) throw cliError('CLI_WORKSPACE_STATE_INVALID', '編集差分を安全に保存できません。');
      return { ...source, overrides: remote.overrides };
    });
    this.session.sources = nextSources; this.session.workspace_revision = status.revision;
    return status;
  }
  async save() { return saveSession(this.sessionPath, this.session, this.protectedPaths()); }
  async getCatalog() {
    await this.ensureWorkspace();
    this.catalog ||= assertResult(await this.client.request('/api/node/workspace-catalog', { payload: { workspaceId: this.workspace.workspaceId } }));
    return this.catalog;
  }
  async select(options) {
    const catalog = await this.getCatalog();
    let records = (catalog.records || []).filter(record => !options.file || record.filePath === options.file);
    if (options.kind) {
      if (!['imported', 'vanilla'].includes(options.kind)) throw cliError('CLI_SOURCE_KIND_INVALID', 'kind は imported または vanilla を指定してください。');
      records = records.filter(record => record.sourceKind === options.kind);
    }
    const selection = options.definition || (!options.file ? this.session.selected?.raw_key : null);
    if (selection) records = records.filter(record => [record.id, record.rawKey, record.localName, record.qualifiedName].includes(selection));
    if (!options.file && !options.definition && this.session.selected) records = records.filter(record => record.filePath === this.session.selected.file_path && record.sourceKind === this.session.selected.source_kind);
    // A lower layer with the same physical file/symbol is shadowed. Distinct raw
    // keys at the winning layer remain ambiguous until the caller selects one.
    if (!options.kind) records = records.filter(record => !records.some(other => other.filePath === record.filePath && other.qualifiedName === record.qualifiedName && other.precedence > record.precedence));
    if (records.length !== 1) throw cliError(records.length ? 'CLI_DEFINITION_AMBIGUOUS' : 'UI_DEFINITION_NOT_FOUND', records.length ? 'UI の候補が複数あります。file と definition を指定してください。' : '指定された UI 定義が見つかりません。',
      { candidates: records.slice(0, 30).map(({ filePath, rawKey, qualifiedName, sourceKind }) => ({ file_path: filePath, raw_key: rawKey, qualified_name: qualifiedName, source_kind: sourceKind })), candidate_count: records.length });
    return records[0];
  }
  async project(options) {
    const record = await this.select(options), savedSettings = checkedSettings(this.session.settings);
    // The site supplies Classic platform variables and structural collection
    // counts before inheritance is resolved. Runtime bindings alone are too
    // late to resolve vector variables or materialize a factory's children.
    // Keep explicit CLI variables/collection rows authoritative and do not
    // write representative defaults back into the user's saved settings.
    const settings = { ...savedSettings, collections: {
      ...(object(savedSettings.mock_data.__collections) ? savedSettings.mock_data.__collections : {}),
      ...savedSettings.collections,
    } };
    const projection = assertResult(await this.client.request('/api/node/project', { payload: { catalogId: this.catalog.nodeCatalogId,
      recordId: record.id,
      variables: buildRepresentativeClassicResolverVariables({ qualifiedName: record.qualifiedName,
        userVariables: { ...settings.mock_data, ...settings.variables } }),
      representativeCollections: buildRepresentativeClassicCollections({ qualifiedName: record.qualifiedName,
        collectionData: settings.collections }),
      eventFactorySelections: settings.event_factory_selections,
    } }), 'CLI_PROJECTION_INVALID');
    return { record, projection, settings };
  }
}

async function emitArtifact(context, out, bytes, extensions, force = false) {
  return atomicWrite(out, bytes, { extensions, protectedPaths: [context.sessionPath, ...context.protectedPaths()], replace: force });
}

async function buildOperation(context, options) {
  if (options.kind && !['imported', 'vanilla'].includes(options.kind)) throw cliError('CLI_SOURCE_KIND_INVALID', 'kind は imported または vanilla を指定してください。');
  if (options.operation) {
    if (Object.keys(options).some(key => ![...COMMON, 'operation', 'kind'].includes(key))) throw cliError('CLI_EDIT_ARGUMENT_CONFLICT', 'operation ファイル指定と個別編集オプションは併用できません。');
    context.inputPaths.add(checkedPath(options.operation)); const operation = await readJson(options.operation);
    if (operation.kind !== undefined && !['imported', 'vanilla'].includes(operation.kind)) throw cliError('CLI_SOURCE_KIND_INVALID', 'operation.kind は imported または vanilla を指定してください。');
    const specifiedKind = options.kind || operation.kind;
    const sourceKind = operation.sourceId === 'vanilla-reference' ? 'vanilla' : operation.sourceId === 'imported-pack' ? 'imported' : operation.sourceId;
    if ((options.kind && operation.kind && options.kind !== operation.kind)
      || (specifiedKind && operation.sourceId !== undefined && sourceKind !== specifiedKind)) throw cliError('CLI_EDIT_ARGUMENT_CONFLICT', 'kind と operation.sourceId の層指定が一致しません。');
    const { kind: _kind, ...rest } = operation;
    return { ...rest, ...(specifiedKind ? { sourceId: specifiedKind } : {}) };
  }
  if (!options.file) throw cliError('CLI_FILE_REQUIRED', '編集対象のパック内 file を指定してください。');
  if (options['text-file']) {
    if (options.action || options.pointer || options.value) throw cliError('CLI_EDIT_ARGUMENT_CONFLICT', '原文置換と個別編集オプションは併用できません。');
    context.inputPaths.add(checkedPath(options['text-file']));
    return { type: 'replaceText', path: options.file, text: await readRegularText(options['text-file'], 8 * 1024 * 1024), ...(options.kind ? { sourceId: options.kind } : {}) };
  }
  if (!['set', 'move', 'add', 'inherit', 'planDelete', 'delete'].includes(options.action)) throw cliError('CLI_EDIT_ACTION_INVALID', '対応する編集 action を指定してください。');
  const operation = { type: options.action, path: options.file };
  if (options.kind) operation.sourceId = options.kind;
  if (options.pointer !== undefined) operation.pointer = options.pointer;
  if (options.value !== undefined) {
    try { operation[options.action === 'move' ? 'offset' : 'value'] = JSON.parse(options.value); }
    catch { throw cliError('CLI_JSON_INVALID', 'value は JSON で指定してください。'); }
  }
  if (options['parent-pointer'] !== undefined) operation.parentPointer = options['parent-pointer'];
  if (options.name !== undefined) operation.name = options.name;
  if (options['base-ref'] !== undefined) operation.baseRef = options['base-ref'];
  if (options.index !== undefined) operation.index = finiteNumber(options.index, 0, { maximum: 50000, integer: true });
  if (options.cascade) operation.cascade = true;
  return operation;
}

async function executeCommand(context, command, options) {
  context.signal?.throwIfAborted();
  if (command === 'features') return cliCapabilities28();
  if (command === 'draft') {
    if (!options.operation) throw cliError('CLI_OPERATION_REQUIRED', '草稿の操作JSONファイルを指定してください。');
    const requested = await buildOperation(context, { operation: options.operation });
    const { record, settings } = await context.project(options);
    const operation = requested.type === 'batch' ? requested
      : { type: 'batch', pointerBasis: 'base-revision', operations: [requested] };
    const fps = finiteNumber(options.fps, settings.fps, { minimum: 1, maximum: 240 });
    const frameIndex = finiteNumber(options.frame, 0, { minimum: 0, maximum: 10000000, integer: true });
    const width = finiteNumber(options.width, settings.width, { minimum: 1, integer: true });
    const height = finiteNumber(options.height, settings.height, { minimum: 1, integer: true });
    const viewport = await context.previewViewport(settings, options, width, height);
    const variables = buildRepresentativeClassicResolverVariables({ qualifiedName: record.qualifiedName,
      userVariables: { ...settings.mock_data, ...settings.variables } });
    const representativeCollections = buildRepresentativeClassicCollections({ qualifiedName: record.qualifiedName, collectionData: settings.collections });
    const result = assertResult(await context.client.request('/api/node/workspace-preview-draft', { payload: {
      workspaceId: context.workspace.workspaceId, expectedRevision: context.workspace.revision, pendingVersion: 1, operation,
      screen: { path: record.filePath, pointer: '/' + record.rawKey.replaceAll('~', '~0').replaceAll('/', '~1'), sourceId: record.sourceKind },
      preview: { variables, representativeCollections, eventFactorySelections: settings.event_factory_selections },
      variables, representativeCollections, eventFactorySelections: settings.event_factory_selections,
      frame: { preset: viewport.preset, generation: 1, animationTime: frameIndex / fps, animationEvent: settings.animation_event,
        qualifiedName: record.qualifiedName, mockData: settings.mock_data, collectionData: settings.collections,
        scrollById: settings.scroll, visibilityMode: settings.visibility,
        uiInstanceId: settings.ui_instance_id, localToggleState: settings.local_toggle_state },
    } }));
    // Confirm the endpoint did not mutate the live workspace before reporting a non-destructive draft.
    const after = await context.status();
    if (result.committed !== false || after.revision !== result.baseRevision) throw cliError('CLI_DRAFT_MUTATION', '草稿計算で確定状態が変わりました。セッションを保存しません。');
    const snapshot = { ...result, viewport: { width, height, ui_scale: viewport.uiScale,
      logical_width: viewport.preset.width, logical_height: viewport.preset.height }, frame_index: frameIndex, fps,
      session_modified: false, source_archives_modified: false };
    return options.out ? { committed: false, base_revision: result.baseRevision, draft_revision: result.draftRevision,
      box_count: result.frame.layout?.boxes?.length || 0, session_modified: false,
      artifact: await emitArtifact(context, options.out, JSON.stringify(snapshot, null, 2) + '\n', ['.json'], options.force) } : snapshot;
  }
  if (command === 'diagnostics') {
    // In a workflow this observes the same server used by preceding commands.
    // A standalone command restores sources, then reports this invocation only.
    if (context.session.sources.length) await context.ensureWorkspace();
    else context.client ||= await CliClient.start({ signal: context.signal });
    const bundle = await context.client.request('/api/node/debug-bundle', { payload: {
      schema: 'jsonui-debug-request-v1',
      state: { surface: 'cli', session_schema: context.session.schema,
        workspace_revision: context.workspace?.revision ?? context.session.workspace_revision ?? null,
        sources: context.session.sources.map(sourceSummary), history: historySummary(context.session),
        settings: checkedSettings(context.session.settings), coverage: 'current_cli_invocation' },
      selection: context.session.selected || {}, diagnostics: [], events: [],
    } });
    if (!object(bundle) || bundle.schema !== 'jsonui-debug-bundle-v1') throw cliError('CLI_RESPONSE_INVALID', '診断 API の応答形式が不正です。');
    if (!options.out) return { bundle };
    return { artifact: await emitArtifact(context, options.out, JSON.stringify(bundle, null, 2) + '\n', ['.json'], options.force),
      schema: bundle.schema, coverage: 'current_cli_invocation' };
  }
  if (command === 'status') {
    const live = options.live ? await context.status() : null;
    const rasterBackend = loadRasterBackend();
    return { sources: context.session.sources.map(sourceSummary), settings: checkedSettings(context.session.settings), selected: context.session.selected,
      workspace_revision: context.session.workspace_revision ?? null, history: historySummary(context.session),
      ...(live ? { live: { revision: live.revision, preview_allowed: live.previewAllowed, file_count: live.files?.length, diagnostics: live.diagnostics } } : {}),
      capabilities: { image_formats: rasterBackend ? ['json', 'svg', 'png'] : ['json', 'svg'], svg_kind: 'diagnostic_layout',
        png: Boolean(rasterBackend), png_backend: rasterBackend ? { name: rasterBackend.name, version: rasterBackend.version, source: rasterBackend.source } : null,
        diagnostics_bundle: true, export_pack_options: true, export_pack_icon: true, source_archives_modified: false } };
  }
  if (command === 'settings') {
    if ((options.file && options['state-file']) || (options['replace-state'] && !options['state-file'])) {
      throw cliError('CLI_ARGUMENT_CONFLICT', 'state-file と file は併用できません。replace-state は state-file と一緒に指定してください。');
    }
    if (options['state-file']) {
      const filename = checkedPath(options['state-file']); context.inputPaths.add(filename);
      const prepared = prepareTypedCliState(await readRegularText(filename, 1024 * 1024), checkedSettings(context.session.settings), Boolean(options['replace-state']));
      context.session.settings = checkedSettings(prepared.settings);
      context.session.preview_state = prepared.evidence; await context.save();
    }
    if (options.file) {
      context.inputPaths.add(checkedPath(options.file));
      const input = await readJson(options.file);
      context.session.settings = checkedSettings({ ...context.session.settings, ...input });
      if (settingsChangeInvalidatesState(input)) delete context.session.preview_state;
      await context.save();
      context.language = resolveLanguage(context.languageOverride, undefined, context.session.settings.language);
    }
    return { settings: checkedSettings(context.session.settings), ...(context.session.preview_state ? { state_evidence: context.session.preview_state } : {}) };
  }
  if (command === 'import') {
    if (!options.pack && !options.vanilla) throw cliError('CLI_PACK_REQUIRED', 'pack または vanilla のファイルを指定してください。');
    if (options['resource-pack'] && (!options.pack || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(options['resource-pack']))) {
      throw cliError('CLI_ARGUMENT_CONFLICT', 'resource-pack は pack と併用し、RP の UUID を指定してください。');
    }
    const previous = context.session, candidate = structuredClone(previous);
    for (const [kind, filename] of [['imported', options.pack], ['vanilla', options.vanilla]]) {
      if (!filename) continue;
      const sourcePath = checkedPath(filename);
      if (sourcePath === context.sessionPath) throw cliError('CLI_SOURCE_PATH_PROTECTED', 'セッションと元パックに同じファイルは指定できません。');
      context.inputPaths.add(sourcePath);
      candidate.sources = candidate.sources.filter(source => source.kind !== kind);
      candidate.sources.push({ kind, path: sourcePath, overrides: {},
        ...(kind === 'imported' && options['resource-pack'] ? { resource_pack_uuid: options['resource-pack'].toLowerCase() } : {}) });
    }
    candidate.selected = null; delete candidate.history; context.session = candidate;
    let catalog;
    try {
      await context.resetRemote(); await context.ensureWorkspace(); await context.capture();
      // Catalog validation is part of import: rejected packs must not discard
      // the previous layer's persisted edits or undo/redo history.
      catalog = await context.getCatalog(); await context.save();
    }
    catch (error) { context.session = previous; await context.resetRemote(); throw error; }
    return { sources: context.session.sources.map(sourceSummary), file_count: catalog.files?.length || 0, definition_count: catalog.records?.length || 0, diagnostics: catalog.diagnostics || [] };
  }
  if (command === 'list' || command === 'definitions') {
    const catalog = await context.getCatalog();
    if (options.kind && !['imported', 'vanilla'].includes(options.kind)) throw cliError('CLI_SOURCE_KIND_INVALID', 'kind は imported または vanilla を指定してください。');
    const items = (command === 'list' ? catalog.files : catalog.records).filter(item => (!options.kind || item.sourceKind === options.kind)
      && (!options.file || item.filePath === options.file) && (!options.definition || [item.rawKey, item.qualifiedName, item.localName, item.id].includes(options.definition)));
    return { count: items.length, items, diagnostics: catalog.diagnostics || [] };
  }
  if (command === 'read') {
    if (!options.file) throw cliError('CLI_FILE_REQUIRED', 'パック内 file を指定してください。');
    if (options.kind && !['imported', 'vanilla'].includes(options.kind)) throw cliError('CLI_SOURCE_KIND_INVALID', 'kind は imported または vanilla を指定してください。');
    await context.ensureWorkspace();
    const document = assertResult(await context.client.request('/api/node/workspace-read', { payload: { workspaceId: context.workspace.workspaceId, path: options.file, ...(options.kind ? { sourceId: options.kind } : {}) } }));
    if (options.out) return { ...document, artifact: await emitArtifact(context, options.out, document.text, ['.json', '.jsonc'], options.force) };
    return document;
  }
  if (command === 'edit') {
    const operation = await buildOperation(context, options); await context.ensureWorkspace();
    const before = sourceSnapshot(context.session.sources), beforeRevision = context.workspace.revision;
    const result = assertResult(await context.client.request('/api/node/workspace-edit', { payload: { workspaceId: context.workspace.workspaceId, expectedRevision: context.workspace.revision, operation } }));
    context.catalog = null; await context.capture();
    context.session.history = appendHistory(context.session, before, beforeRevision, context.workspace.revision);
    await context.save();
    return { ...result, history: historySummary(context.session) };
  }
  if (command === 'undo' || command === 'redo') {
    await context.ensureWorkspace();
    const previous = structuredClone(context.session), history = readHistory(context.session);
    const entry = history[command].at(-1);
    if (!entry) throw cliError(command === 'undo' ? 'CLI_UNDO_EMPTY' : 'CLI_REDO_EMPTY', '適用できる編集履歴がありません。');
    const expected = command === 'undo' ? entry.after_revision : entry.before_revision;
    if (context.workspace.revision !== expected) throw cliError('CLI_HISTORY_REVISION_MISMATCH', '現在の原文と履歴の改訂が一致しません。履歴を適用しません。');
    history[command].pop(); history[command === 'undo' ? 'redo' : 'undo'].push(entry);
    const candidate = { ...context.session, sources: restoreSnapshot(context.session.sources, command === 'undo' ? entry.before : entry.after), history };
    const target = command === 'undo' ? entry.before_revision : entry.after_revision;
    try {
      context.session = candidate; await context.resetRemote(); await context.ensureWorkspace();
      if (context.workspace.revision !== target) throw cliError('CLI_HISTORY_RESTORE_MISMATCH', '履歴復元後の原文が記録と一致しません。保存しません。');
      await context.capture(); await context.save();
    } catch (error) { context.session = previous; await context.resetRemote(); throw error; }
    return { ok: true, revision: target, history: historySummary(context.session) };
  }
  if (command === 'interact' || command === 'resolve-sound') {
    if (!options['request-file']) throw cliError('CLI_FILE_REQUIRED', 'request-fileで操作要求のJSONファイルを指定してください。');
    context.inputPaths.add(checkedPath(options['request-file']));
    const request = checkedApiRequest(command === 'interact' ? 'interact' : 'resolveSound', await readJson(options['request-file']));
    const { settings, evidence } = apiPreviewSettings(context.session.settings, request);
    await context.ensureWorkspace();
    // The request owns a temporary projection context. It does not overwrite
    // persisted CLI settings or retain a simulated native form session.
    const isolated = Object.create(context);
    isolated.session = { ...context.session, settings, preview_state: evidence };
    const result = command === 'interact' ? await prepareInteraction(isolated, request) : await prepareSound(isolated, request);
    const artifact = options.out ? await emitArtifact(context, options.out, JSON.stringify(localizeConsoleResult(result, context.language), null, 2) + '\n', ['.json'], options.force) : null;
    return { ...result, ...(artifact ? { artifact } : {}) };
  }
  if (command === 'validate' || command === 'preview') {
    const format = options.format || (options.out ? path.extname(options.out).slice(1).toLowerCase() : 'json');
    if (command === 'preview' && !['json', 'svg', 'png'].includes(format)) throw cliError('CLI_IMAGE_FORMAT_UNSUPPORTED', 'JSON / SVG / PNG の出力形式を指定してください。', { supported_formats: ['json', 'svg', 'png'] });
    if (options['allow-partial'] && format !== 'png') throw cliError('CLI_ARGUMENT_CONFLICT', 'allow-partial は PNG の診断出力にのみ指定できます。');
    if (options['frame-summary'] && (format !== 'json' || options['strict-animation'])) throw cliError('CLI_ARGUMENT_CONFLICT', 'frame-summary は JSON 診断専用です。画像出力・strict-animation とは併用できません。');
    if (options['draw-evidence'] && format !== 'png') throw cliError('CLI_ARGUMENT_CONFLICT', 'draw-evidence は PNG の描画情報出力にのみ指定できます。');
    let rasterBackend;
    if (command === 'preview' && format === 'png') {
      if (!options.out) throw cliError('CLI_OUTPUT_REQUIRED', 'PNG 出力には out を指定してください。');
      rasterBackend = loadRasterBackend();
      if (!rasterBackend) throw cliError('RASTER_BACKEND_UNAVAILABLE', 'PNG 描画バックエンド @napi-rs/canvas が利用できません。JSON または SVG の構造診断を利用してください。');
    }
    const prepared = await preparePreview(context, options, { validationOnly: command === 'validate', format, rasterBackend });
    try {
      if (command === 'validate') {
        const artifact = options.out ? await emitArtifact(context, options.out, JSON.stringify(localizeConsoleResult(prepared.validation, context.language), null, 2) + '\n', ['.json'], options.force) : null;
        return { ...prepared.validation, ...(artifact ? { artifact } : {}) };
      }
      if (prepared.summary) {
        const artifact = options.out ? await emitArtifact(context, options.out, JSON.stringify(prepared.snapshot, null, 2) + '\n', ['.json'], options.force) : null;
        return { ...prepared.snapshot, ...(artifact ? { artifact } : {}) };
      }
      let artifact = null;
      if (options.out) {
        const bytes = format === 'json' ? JSON.stringify(localizeConsoleResult(prepared.snapshot, context.language), null, 2) + '\n' : prepared.bytes;
        artifact = await emitArtifact(context, options.out, bytes, [`.${format}`], options.force);
      } else if (format === 'svg') throw cliError('CLI_OUTPUT_REQUIRED', 'SVG 出力には out を指定してください。');
      const record = prepared.record;
      context.session.selected = { file_path: record.filePath, raw_key: record.rawKey, source_kind: record.sourceKind }; await context.save();
      return artifact ? { artifact, ...prepared.metadata } : prepared.snapshot;
    } catch (error) {
      if (error && typeof error === 'object') error.context = { ...error.context, stage_diagnostics: prepared.stageDiagnostics };
      throw error;
    }
  }
  if (command === 'export') {
    // Reject a missing/oversized icon or malformed configuration before a
    // potentially large resource-pack restore starts.
    const packConfiguration = await readPackConfiguration(context, options);
    await context.ensureWorkspace(); let selections;
    if (options.selections) {
      if (options.file || options.definition || options.kind) throw cliError('CLI_EXPORT_ARGUMENT_CONFLICT', 'selections ファイルと単一 UI 指定は併用できません。');
      context.inputPaths.add(checkedPath(options.selections)); selections = (await readJson(options.selections)).selections;
      if (!Array.isArray(selections) || !selections.length || selections.length > 256) throw cliError('CLI_EXPORT_SELECTION_INVALID', 'selections は 1～256 件の配列にしてください。');
    } else {
      const record = await context.select(options);
      selections = [{ sourceId: record.sourceId, filePath: record.filePath, rawKey: record.rawKey }];
    }
    const payload = { workspaceId: context.workspace.workspaceId, selections, mode: 'plan', ...packConfiguration };
    const plan = assertResult(await context.client.request('/api/node/workspace-export', { payload }), 'CLI_EXPORT_DEPENDENCY_FAILED');
    if (options.plan) {
      const artifact = options.out ? await emitArtifact(context, options.out, JSON.stringify(localizeConsoleResult(plan, context.language), null, 2) + '\n', ['.json'], options.force) : null;
      return { plan, ...(artifact ? { artifact } : {}) };
    }
    if (!options.out) throw cliError('CLI_OUTPUT_REQUIRED', '書出し先 out を指定してください。');
    await checkOutputPath(options.out, { extensions: ['.zip', '.mcpack'], protectedPaths: [context.sessionPath, ...context.protectedPaths()], replace: options.force });
    const zip = await context.client.request('/api/node/workspace-export', { payload: { ...payload, mode: 'zip' }, binary: true, maximum: 256 * 1024 * 1024 });
    if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) {
      let errorResult; try { errorResult = JSON.parse(zip.toString('utf8')); } catch { /* A non-ZIP response is never an archive artifact. */ }
      if (errorResult) assertResult(errorResult, 'CLI_EXPORT_DEPENDENCY_FAILED');
      throw cliError('CLI_EXPORT_ARCHIVE_INVALID', '書出し API が正常な ZIP を返しませんでした。');
    }
    return { artifact: await emitArtifact(context, options.out, zip, ['.zip', '.mcpack'], options.force), plan };
  }
  throw cliError('CLI_COMMAND_UNKNOWN', '未対応のコマンドです。');
}

/** Binary icon bytes are sent separately from metadata and never as a path.
 * Manifest and image-content validation remain shared with the website API. */
async function readPackConfiguration(context, options) {
  const payload = {};
  if (options['pack-options']) {
    const filename = checkedPath(options['pack-options']);
    context.inputPaths.add(filename);
    payload.packOptions = await readJson(filename, 64 * 1024);
    const allowed = new Set(['name', 'description', 'version', 'authors']);
    if (Object.keys(payload.packOptions).some(key => !allowed.has(key))) {
      throw cliError('CLI_PACK_OPTIONS_INVALID', 'パック情報には name、description、version、authors だけを指定してください。');
    }
  }
  if (options['pack-icon']) {
    const filename = checkedPath(options['pack-icon']);
    context.inputPaths.add(filename);
    if (path.extname(filename).toLowerCase() !== '.png') throw cliError('CLI_PACK_ICON_INVALID', 'パックアイコンには PNG ファイルを指定してください。');
    const bytes = await readRegularBytes(filename, 1024 * 1024);
    if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw cliError('CLI_PACK_ICON_INVALID', 'パックアイコンの PNG シグネチャを確認できません。');
    }
    payload.iconPngBase64 = bytes.toString('base64');
  }
  return payload;
}

async function executeWorkflow(context, options) {
  if (!options.file) throw cliError('CLI_FILE_REQUIRED', 'workflow の file を指定してください。');
  const filename = checkedPath(options.file); context.inputPaths.add(filename);
  const workflow = await readJson(filename);
  if (workflow.schema !== 'jsonui-cli-workflow-v1' || !Array.isArray(workflow.commands) || !workflow.commands.length || workflow.commands.length > 100) throw cliError('CLI_WORKFLOW_INVALID', 'workflow は schema と 1～100 件の commands を指定してください。');
  const base = path.dirname(filename), commands = [];
  const diskOptions = { import: ['pack', 'vanilla'], read: ['out'], validate: ['out'], preview: ['out'], interact: ['request-file', 'out'], 'resolve-sound': ['request-file', 'out'], settings: ['file', 'state-file'], edit: ['operation', 'text-file'], export: ['selections', 'out', 'pack-options', 'pack-icon'], diagnostics: ['out'] };
  // Validate every command before the first workflow mutation.
  for (const item of workflow.commands) {
    if (!object(item) || typeof item.command !== 'string' || ['workflow', 'help'].includes(item.command) || !object(item.options ?? {})) throw cliError('CLI_WORKFLOW_INVALID', 'workflow 内の command/options が不正です。');
    const commandOptions = { ...item.options };
    if (Object.hasOwn(commandOptions, 'session')) throw cliError('CLI_WORKFLOW_SESSION_FORBIDDEN', 'workflow 内で別セッションを指定できません。');
    if (Object.hasOwn(commandOptions, 'language')) throw cliError('CLI_WORKFLOW_LANGUAGE_FORBIDDEN', 'workflow 内で表示言語は変更できません。最上位の language または設定ファイルを使用してください。');
    validateOptions(item.command, commandOptions);
    for (const key of diskOptions[item.command] || []) if (commandOptions[key]) {
      commandOptions[key] = checkedPath(path.resolve(base, commandOptions[key]));
      if (key === 'out') continue;
      // Reserve existing inputs for the whole workflow before the first write,
      // including inputs consumed by later commands. An absent path can still
      // be produced by an earlier command and then imported in this workflow.
      try { await lstat(commandOptions[key]); context.inputPaths.add(commandOptions[key]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    commands.push({ command: item.command, options: commandOptions });
  }
  const completed = [];
  for (const [index, item] of commands.entries()) {
    try { completed.push({ index, command: item.command, ok: true, result: await executeCommand(context, item.command, item.options) }); }
    catch (error) {
      error.context = { ...error.context, workflow: { completed_count: completed.length, failed_index: index, command: item.command, completed } }; throw error;
    }
  }
  return { completed_count: completed.length, results: completed };
}

/** Import-safe entry used by CLI integration tests; emits nothing by itself. */
async function executeCli(argv) {
  const startedAt = new Date().toISOString(), { command, options } = parseArguments(argv);
  const languageOverride = options.language ?? (process.env.JSONUI_LANGUAGE || undefined);
  let initialLanguage = resolveLanguage(languageOverride);
  if (command === 'features') return { schema: SCHEMA, ok: true, command, result: cliCapabilities28() };
  if (command === 'help') {
    if (languageOverride === undefined) {
      // Help only reads an existing session. It creates no lock or state files.
      const saved = await readSession(checkedPath(options.session || path.join('.jsonui-cli', 'session.json')));
      initialLanguage = checkedSettings(saved.settings).language;
    }
    return { schema: SCHEMA, ok: true, command, result: { help: initialLanguage === 'en' ? HELP_EN : HELP_JA }, human_help: !options.json };
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 14)) throw cliError('CLI_NODE_VERSION_UNSUPPORTED', 'Node.js 22.14.0 以降が必要です。');
  const sessionPath = checkedPath(options.session || path.join('.jsonui-cli', 'session.json'));
  const release = await lockSession(sessionPath); let context;
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort(cliError('CLI_CANCELLED', '操作を取り消しました。直前に保存済みのセッションを維持します。'));
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    context = new ExecutionContext(sessionPath, await readSession(sessionPath), cancellation.signal);
    context.languageOverride = languageOverride;
    context.language = resolveLanguage(languageOverride, undefined, context.session.settings?.language);
    readHistory(context.session);
    context.session.settings = checkedSettings(context.session.settings);
    const result = command === 'workflow' ? await executeWorkflow(context, options) : await executeCommand(context, command, options);
    return localizeConsoleResult({ schema: SCHEMA, ok: true, command, started_at: startedAt, completed_at: new Date().toISOString(), result }, context.language);
  } catch (error) {
    error.language = context?.language || initialLanguage;
    throw error;
  } finally {
    try { await context?.resetRemote(); } finally {
      try { await release(); } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
    }
  }
}

export async function runCli(argv) {
  try { return await executeCli(argv); }
  catch (error) { error.language ||= languageHint(argv); throw error; }
}

export function errorResult(error, language = error.language || 'ja') {
  const known = { ENOENT: ['CLI_FILE_NOT_FOUND', '入力ファイルまたはディレクトリが見つかりません。'], EACCES: ['CLI_FILE_ACCESS_DENIED', 'ファイルへのアクセスが拒否されました。'], EPERM: ['CLI_FILE_ACCESS_DENIED', 'ファイル操作が許可されていません。'], ENOSPC: ['CLI_DISK_FULL', '保存先の空き容量が不足しています。'] };
  const [code, message] = known[error.code] || [/^[A-Z0-9_]{1,100}$/u.test(error.code || '') ? error.code : 'CLI_FAILED', error.code ? error.message : '処理中に予期しないエラーが発生しました。'];
  return localizeConsoleResult({ schema: SCHEMA, ok: false, completed_at: new Date().toISOString(), error: { code, message,
    category: error.category || 'internal', retryable: Boolean(error.retryable), correlation_id: error.correlationId || null,
    details: error.details || [], context: error.context || {} } }, language);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(result.human_help ? result.result.help : JSON.stringify(result) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify(errorResult(error)) + '\n'); process.exitCode = 1; }
}
