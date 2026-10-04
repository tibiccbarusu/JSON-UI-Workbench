import test from 'node:test';
import assert from 'node:assert/strict';
import { editWorkspace, workspaceRevision } from '../workspace-edit.mjs';

const path = 'ui/a.json';
const encoded = value => ({ [path]: JSON.stringify(value) });
const original = { namespace: 'a', source: { type: 'image', size: ['10', 20] },
  root: { type: 'screen', controls: [{ child: { type: 'label', text: '保持' } }] } };
const copy = { from: { path, pointer: '/source' }, to: { path, pointer: '/copy' } };

for (const type of ['replaceText', 'replaceTexts']) {
  test(`旧ASTを破棄しても ${type} による構文修復を許可する`, () => {
    const documents = { [path]: '{"namespace":"a","root":' };
    const text = JSON.stringify({ namespace: 'a', root: { type: 'screen' } });
    const result = editWorkspace({ documents, expectedRevision: workspaceRevision(documents),
      operation: type === 'replaceText' ? { type, path, text } : { type, texts: { [path]: text } } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.documents[path], text); assert.equal(result.nodes[0].pointer, '/root');
    assert.equal(documents[path], '{"namespace":"a","root":');
  });
}

test('旧診断だけを保持しても原文複製された既存の不正寸法を新規問題と誤判定しない', () => {
  const documents = encoded(original), text = encoded({ ...original, copy: original.source })[path];
  const result = editWorkspace({ documents, expectedRevision: workspaceRevision(documents), authoredCopies: [copy],
    operation: { type: 'replaceTexts', texts: { [path]: text } } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.diagnostics.filter(item => item.code === 'EDIT_UI_PROPERTY_INVALID').length, 2);
  assert.equal(result.nodes.find(node => node.pointer === '/copy').props.size[0], '10');
});

test('複製元ASTを解放しても複製先で増やした不正値は拒否する', () => {
  const documents = encoded(original), before = JSON.stringify(documents);
  const text = encoded({ ...original, copy: { ...original.source, size: ['20', 20] } })[path];
  const result = editWorkspace({ documents, authoredCopies: [copy],
    operation: { type: 'replaceTexts', texts: { [path]: text } } });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_UI_STRUCTURE');
  assert.equal(result.documents, undefined); assert.equal(JSON.stringify(documents), before);
});

for (const missing of ['from', 'to']) test(`原文複製の ${missing} が欠ける場合は存在証明を認めない`, () => {
  const documents = encoded(original), proof = structuredClone(copy);
  proof[missing].pointer = '/missing';
  const result = editWorkspace({ documents, authoredCopies: [proof],
    operation: { type: 'replaceTexts', texts: encoded({ ...original, copy: original.source }) } });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_ELEMENT_NOT_FOUND');
  assert.equal(result.documents, undefined);
});

test('削除範囲と診断の返却に旧AST内部のnodeやscopeを公開しない', () => {
  const documents = encoded(original);
  const result = editWorkspace({ documents, operation: { type: 'delete', path, pointer: '/root', cascade: true } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.deletePlan.count, 2);
  assert.deepEqual(result.deletePlan.removals.map(node => node.pointer), ['/root']);
  for (const node of [result.deletePlan.root, ...result.deletePlan.affected, ...result.nodes]) {
    for (const key of ['value', 'variables', 'childIds', 'inheritedIds']) assert.equal(Object.hasOwn(node, key), false);
  }
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(JSON.parse(result.documents[path]).root, undefined);
});
