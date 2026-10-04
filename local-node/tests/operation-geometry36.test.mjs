import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWorkspaceOperation } from '../workspace-operation-summary.mjs';

const summary = operation => summarizeWorkspaceOperation({ operation }).operations[0];
test('サイズ変更ログは固定寸法だけ複製し、数値・単位を保持する', () => {
  for (const value of [[64, 32], ['96%', '12px'], ['1e2', '-0.5']]) {
    const result = summary({ type: 'set', property: 'size', value });
    assert.deepEqual(result.geometryValue, value);
    assert.notEqual(result.geometryValue, value);
  }
});
test('寸法以外・任意の式・過大値・不正形状をログへ出さない', () => {
  for (const value of [['$private_token', '100%'], ['(secret)', 4], ['10px + secret', 4],
    [Infinity, 2], ['1e999', 4], [1, 2, 3], 'private text', [null, 4]]) {
    assert.equal(summary({ type: 'set', property: 'size', value }).geometryValue, null);
  }
  for (const property of ['text', 'texture', 'password', undefined]) {
    assert.equal(summary({ type: 'set', property, value: [1, 2] }).geometryValue, null);
  }
  assert.equal(summary({ type: 'add', property: 'size', value: [1, 2] }).geometryValue, null);
});
