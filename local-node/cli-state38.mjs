/** Independent typed-state entry for the CLI; the browser owns the shared validator. */
import { createHash } from 'node:crypto';
import { normalizePreviewState } from '../editor-core/src/engine/preview-state.js';
import { cliError } from './cli-files.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const RUNTIME_KEYS = ['mock_data', 'collections', 'variables', 'scroll', 'event_factory_selections', 'local_toggle_state'];

export function prepareTypedCliState(text, settings, replaceState = false) {
  // Parse/normalize before inspecting collisions, so GUI validation codes survive unchanged.
  const normalized = normalizePreviewState(text);
  const occupied = RUNTIME_KEYS.filter(key => Object.keys(settings[key] || {}).length > 0);
  if (occupied.length && !replaceState) throw cliError('CLI_STATE_REPLACEMENT_REQUIRED',
    '既存の実行時状態があります。置換する場合は --replace-state を指定してください。', { settings: occupied });
  const next = { ...settings, mock_data: normalized.mockData, collections: normalized.collectionData,
    variables: {}, scroll: {}, local_toggle_state: null, event_factory_selections: normalized.eventFactorySelections || {},
    ...(normalized.fontProfile ? { font_profile: normalized.fontProfile } : {}) };
  const evidence = { schema: 'jsonui-cli-state-evidence-v1', input_sha256: sha256(text),
    normalized_sha256: sha256(JSON.stringify(normalized)), recommended_definition: normalized.recommendedDefinition,
    diagnostics: normalized.diagnostics, replaces: occupied,
    normalization: 'shared normalizePreviewState; 1 MiB, depth 24, 256 rows per collection' };
  return { settings: next, evidence };
}

export function settingsChangeInvalidatesState(input) {
  return [...RUNTIME_KEYS, 'font_profile', 'ui_instance_id'].some(key => Object.hasOwn(input, key));
}
