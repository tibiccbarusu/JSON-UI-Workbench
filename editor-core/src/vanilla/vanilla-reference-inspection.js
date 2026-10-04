import { parseJsonc } from '../json/jsonc.js';

/** @param {string[]} packPaths @param {string} desired */
function findVanillaReferencePath(packPaths, desired) {
  const expected = String(desired || '').toLowerCase();
  return (Array.isArray(packPaths) ? packPaths : []).find((path) => String(path || '').toLowerCase() === expected) || null;
}

/**
 * Parse the five critical reference documents needed for the readiness record.
 * Full pack bodies are neither persisted nor included in diagnostics.
 * @param {any} result
 */
export async function inspectVanillaReferenceCounts(result, { signal } = {}) {
  signal?.throwIfAborted();
  async function readJson(packPath) {
    const actual = findVanillaReferencePath(result.packPaths, packPath);
    if (!actual) return null;
    const text = await result.zipReader.readText(`${result.rootPrefix}${actual}`, { maxBytes: 8 * 1024 * 1024, signal });
    const parsed = parseJsonc(text, { fileName: packPath, allowTrailingComma: true });
    return parsed.ok ? parsed.value : null;
  }

  async function readText(packPath) {
    const actual = findVanillaReferencePath(result.packPaths, packPath);
    if (!actual) return null;
    return result.zipReader.readText(`${result.rootPrefix}${actual}`, { maxBytes: 8 * 1024 * 1024, signal });
  }

  const [uiDefs, globals, hudScreen, uiCommon, languageText] = await Promise.all([
    readJson('ui/_ui_defs.json'),
    readJson('ui/_global_variables.json'),
    readJson('ui/hud_screen.json'),
    readJson('ui/ui_common.json'),
    readText('texts/en_US.lang'),
  ]);
  signal?.throwIfAborted();
  const globalObject = globals && typeof globals === 'object' && !Array.isArray(globals)
    ? (globals.variables && typeof globals.variables === 'object' && !Array.isArray(globals.variables) ? globals.variables : globals)
    : null;
  return {
    uiDefsEntryCount: Array.isArray(uiDefs?.ui_defs) ? uiDefs.ui_defs.length : null,
    globalVariableCount: globalObject
      ? Object.keys(globalObject).filter((key) => key !== '$schema').length
      : null,
    hudScreenParsed: Boolean(hudScreen && typeof hudScreen === 'object' && !Array.isArray(hudScreen)),
    uiCommonParsed: Boolean(uiCommon && typeof uiCommon === 'object' && !Array.isArray(uiCommon)),
    languageEntryCount: typeof languageText === 'string'
      ? languageText.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#') && line.includes('=')).length
      : null,
  };
}

