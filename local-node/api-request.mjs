/** JSON-only SDK boundary. Copies data at admission and never invokes getters or toJSON. */
import path from 'node:path';
import { checkedSettings, DEFAULT_SETTINGS } from './preview-settings.mjs';
import { prepareTypedCliState } from './cli-state38.mjs';
import { sanitizeDiagnostic } from './debug-bundle.mjs';
import { normalizeLocalToggleState } from '../editor-core/src/preview/local-toggle-state.js';

export const API_LIMITS = Object.freeze({ queue: 8, inputBytes: 16 * 1024 * 1024, nodes: 20000, depth: 32 });
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const runtimeKeys = ['mock_data', 'collections', 'variables', 'scroll', 'event_factory_selections', 'local_toggle_state'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const categories = new Set(['validation', 'authentication', 'authorization', 'not_found', 'already_exists', 'failed_precondition',
  'conflict', 'aborted', 'rate_limit', 'resource_exhausted', 'timeout', 'cancelled', 'dependency', 'unavailable', 'configuration', 'data_loss', 'internal', 'not_implemented']);
const safeMessages = Object.freeze({
  CLI_FILE_NOT_FOUND: '入力ファイルが見つかりません。', CLI_FILE_ACCESS_DENIED: '入力ファイルを読み込めません。',
  CLI_DEFINITION_AMBIGUOUS: 'UIの候補が複数あります。fileとdefinitionを指定してください。', UI_DEFINITION_NOT_FOUND: '指定されたUI定義が見つかりません。',
  CLI_VALIDATION_FAILED: '選択したUIに検査エラーがあります。', CLI_SEMANTIC_GATE_FAILED: '選択した投影の意味論を確定できません。',
  CLI_EVALUATION_INCOMPLETE: '展開・走査・描画が上限により不完全です。', CLI_COLLECTION_GATE_FAILED: 'コレクションの参照先を確定できません。',
  CLI_BINDING_GATE_FAILED: '表示・入力状態を確定できません。', CLI_ANIMATION_GATE_FAILED: 'アニメーションの対応範囲を確定できません。',
  CLI_NATIVE_PROPERTY_GATE_FAILED: '確認済みの非対応プロパティが含まれています。',
  RASTER_BACKEND_UNAVAILABLE: 'PNG描画バックエンドを利用できません。',
});

/** Finite public error contract. Native failures remain a non-enumerable cause. */
export class JsonUiApiError extends Error {
  constructor(code, message, { category = 'validation', retryable = false, correlation_id = null, context = {}, details, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    if (cause === undefined) Object.defineProperty(this, 'cause', { value: null, configurable: true });
    this.name = 'JsonUiApiError'; this.code = /^[A-Z][A-Z0-9_]{2,62}$/u.test(code || '') ? code : 'API_OPERATION_FAILED';
    this.category = categories.has(category) ? category : 'internal';
    this.retryable = Boolean(retryable); this.correlation_id = correlation_id;
    this.details = details === undefined ? this.category === 'validation'
      ? [{ kind: 'field_violation', field: '_request', reason: this.code, message }] : [] : sanitizeDiagnostic(details).data;
    this.context = sanitizeDiagnostic(context).data;
  }
  toJSON() {
    return { code: this.code, message: this.message, category: this.category, retryable: this.retryable,
      correlation_id: this.correlation_id, details: this.details, context: this.context };
  }
}
export function apiFailure(error) {
  if (error instanceof JsonUiApiError) return error;
  const known = { ENOENT: 'CLI_FILE_NOT_FOUND', EACCES: 'CLI_FILE_ACCESS_DENIED', EPERM: 'CLI_FILE_ACCESS_DENIED' };
  const inherited = /^(?:CLI|NODE|RASTER|PREVIEW_STATE|LOCAL_TOGGLE|ZIP|ADDON|UI|FONT|AUDIO|NATIVE|WORKSPACE)_[A-Z0-9_]{1,48}$/u.test(error?.code || '');
  const code = known[error?.code] || (inherited ? error.code : 'API_OPERATION_FAILED');
  const message = safeMessages[code] || (/^PREVIEW_STATE_/u.test(code) ? '型付きプレビュー状態を受理できません。' : 'レンダラーの処理を完了できません。');
  return new JsonUiApiError(code, message, { category: categories.has(error?.category) ? error.category : /^PREVIEW_STATE_/u.test(code) ? 'validation' : 'internal', retryable: error?.retryable,
    correlation_id: error?.correlation_id || error?.correlationId || null, context: error?.context || {}, cause: error });
}
function fail(code, message) { throw new JsonUiApiError(code, message); }

export function copyJsonInput(input = {}) {
  const budget = { nodes: 0, bytes: 0 }, seen = new Set();
  function bytes(value) {
    budget.bytes += Buffer.byteLength(value);
    if (budget.bytes > API_LIMITS.inputBytes) fail('API_INPUT_LIMIT', '要求JSONは16 MiB以下で指定してください。');
  }
  function copy(value, depth) {
    if (++budget.nodes > API_LIMITS.nodes || depth > API_LIMITS.depth) fail('API_INPUT_LIMIT', '要求JSONの要素数または深さが上限を超えました。');
    if (value === null || typeof value === 'boolean') { bytes(String(value)); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) { bytes(String(value)); return value; }
    if (typeof value === 'string') { bytes(value); return value; }
    if (typeof value !== 'object' || seen.has(value)) fail('API_REQUEST_INVALID', '循環参照・未定義値を含まないJSONデータを指定してください。');
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) fail('API_REQUEST_INVALID', '通常のJSONオブジェクトを指定してください。');
    if (Object.getOwnPropertySymbols(value).length) fail('API_REQUEST_INVALID', 'JSONに変換できないキーは使用できません。');
    const output = Array.isArray(value) ? [] : {};
    if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index)))) fail('API_REQUEST_INVALID', '疎な配列や独自プロパティは使用できません。');
    seen.add(value);
    for (const key of Object.keys(value)) {
      if (unsafeKeys.has(key)) fail('API_REQUEST_INVALID', 'このJSONキーは使用できません。');
      bytes(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('API_REQUEST_INVALID', 'アクセサープロパティは使用できません。');
      output[key] = copy(descriptor.value, depth + 1);
    }
    seen.delete(value); return output;
  }
  const copied = copy(input, 0);
  if (!record(copied)) fail('API_REQUEST_INVALID', '要求はJSONオブジェクトで指定してください。');
  if (Buffer.byteLength(JSON.stringify(copied)) > API_LIMITS.inputBytes) fail('API_INPUT_LIMIT', '要求JSONは16 MiB以下で指定してください。');
  return copied;
}
const selector = ['file', 'definition', 'kind'];
const fields = {
  create: ['settings', 'language'], import: ['pack', 'vanilla', 'resourcePack'], status: [],
  list: ['kind'], definitions: selector,
  validate: [...selector, 'settings', 'state', 'strictSemantics'],
  render: [...selector, 'settings', 'state', 'format', 'width', 'height', 'uiScale', 'fps', 'frame',
    'allowPartial', 'strictSemantics', 'strictAnimation', 'drawEvidence', 'frameSummary', 'uiInstanceId', 'localToggleState'],
  interact: [...selector, 'settings', 'state', 'width', 'height', 'uiScale', 'fps', 'frame',
    'uiInstanceId', 'localToggleState', 'expectedRevision', 'nodeId', 'event', 'inputSource'],
  resolveSound: ['soundId', 'selectionSeed', 'contextSampleRate'],
};
export function checkedApiRequest(method, input) {
  const value = copyJsonInput(input);
  if (!Object.hasOwn(fields, method) || Object.keys(value).some(key => !fields[method].includes(key))) fail('API_REQUEST_INVALID', 'この操作では使えない要求フィールドがあります。');
  for (const key of ['file', 'definition']) if (Object.hasOwn(value, key)) {
    if (typeof value[key] !== 'string' || !value[key] || value[key].length > 1024 || /[\u0000-\u001f]/u.test(value[key])) fail('API_REQUEST_INVALID', `${key}は空でない文字列で指定してください。`);
  }
  if (value.kind !== undefined && !['imported', 'vanilla'].includes(value.kind)) fail('API_REQUEST_INVALID', 'kindはimportedまたはvanillaを指定してください。');
  for (const key of ['allowPartial', 'strictSemantics', 'strictAnimation', 'drawEvidence', 'frameSummary']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') fail('API_REQUEST_INVALID', `${key}は真偽値で指定してください。`);
  }
  for (const key of ['width', 'height', 'fps', 'frame']) if (value[key] !== undefined) {
    const minimum = key === 'frame' ? 0 : 1, maximum = key === 'fps' ? 240 : key === 'frame' ? 240 * 3600 : 16384;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < minimum || value[key] > maximum
      || (key !== 'fps' && !Number.isInteger(value[key]))) fail('API_REQUEST_INVALID', `${key}の数値が許容範囲外です。`);
  }
  if (value.uiScale !== undefined && value.uiScale !== 'auto' && (!Number.isInteger(value.uiScale) || value.uiScale < 1 || value.uiScale > 8)) fail('API_REQUEST_INVALID', 'uiScaleはautoまたは1～8の整数を指定してください。');
  if (value.settings !== undefined && !record(value.settings)) fail('API_REQUEST_INVALID', 'settingsはJSONオブジェクトを指定してください。');
  if (value.state !== undefined && !record(value.state)) fail('API_REQUEST_INVALID', 'stateは型付き状態のJSONオブジェクトを指定してください。');
  if (value.uiInstanceId !== undefined && (typeof value.uiInstanceId !== 'string' || !value.uiInstanceId || value.uiInstanceId.length > 256 || /[\x00-\x1f\x7f]/u.test(value.uiInstanceId)
      || unsafeKeys.has(value.uiInstanceId))) fail('API_REQUEST_INVALID', 'uiInstanceIdは256文字以下の空でないIDを指定してください。');
  if (value.localToggleState !== undefined) {
    if (value.uiInstanceId === undefined) fail('API_REQUEST_INVALID', 'localToggleStateにはuiInstanceIdも指定してください。');
    const normalized = normalizeLocalToggleState(value.localToggleState, { instanceId: value.uiInstanceId });
    if (!normalized.ok) fail(normalized.error.code, normalized.error.message);
    value.localToggleState = normalized.state;
  }
  if (method === 'interact') {
    if (value.uiInstanceId === undefined || typeof value.nodeId !== 'string' || !value.nodeId || value.nodeId.length > 1024 || /[\x00-\x1f\x7f]/u.test(value.nodeId)
        || unsafeKeys.has(value.nodeId)) fail('API_REQUEST_INVALID', 'interactにはuiInstanceIdとnodeIdを指定してください。');
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) fail('API_REQUEST_INVALID', 'expectedRevisionは現在のローカル状態の更新番号を指定してください。');
    value.event ??= 'activate'; value.inputSource ??= value.event === 'escape' ? 'keyboard' : 'mouse';
    if (!['activate', 'escape'].includes(value.event) || !['mouse', 'keyboard'].includes(value.inputSource)) fail('API_REQUEST_INVALID', 'eventはactivateまたはescape、inputSourceはmouseまたはkeyboardを指定してください。');
  }
  if (method === 'resolveSound') {
    if (typeof value.soundId !== 'string' || !value.soundId.trim() || value.soundId.length > 256 || /[\x00-\x1f\x7f$#]/u.test(value.soundId)) fail('AUDIO_SOUND_NAME_INVALID', 'soundIdはサウンド定義のIDを指定してください。');
    if (value.selectionSeed !== undefined && (typeof value.selectionSeed !== 'string' || value.selectionSeed.length > 256)) fail('AUDIO_SELECTION_INVALID', 'selectionSeedは256文字以下の文字列を指定してください。');
    if (value.contextSampleRate !== undefined && (!Number.isInteger(value.contextSampleRate) || value.contextSampleRate < 8000 || value.contextSampleRate > 192000)) fail('AUDIO_SAMPLE_RATE_INVALID', 'contextSampleRateは8000～192000の整数を指定してください。');
  }
  if (method === 'create' && value.language !== undefined && !['ja', 'en'].includes(value.language)) fail('API_REQUEST_INVALID', 'languageはjaまたはenを指定してください。');
  if (method === 'import') {
    if (!value.pack && !value.vanilla) fail('API_REQUEST_INVALID', 'packまたはvanillaを指定してください。');
    for (const key of ['pack', 'vanilla']) if (value[key] !== undefined && (typeof value[key] !== 'string' || !path.isAbsolute(value[key]) || value[key].length > 32768)) fail('API_REQUEST_INVALID', `${key}はローカルファイルの絶対パスを指定してください。`);
    if (value.resourcePack !== undefined && (!value.pack || typeof value.resourcePack !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value.resourcePack))) fail('API_REQUEST_INVALID', 'resourcePackはpack内のRPのUUIDを指定してください。');
  }
  if (method === 'render') {
    value.format ??= 'json';
    if (!['json', 'svg', 'png'].includes(value.format)) fail('API_REQUEST_INVALID', 'formatはjson、svg、pngを指定してください。');
    if ((value.allowPartial || value.drawEvidence) && value.format !== 'png') fail('API_REQUEST_INVALID', 'allowPartialとdrawEvidenceはPNG専用です。');
    if (value.frameSummary && (value.format !== 'json' || value.strictAnimation)) fail('API_REQUEST_INVALID', 'frameSummaryはJSON専用でstrictAnimationと併用できません。');
  }
  return value;
}
export function apiPreviewSettings(base, request) {
  if ((request.uiInstanceId !== undefined || request.localToggleState !== undefined)
      && (Object.hasOwn(request.settings || {}, 'ui_instance_id') || Object.hasOwn(request.settings || {}, 'local_toggle_state'))) fail('API_STATE_CONFLICT', '明示したuiInstanceId/localToggleStateとsettings内の同じ設定は同時指定できません。');
  let settings = checkedSettings({ ...base, ...(request.settings || {}) }), evidence = null;
  if (request.state !== undefined) {
    if (runtimeKeys.some(key => Object.hasOwn(request.settings || {}, key))) fail('API_STATE_CONFLICT', 'stateとsettings内の実行時データは同時指定できません。');
    const prepared = prepareTypedCliState(JSON.stringify(request.state), settings, true);
    settings = checkedSettings(prepared.settings); evidence = prepared.evidence;
  }
  if (request.uiInstanceId !== undefined || request.localToggleState !== undefined) {
    settings = checkedSettings({ ...settings, ...(request.uiInstanceId !== undefined ? { ui_instance_id: request.uiInstanceId } : {}),
      local_toggle_state: request.localToggleState ?? null });
  }
  return { settings, evidence };
}
export function apiDefaultSettings(request) {
  return checkedSettings({ ...DEFAULT_SETTINGS, ...(request.settings || {}), ...(request.language ? { language: request.language } : {}) });
}
export function checkedAbortOptions(options = {}) {
  if (!record(options) || Object.keys(options).some(key => key !== 'signal') || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) fail('API_REQUEST_INVALID', '操作オプションは{signal: AbortSignal}で指定してください。');
  return options.signal;
}
