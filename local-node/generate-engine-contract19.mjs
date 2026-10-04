/** Reproduce the pinned, syntactically conservative factory dependency contract.
 * Usage: node local-node/generate-engine-contract19.mjs <fixed-vanilla-directory> <new-output.mjs>
 * An existing output is never overwritten. No uploaded source is modified.
 */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { extractExportRootVariables } from '../editor-core/src/pack-io/export-dependencies.js';
import { ENGINE_FACTORY_SOURCE, canonicalUiDocument, engineDependencyFacts, engineFixedUiReferences } from './workspace-export-engine.mjs';

const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error('Fixed vanilla directory and new output path are required');
const root = resolve(directory), hash = value => createHash('sha256').update(canonicalUiDocument(value)).digest('hex');
const readText = path => readFile(join(root, path), 'utf8');
const documents = new Map();
async function document(path) {
  if (!documents.has(path)) {
    const parsed = parseJsonc(await readText(path)); assert(parsed.ok, path); documents.set(path, parsed.value);
  }
  return documents.get(path);
}
for (const [path, expected] of Object.entries(ENGINE_FACTORY_SOURCE.documents)) assert.equal(hash(await document(path)), expected, path);
const paths = (await readdir(root, { recursive: true, withFileTypes: true })).filter(row => row.isFile())
  .map(row => join(row.parentPath ?? row.path, row.name).slice(root.length + 1).replaceAll('\\', '/'));
const catalog = await buildUiCatalog({ parseJsonc, sources: [{ id: 'vanilla', kind: 'vanilla', filePaths: paths, readText }] });
const globals = await document('ui/_global_variables.json'), branches = {};
for (const rootName of ['storage_management_popup.storage_dependency_modal', 'storage_management_popup.sharing_popup_content']) {
  const names = new Set([rootName]), variables = new Set(), textureStems = new Set();
  const scan = (value, namespace) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\$[A-Za-z0-9_.-]{1,128}/gu)) variables.add(match[0]);
      if (value.startsWith('textures/')) textureStems.add(value.replace(/\.(?:png|tga|jpe?g)$/iu, ''));
      for (const reference of engineFixedUiReferences(value, namespace, catalog.symbols)) {
        if (catalog.symbols[reference]) names.add(reference);
      }
    } else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { scan(key, namespace); scan(child, namespace); }
  };
  let count = -1;
  while (count !== names.size + variables.size) {
    count = names.size + variables.size;
    assert(names.size <= 1000 && variables.size <= 2048, 'contract generation bounds');
    for (const name of names) {
      const record = catalog.recordsById[catalog.symbols[name].winnerId]; scan(record.rawKey, record.namespace); scan(record.value, record.namespace);
    }
    for (const name of variables) for (const [key, value] of Object.entries(globals)) if (key.split('|')[0] === name) scan(value, '');
  }
  const records = [...names].sort().map(name => {
    const record = catalog.recordsById[catalog.symbols[name].winnerId];
    return { qualifiedName: name, path: record.filePath, rawKey: record.rawKey, sha256: hash({ rawKey: record.rawKey, value: record.value }),
      facts: engineDependencyFacts(record.value),
      fixedUiReferences: engineFixedUiReferences({ [record.rawKey]: record.value }, record.namespace, catalog.symbols) };
  });
  const documentScopes = {};
  for (const path of new Set(records.map(record => record.path))) documentScopes[path] = hash(extractExportRootVariables(await document(path)));
  const globalVariables = Object.fromEntries([...variables].sort().map(name => [name,
    hash(Object.fromEntries(Object.entries(globals).filter(([key]) => key.split('|')[0] === name)))]));
  branches[rootName] = { records, documentScopes, globalVariables, textureStems: [...textureStems].sort() };
}
const common = await document('ui/ui_common.json');
const data = { schema: 'jsonui-engine-factory-contract/v1', commit: ENGINE_FACTORY_SOURCE.commit,
  canonicalization: ENGINE_FACTORY_SOURCE.canonicalization,
  factorySha256: hash(common.screen_panel.controls.find(control => control.popup_dialog_factory).popup_dialog_factory), branches };
await writeFile(resolve(output), '/** Generated from pinned Mojang syntactic dependency supersets; see revision19 evidence. */\nexport const ENGINE_FACTORY_CONTRACT = Object.freeze(' + JSON.stringify(data, null, 2) + ');\n', { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(output), branches: Object.fromEntries(Object.entries(branches).map(([name, branch]) => [name,
  { definitions: branch.records.length, variables: Object.keys(branch.globalVariables).length, scopes: Object.keys(branch.documentScopes).length }])), sha256: hash(data) }));
