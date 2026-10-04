import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingEditDiagnosticSummary22 } from '../../editor-core/src/ui/workspace-preview-feedback22.js';
test('詳細ログは128操作の位置と対象を記録し、入力文字列と原文を出さない', () => {
  const entry = { groupId: 1, operation: { type: 'set', path: 'ui/main.json', pointer: '/screen/controls/0/label',
    property: 'text', value: 'SECRET_TEXT', text: 'SECRET_SOURCE', sourceId: 'pack', delta: [3, 4], offset: [5, 6] },
    previewNodeIds: ['root/main/label'], previewSelection: { nodeId: 'root/main/label', fileId: 'preview', text: 'SECRET_SELECTION' } };
  const result = pendingEditDiagnosticSummary22({ pendingOperations: Array.from({ length: 130 }, () => entry) });
  assert.equal(result.operations.length, 16); assert.equal(result.operationDetails.length, 128); assert.equal(result.omittedOperationDetails, 2);
  assert.equal(result.operationDetails[0].pointer, '/screen/controls/0/label');
  assert.equal(result.operationDetails[0].property, 'text'); assert.deepEqual(result.operationDetails[0].offset, [5, 6]);
  assert(!JSON.stringify(result).includes('SECRET'));
});
test('長いpointerと大量表示対象は省略量を明記し、記録サイズを有限に保つ', () => {
  const result = pendingEditDiagnosticSummary22({ pendingOperations: [{ operation: { type: 'move', pointer: '/' + 'x'.repeat(1000), delta: [NaN, 2] },
    previewNodeIds: Array.from({ length: 2000 }, () => 'a'.repeat(200)) }] });
  const detail = result.operationDetails[0];
  assert.equal(detail.pointer.length, 512); assert.deepEqual(detail.truncatedLocationFields, ['pointer']);
  assert.equal(detail.previewNodeIds.length, 32); assert.equal(detail.omittedPreviewNodeIds, 1968); assert.equal(detail.truncatedPreviewNodeIds, 32);
  assert.equal(detail.delta, null); assert(JSON.stringify(result).length < 12000);
});
