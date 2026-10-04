/** Shared CLI/SDK rendering settings; no startup, filesystem or DOM effects. */
import { cliError } from './cli-files.mjs';
import { parseEngineVersion } from '../editor-core/src/preview/native-model-preview.js';
import { normalizeLocalToggleState } from '../editor-core/src/preview/local-toggle-state.js';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const DEFAULT_SETTINGS = Object.freeze({ width: 1920, height: 1080, ui_scale: 'auto', target_engine_version: '1.26.40', fps: 60, locale: 'ja_JP', language: 'ja', visibility: 'safe',
  mock_data: {}, collections: {}, scroll: {}, variables: {}, event_factory_selections: {}, ui_instance_id: 'jsonui-cli', local_toggle_state: null, animation_event: 'screen.entrance_push', font_profile: 'bitmap' });
export function finiteNumber(value, fallback, { minimum = 0, maximum = 16384, integer = false } = {}) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum || (integer && !Number.isSafeInteger(number))) throw cliError('CLI_NUMBER_INVALID', '数値オプションが許容範囲外です。', { minimum, maximum, integer });
  return number;
}

export function checkedSettings(input) {
  if (!object(input) || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key))) throw cliError('CLI_SETTINGS_INVALID', '設定キーが不正です。');
  const settings = { ...DEFAULT_SETTINGS, ...input };
  if (!['ja', 'en'].includes(settings.language)) throw cliError('CLI_LANGUAGE_INVALID', '表示言語は ja または en を指定してください。');
  if (!['bitmap', 'observed-smooth'].includes(settings.font_profile)) throw cliError('CLI_SETTINGS_INVALID', 'font_profile は bitmap または observed-smooth を指定してください。');
  for (const key of ['width', 'height']) settings[key] = finiteNumber(settings[key], DEFAULT_SETTINGS[key], { minimum: 1, integer: true });
  if (settings.ui_scale !== 'auto') settings.ui_scale = finiteNumber(settings.ui_scale, 4, { minimum: 1, maximum: 8, integer: true });
  const targetVersion = parseEngineVersion(settings.target_engine_version);
  if (!targetVersion) throw cliError('CLI_SETTINGS_INVALID', 'target_engine_version に有効なエンジンバージョンを指定してください。');
  settings.target_engine_version = targetVersion.join('.');
  settings.fps = finiteNumber(settings.fps, 60, { minimum: 1, maximum: 240 });
  if (!/^[a-z]{2}_[A-Z]{2}$/u.test(settings.locale) || !['safe', 'structure'].includes(settings.visibility)
    || typeof settings.animation_event !== 'string' || settings.animation_event.length > 256 || /[\u0000-\u001f]/u.test(settings.animation_event)) throw cliError('CLI_SETTINGS_INVALID', '言語・表示・アニメーション設定が不正です。');
  for (const key of ['mock_data', 'collections', 'scroll', 'variables']) {
    if (!object(settings[key]) || Object.keys(settings[key]).some(name => ['__proto__', 'prototype', 'constructor'].includes(name))
      || Buffer.byteLength(JSON.stringify(settings[key])) > 1024 * 1024) throw cliError('CLI_SETTINGS_INVALID', '実行時データの形式またはサイズが不正です。', { setting: key });
  }
  if (!object(settings.event_factory_selections) || Object.keys(settings.event_factory_selections).length > 32
    || Object.entries(settings.event_factory_selections).some(([key, value]) => !/^[A-Za-z0-9_.:-]{1,128}$/u.test(key)
      || ['__proto__', 'prototype', 'constructor'].includes(key) || typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value))) {
    throw cliError('CLI_SETTINGS_INVALID', 'event_factory_selections は安全な factory 名と control_ids キーの対応を最大 32 件指定してください。');
  }
  const localState = normalizeLocalToggleState(settings.local_toggle_state, { instanceId: settings.ui_instance_id });
  if (!localState.ok) throw cliError(localState.error.code, localState.error.message);
  settings.local_toggle_state = settings.local_toggle_state === null ? null : localState.state;
  if (Buffer.byteLength(JSON.stringify(settings.local_toggle_state)) > 1024 * 1024) throw cliError('CLI_SETTINGS_INVALID', 'ローカル状態は 1 MiB 以下で指定してください。');
  return settings;
}

