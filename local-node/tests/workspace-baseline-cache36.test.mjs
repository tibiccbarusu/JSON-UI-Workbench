import test from 'node:test';
import assert from 'node:assert/strict';
import { editWorkspace, workspaceRevision, workspaceBaselineCacheStats36 } from '../workspace-edit.mjs';

const path = 'ui/a.json';
const encode = value => ({ [path]: JSON.stringify(value) });
const original = { namespace: 'a', source: { type: 'image', size: ['10', 20], offset: [0, 0] }, root: { type: 'screen' } };
const proof = { from: { path, pointer: '/source' }, to: { path, pointer: '/copy' } };
function owned(documentSources) {
  const result = editWorkspace({ documents: encode(original), documentSources,
    operation: { type: 'set', path, pointer: '/source/offset', value: [1, 2] } });
  assert.equal(result.ok, true, JSON.stringify(result)); return result;
}
function replace(documents, value, extra = {}) {
  return editWorkspace({ documents, expectedRevision: workspaceRevision(documents, extra.documentSources),
    operation: { type: 'replaceTexts', texts: encode(value) }, ...extra });
}
function state(documents) { return JSON.parse(documents[path]); }
function copied(documents) { const value = state(documents); return { ...value, copy: value.source }; }

test('R36: private baseline cache and independent dictionary produce identical full outputs', () => {
  const first = owned(), body = copied(first.documents), before = workspaceBaselineCacheStats36();
  const cached = replace(first.documents, body, { authoredCopies: [proof] });
  const middle = workspaceBaselineCacheStats36();
  const fresh = replace({ ...first.documents }, body, { authoredCopies: [proof] });
  const end = workspaceBaselineCacheStats36();
  assert.equal(cached.ok, true); assert.deepEqual(cached, fresh);
  assert.equal(middle.hits, before.hits + 1); assert.equal(end.hits, middle.hits);
  assert.equal(end.misses, middle.misses + 1);
});

test('R36: mutating returned diagnostics cannot forge old error fingerprints', () => {
  const first = owned();
  first.diagnostics.length = 0;
  const value = copied(first.documents); value.copy = { ...value.copy, size: ['999', 20] };
  const result = replace(first.documents, value, { authoredCopies: [proof] });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_UI_STRUCTURE');
  const unchanged = replace(first.documents, copied(first.documents), { authoredCopies: [proof] });
  assert.equal(unchanged.ok, true, JSON.stringify(unchanged));
});

test('R36: returned nodes cannot forge the existence of an authored copy source', () => {
  const first = owned(); first.nodes[0].pointer = '/invented'; first.nodes[0].id = path + '#/invented';
  const result = replace(first.documents, copied(first.documents), { authoredCopies: [{ ...proof, from: { path, pointer: '/invented' } }] });
  assert.equal(result.code, 'EDIT_ELEMENT_NOT_FOUND'); assert.equal(result.documents, undefined);
});

test('R36: changing text on the same dictionary invalidates the full-revision proof', () => {
  const first = owned(); const value = state(first.documents); delete value.source;
  first.documents[path] = JSON.stringify(value);
  const before = workspaceBaselineCacheStats36();
  const result = replace(first.documents, { ...value, copy: original.source }, { authoredCopies: [proof] });
  const after = workspaceBaselineCacheStats36();
  assert.equal(result.code, 'EDIT_ELEMENT_NOT_FOUND');
  assert.equal(after.hits, before.hits); assert.equal(after.misses, before.misses + 1);
});

test('R36: exact source ID metadata is checked even when stable revision intentionally omits it', () => {
  const documentSources = { [path]: { sourceId: 'first', kind: 'imported', precedence: 20, physicalPath: path, active: true } };
  const first = owned(documentSources), beforeRevision = workspaceRevision(first.documents, documentSources);
  documentSources[path].sourceId = 'second';
  assert.equal(workspaceRevision(first.documents, documentSources), beforeRevision);
  const before = workspaceBaselineCacheStats36();
  const result = replace(first.documents, copied(first.documents), { authoredCopies: [proof], documentSources });
  const after = workspaceBaselineCacheStats36();
  assert.equal(result.ok, true); assert(result.nodes.every(node => node.sourceId === 'second'));
  assert.equal(after.hits, before.hits); assert.equal(after.misses, before.misses + 1);
});

for (const kind of ['non-enumerable', 'symbol', 'getter']) test(`R36: ${kind} dictionary property bypasses compact proof`, () => {
  const first = owned(), beforeRevision = workspaceRevision(first.documents);
  if (kind === 'non-enumerable') Object.defineProperty(first.documents, 'hidden', { value: 'ignored', enumerable: false });
  if (kind === 'symbol') first.documents[Symbol('baseline-proof')] = true;
  if (kind === 'getter') { const text = first.documents[path]; Object.defineProperty(first.documents, path, { enumerable: true, configurable: true, get: () => text }); }
  assert.equal(workspaceRevision(first.documents), beforeRevision);
  const before = workspaceBaselineCacheStats36();
  const result = replace(first.documents, copied(first.documents), { authoredCopies: [proof] });
  const after = workspaceBaselineCacheStats36();
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(after.hits, before.hits);
  assert(after.bypasses > before.bypasses);
});

test('R36: raw edit uses complete inspection; next baseline belongs to its newly validated revision', () => {
  const first = owned(), before = workspaceBaselineCacheStats36();
  const raw = editWorkspace({ documents: first.documents, expectedRevision: first.revision,
    operation: { type: 'delete', path, pointer: '/source', cascade: true } });
  assert.equal(raw.ok, true); assert.equal(workspaceBaselineCacheStats36().hits, before.hits);
  const result = replace(raw.documents, { ...state(raw.documents), copy: original.source }, { authoredCopies: [proof] });
  assert.equal(result.code, 'EDIT_ELEMENT_NOT_FOUND'); assert.equal(result.documents, undefined);
});

test('R36: JSON-named proof fields and cloned external dictionaries cannot claim a cache entry', () => {
  const first = owned(), documents = JSON.parse(JSON.stringify(first.documents));
  const before = workspaceBaselineCacheStats36();
  const result = editWorkspace({ documents, expectedRevision: workspaceRevision(documents),
    baselineProofs36: true, cachedBaseline: { diagnostics: [], nodeIds: [path + '#/source'] }, authoredCopies: [proof],
    operation: { type: 'replaceTexts', texts: encode(copied(documents)) } });
  assert.equal(result.ok, true); assert.equal(workspaceBaselineCacheStats36().hits, before.hits);
});


test('R36: equal UTF-8 hashes of lone surrogates cannot reuse old diagnostic fingerprints', () => {
  const make = text => ({ type: 'image', size: [text, 20, 30], offset: [1, 1] });
  const documents = { [path]: JSON.stringify({ namespace: 'a', source: make('X') }).replace('X', String.fromCharCode(0xd800)) };
  const first = editWorkspace({ documents, operation: { type: 'set', path, pointer: '/source/offset', value: [1, 1] } });
  assert.equal(first.ok, true);
  first.documents[path] = first.documents[path].replace(String.fromCharCode(0xd800), String.fromCharCode(0xd801));
  assert.equal(workspaceRevision(first.documents), first.revision, 'UTF-8 revision alone is deliberately shown insufficient');
  const before = workspaceBaselineCacheStats36();
  const value = { namespace: 'a', source: make(String.fromCharCode(0xd800)), copy: make(String.fromCharCode(0xd800)) };
  const cached = replace(first.documents, value, { authoredCopies: [proof] });
  const fresh = replace({ ...first.documents }, value, { authoredCopies: [proof] });
  assert.equal(cached.ok, false); assert.equal(cached.code, 'EDIT_UI_STRUCTURE');
  assert.deepEqual(cached, fresh); assert.equal(workspaceBaselineCacheStats36().hits, before.hits);
});

test('R36: UTF-8-colliding entry keys cannot claim the original source nodes', () => {
  const oldPath = 'ui/' + String.fromCharCode(0xd800) + '.json';
  const newPath = 'ui/' + String.fromCharCode(0xd801) + '.json';
  const documents = { [oldPath]: JSON.stringify(original) };
  const first = editWorkspace({ documents, operation: { type: 'set', path: oldPath, pointer: '/source/offset', value: [1, 2] } });
  assert.equal(first.ok, true);
  first.documents[newPath] = first.documents[oldPath]; delete first.documents[oldPath];
  assert.equal(workspaceRevision(first.documents), first.revision);
  const value = JSON.parse(first.documents[newPath]); value.copy = value.source;
  const before = workspaceBaselineCacheStats36();
  const result = editWorkspace({ documents: first.documents, operation: { type: 'replaceTexts', texts: { [newPath]: JSON.stringify(value) } },
    authoredCopies: [{ from: { path: oldPath, pointer: '/source' }, to: { path: newPath, pointer: '/copy' } }] });
  assert.equal(result.code, 'EDIT_ELEMENT_NOT_FOUND'); assert.equal(workspaceBaselineCacheStats36().hits, before.hits);
});

for (const label of ['plain ASCII', '日本語と絵文字 🌸']) test(`R36: exact ordinary Unicode text still hits and preserves complete output: ${label}`, () => {
  const documents = encode({ ...original, root: { type: 'screen', text: label } });
  const first = editWorkspace({ documents, operation: { type: 'set', path, pointer: '/source/offset', value: [1, 2] } });
  assert.equal(first.ok, true);
  const before = workspaceBaselineCacheStats36();
  const cached = replace(first.documents, copied(first.documents), { authoredCopies: [proof] });
  assert.equal(workspaceBaselineCacheStats36().hits, before.hits + 1);
  const fresh = replace({ ...first.documents }, copied(first.documents), { authoredCopies: [proof] });
  assert.equal(cached.ok, true); assert.deepEqual(cached, fresh);
});
