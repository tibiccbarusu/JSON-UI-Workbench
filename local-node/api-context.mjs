/** Private persistent-stack adapter consumed by the shared CLI/SDK preview pipeline. */
import { cliError } from './cli-files.mjs';
import { checkedSettings, finiteNumber } from './preview-settings.mjs';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { activeClassicUiScale, logicalCanvasPreset, inferPackUiScaleFromBuildInfo } from '../editor-core/src/preview/preview-viewport16.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';

export function assertApiResult(result, fallback = 'CLI_OPERATION_FAILED') {
  if (!result || typeof result !== 'object' || result.ok === false) {
    const code = typeof result?.error === 'string' ? result.error : result?.error?.code || fallback;
    throw cliError(/^[A-Z0-9_]{1,63}$/u.test(code) ? code : fallback, '要求された操作を完了できません。', { result });
  }
  return result;
}
export async function stackCatalog(client, stack) {
  if (!stack.workspace) stack.workspace = assertApiResult(await client.request('/api/node/workspace-open', { payload: { sources: stack.sources } }));
  if (!stack.catalog) stack.catalog = assertApiResult(await client.request('/api/node/workspace-catalog', { payload: { workspaceId: stack.workspace.workspaceId } }));
  return stack.catalog;
}
function selectRecord(catalog, options) {
  let records = (catalog.records || []).filter(record => !options.file || record.filePath === options.file);
  if (options.kind) records = records.filter(record => record.sourceKind === options.kind);
  if (options.definition) records = records.filter(record => [record.id, record.rawKey, record.localName, record.qualifiedName].includes(options.definition));
  if (!options.kind) records = records.filter(record => !records.some(other => other.filePath === record.filePath && other.qualifiedName === record.qualifiedName && other.precedence > record.precedence));
  if (records.length !== 1) throw cliError(records.length ? 'CLI_DEFINITION_AMBIGUOUS' : 'UI_DEFINITION_NOT_FOUND', records.length ? 'UIの候補が複数あります。fileとdefinitionを指定してください。' : '指定されたUI定義が見つかりません。',
    { candidates: records.slice(0, 30).map(({ filePath, rawKey, qualifiedName, sourceKind }) => ({ file_path: filePath, raw_key: rawKey, qualified_name: qualifiedName, source_kind: sourceKind })), candidate_count: records.length });
  return records[0];
}

export class ApiPreviewContext {
  constructor(client, stack, settings, evidence, language) {
    this.client = client; this.stack = stack; this.session = { settings, preview_state: evidence };
    this.language = language; this.importedPackMetadata = stack.importedMetadata;
    this.workspace = stack.workspace;
  }
  async getCatalog() { const catalog = await stackCatalog(this.client, this.stack); this.workspace = this.stack.workspace; return catalog; }
  async project(options) {
    const catalog = await stackCatalog(this.client, this.stack); this.workspace = this.stack.workspace;
    const record = selectRecord(catalog, options), savedSettings = checkedSettings(this.session.settings);
    const settings = { ...savedSettings, collections: {
      ...(savedSettings.mock_data.__collections && typeof savedSettings.mock_data.__collections === 'object' && !Array.isArray(savedSettings.mock_data.__collections) ? savedSettings.mock_data.__collections : {}),
      ...savedSettings.collections,
    } };
    const projection = assertApiResult(await this.client.request('/api/node/project', { payload: {
      catalogId: catalog.nodeCatalogId, recordId: record.id,
      variables: buildRepresentativeClassicResolverVariables({ qualifiedName: record.qualifiedName, userVariables: { ...settings.mock_data, ...settings.variables } }),
      representativeCollections: buildRepresentativeClassicCollections({ qualifiedName: record.qualifiedName, collectionData: settings.collections }),
      eventFactorySelections: settings.event_factory_selections,
    } }), 'CLI_PROJECTION_INVALID');
    return { record, projection, settings };
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
      try {
        const text = (await this.client.request(`/api/node/packs/${pack.id}/read?path=${encodeURIComponent(`${pack.rootPrefix || ''}${buildInfoPath}`)}&maxBytes=${2 * 1024 * 1024}`, { method: 'GET', binary: true, maximum: 2 * 1024 * 1024 })).toString('utf8');
        const parsed = parseJsonc(text, { filePath: buildInfoPath, allowTrailingComma: true });
        if (parsed.ok) { observedUiScale = inferPackUiScaleFromBuildInfo(parsed.value); scaleSource = buildInfoPath; }
      } catch { /* Same optional authored-calibration fallback as the CLI. */ }
    }
    const uiScale = activeClassicUiScale({ observedUiScale });
    return { uiScale, scaleSource, preset: logicalCanvasPreset({ width, height }, uiScale) };
  }
}

/** Structured SDK requests are translated into the pipeline's internal option contract, never argv. */
export function pipelineOptions(request) {
  const output = {};
  for (const key of ['file', 'definition', 'kind', 'width', 'height', 'frame', 'fps']) if (request[key] !== undefined) output[key] = request[key];
  for (const [from, to] of [['uiScale', 'ui-scale'], ['allowPartial', 'allow-partial'], ['strictSemantics', 'strict-semantics'],
    ['strictAnimation', 'strict-animation'], ['drawEvidence', 'draw-evidence'], ['frameSummary', 'frame-summary']]) if (request[from] !== undefined) output[to] = request[from];
  return output;
}
