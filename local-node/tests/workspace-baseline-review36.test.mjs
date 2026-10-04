import test from 'node:test';
import assert from 'node:assert/strict';
import { editWorkspace, inspectWorkspace, workspaceRevision, workspaceBaselineCacheStats36 } from '../workspace-edit.mjs';

const path = 'ui/a.json';
const model = { namespace: 'a', image: { type: 'image', size: [10, 20] }, root: { type: 'screen' } };
const encode = value => ({ [path]: JSON.stringify(value) });
const replace = texts => ({ type: 'replaceTexts', texts });
function prime(value = model, documentSources) {
  const documents = encode(value);
  const result = editWorkspace({ documents, documentSources, operation: replace(documents) });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
const metadata = id => ({ [path]: { sourceId: id, kind: 'imported', precedence: 20, physicalPath: path, active: true } });

test('返却diagnosticsを偽造しても保存済み旧診断へ新規不正を混入できない', () => {
  const first = prime();
  const invalid = encode({ ...model, image: { ...model.image, size: ['20', 30] } });
  const diagnostic = inspectWorkspace({ documents: invalid }).diagnostics.find(item => item.severity === 'error');
  first.diagnostics.push(diagnostic);
  const hits = workspaceBaselineCacheStats36().hits;
  const result = editWorkspace({ documents: first.documents, operation: replace(invalid) });
  assert.equal(workspaceBaselineCacheStats36().hits, hits + 1);
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_UI_STRUCTURE');
  assert.equal(result.documents, undefined);
});

test('返却診断とnodeを消しても正しい既存不正の複製証明は保持される', () => {
  const invalid = { ...model, image: { ...model.image, size: ['10', 20] } };
  const first = prime(invalid);
  first.diagnostics.length = 0; first.nodes.length = 0;
  const hits = workspaceBaselineCacheStats36().hits;
  const result = editWorkspace({ documents: first.documents,
    authoredCopies: [{ from: { path, pointer: '/image' }, to: { path, pointer: '/copy' } }],
    operation: replace(encode({ ...invalid, copy: invalid.image })) });
  assert.equal(workspaceBaselineCacheStats36().hits, hits + 1);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 2);
});

test('返却nodeの偽装を複製元の存在証明に流用できない', () => {
  const first = prime();
  first.nodes.push({ id: `${path}#/fake`, path, pointer: '/fake', isDefinition: true });
  const result = editWorkspace({ documents: first.documents,
    authoredCopies: [{ from: { path, pointer: '/fake' }, to: { path, pointer: '/copy' } }],
    operation: replace(encode({ ...model, copy: model.image })) });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_ELEMENT_NOT_FOUND');
});

test('同じdictionaryを書き換えた場合は全原文revision不一致で旧証明を使わない', () => {
  const first = prime();
  const changed = { ...model, image: { ...model.image, size: ['10', 20] } };
  first.documents[path] = JSON.stringify(changed);
  const hits = workspaceBaselineCacheStats36().hits;
  const result = editWorkspace({ documents: first.documents,
    operation: replace(encode({ ...changed, root: { type: 'screen', visible: true } })) });
  assert.equal(workspaceBaselineCacheStats36().hits, hits);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 1);
});

test('原文とrevisionが同じでもsourceIdだけの変更で旧層診断を使い回さない', () => {
  const first = prime(model, metadata('old-source'));
  assert.equal(workspaceRevision(first.documents, metadata('old-source')),
    workspaceRevision(first.documents, metadata('new-source')), '既存revisionは再importのUUIDを含まない');
  const hits = workspaceBaselineCacheStats36().hits;
  const result = editWorkspace({ documents: first.documents, documentSources: metadata('new-source'),
    operation: replace(first.documents) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(workspaceBaselineCacheStats36().hits, hits);
  assert(result.nodes.every(node => node.sourceId === 'new-source'));
});

test('cache命中でも変更後の構文検査を省略しない', () => {
  const first = prime(), hits = workspaceBaselineCacheStats36().hits;
  const result = editWorkspace({ documents: first.documents, operation: replace({ [path]: '{invalid' }) });
  assert.equal(workspaceBaselineCacheStats36().hits, hits + 1);
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_JSONC_SYNTAX');
});

test('cache済みdictionaryへのファイル増加でも全体上限を先に検査する', () => {
  const first = prime(), hits = workspaceBaselineCacheStats36().hits;
  for (let i = 0; i < 5000; i++) first.documents[`ui/extra${i}.json`] = '{}';
  const result = editWorkspace({ documents: first.documents, operation: replace({ [path]: JSON.stringify(model) }) });
  assert.equal(workspaceBaselineCacheStats36().hits, hits);
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_FILE_LIMIT');
});
