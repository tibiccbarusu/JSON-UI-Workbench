/** Display-language boundary; never changes machine keys, codes, source, or IR. */
import { CONSOLE_MESSAGES } from './console-messages14.mjs';
import { translateSiteMessage } from '../editor-core/src/i18n/site-messages.js';

const ENGLISH_MESSAGES = new Map(Object.entries(CONSOLE_MESSAGES).map(([ja, en]) => [en, ja]));
const CODES = Object.freeze({
  EDIT_PATH_INVALID: 'Specify a safe relative JSON path within the workspace.',
  EDIT_DOCUMENTS_INVALID: 'documents must map relative paths to JSONC source strings.',
  EDIT_FILE_LIMIT: 'The number of editable files exceeds the limit.',
  EDIT_PATH_AMBIGUOUS: 'Files whose names differ only in letter case cannot be edited.',
  EDIT_TEXT_INVALID: 'The JSONC source must be a string.',
  EDIT_WORKSPACE_LIMIT: 'The total editable source exceeds the size limit.',
  EDIT_INTERNAL_ERROR: 'An unexpected error occurred while editing the source.',
  EDIT_DIAGNOSTIC_LIMIT: 'The diagnostic limit was reached. Narrow the target and validate again.',
  EDIT_UI_STRUCTURE: 'The JSON UI structure is invalid. Check the diagnostic path and required value type.',
  EDIT_ELEMENT_LIMIT: 'The UI element count exceeds the limit.',
  EDIT_UI_NAME_INVALID: 'The UI element name or inheritance reference is invalid.',
  EDIT_FACTORY_REFERENCE_LIMIT: 'The number of factory reference candidates exceeds the limit.',
  EDIT_ELEMENT_NOT_FOUND: 'There is no editable UI element at the specified path.',
  EDIT_DELETE_IMPACT_UNKNOWN: 'Dynamic or ambiguous references prevent a complete deletion plan. Nothing was deleted.',
  EDIT_DOCUMENT_NOT_FOUND: 'The specified document is not in the workspace.',
  EDIT_OFFSET_INVALID: 'Specify two finite numbers for the element offset.',
  EDIT_INHERITANCE_INVALID: 'Specify a fixed definition name as the base, or null to remove inheritance.',
  EDIT_ADD_INVALID: 'Specify a valid element name and definition object.',
  EDIT_NAME_CONFLICT: 'An element with this name already exists in the same scope.',
  EDIT_DYNAMIC_CONTROLS: 'An element cannot be added without overwriting dynamic controls.',
  EDIT_OPERATION_INVALID: 'Specify a supported editing operation and its type.',
  EDIT_REVISION_CONFLICT: 'The workspace changed after the source was read. Retrieve the latest source.',
  EDIT_CASCADE_REQUIRED: 'Deleting dependent elements requires cascade: true.',
  EDIT_REGISTRY_READ_ONLY: 'UI registration files are read-only.',
  EDIT_VALIDATION_FAILED: 'The edit introduces invalid UI structure or a reference cycle. It was not applied.',
  UI_DEFINITION_NOT_FOUND: 'The specified UI definition was not found.',
  UI_POCKET_PREVIEW_UNSUPPORTED: 'Pocket UI can be read and edited, but cannot be previewed.',
  POCKET_PREVIEW_DISABLED: 'Pocket UI preview is disabled.',
  CLI_LANGUAGE_INVALID: 'Display language must be ja or en.',
});

export function normalizeLanguage(value, fallback = 'ja') {
  return value === 'ja' || value === 'en' ? value : fallback;
}

export function consoleText(message, language = 'ja', code = '') {
  if (typeof message !== 'string') return message;
  if (language !== 'en') return ENGLISH_MESSAGES.get(message) || translateSiteMessage(message, 'ja_JP');
  if (Object.hasOwn(CONSOLE_MESSAGES, message)) return CONSOLE_MESSAGES[message];
  const translated = translateSiteMessage(message, 'en_US');
  if (translated !== message) return translated;
  if (Object.hasOwn(CODES, code)) return CODES[code];
  return message;
}

/** Resolve language without changing process.env (runCli is import-safe). */
export function resolveLanguage(explicit, environment, saved) {
  const value = explicit ?? (environment || undefined) ?? saved ?? 'ja';
  if (!['ja', 'en'].includes(value)) {
    throw Object.assign(new Error('表示言語は ja または en を指定してください。'), {
      code: 'CLI_LANGUAGE_INVALID', category: 'validation', context: { supported: ['ja', 'en'] },
    });
  }
  return value;
}

/** Error formatting must still work if parsing failed before language validation. */
export function languageHint(argv = [], environment = process.env.JSONUI_LANGUAGE) {
  let value;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--language') { value = argv[index + 1]; break; }
    if (argv[index].startsWith('--language=')) { value = argv[index].slice(11); break; }
  }
  return normalizeLanguage(value, normalizeLanguage(environment));
}

// Walk only API envelope fields. Catalog items, UI nodes/props, authored JSON,
// frame layout, arbitrary context data, and metadata remain opaque by default.
const ENVELOPE_FIELDS = new Set(['result', 'results', 'validation', 'frame', 'animation',
  'live', 'plan', 'context', 'workflow', 'completed', 'stage_diagnostics', 'projection']);
const DIAGNOSTIC_CONTAINERS = new Set(['diagnostics', 'errors', 'warnings', 'issues', 'details']);
const HUMAN_FIELDS = new Set(['message', 'reason', 'summary', 'suggestion', 'hint']);
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u;

/** Localize diagnostic envelopes only, keeping unknown originals as evidence. */
export function localizeConsoleResult(value, language = 'ja', diagnostic = false, depth = 0) {
  if (depth > 64 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => localizeConsoleResult(item, language, diagnostic, depth + 1));
  const code = typeof value.code === 'string' ? value.code : typeof value.error === 'string' ? value.error : '';
  const isDiagnostic = diagnostic;
  const translated = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (isDiagnostic && HUMAN_FIELDS.has(key) && typeof item === 'string') {
      // A field-violation reason is often a machine code. Code-based prose
      // fallback belongs only to message; other fields use exact text lookup.
      const result = consoleText(item, language, key === 'message' ? code : '');
      if (language === 'en' && japanese.test(result)) {
        translated[key] = code ? `Diagnostic ${code}: ${code.toLowerCase().replaceAll('_', ' ')}. See structured details.` : 'A diagnostic was reported. See structured details.';
        translated[`original_${key}`] = item;
      } else translated[key] = result;
    } else if (key === 'error' || DIAGNOSTIC_CONTAINERS.has(key)) translated[key] = localizeConsoleResult(item, language, true, depth + 1);
    else if (ENVELOPE_FIELDS.has(key)) translated[key] = localizeConsoleResult(item, language, false, depth + 1);
    else translated[key] = item;
  }
  return { ...translated };
}
