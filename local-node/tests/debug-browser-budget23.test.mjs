import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewDebugRequest23, PREVIEW_DEBUG_BUDGET23 } from '../../editor-core/src/diagnostics/preview-debug-request23.js';
import { validateDebugRequest } from '../debug-bundle.mjs';

test('日本語・制御文字の大きな状態でも直近診断を残し、UTF-8/構造の実サーバー上限内へ収める', () => {
  const rows = Array.from({ length: 700 }, (_, index) => ({ id: index, source: 'workspace-draft',
    message: '変更の計算を確認しました。\u0001'.repeat(300), data: { offset: [index, -index],
      points: Array.from({ length: 100 }, () => [1, 2, 3, 4]) } }));
  const state = { context: { selectedUi: { filePath: 'ui/金床.json' }, workspace: { revision: 'r1',
    pending: { operationDetails: [{ type: 'move', delta: [2, 3] }] } },
    warnings: Array.from({ length: 300 }, () => '日本語\u0001'.repeat(2000)) },
    text: 'PRIVATE_SOURCE_SENTINEL', token: 'TOKEN_SENTINEL', iconPngBase64: 'IMAGE_SENTINEL' };
  const payload = createPreviewDebugRequest23({ browser: { language: 'ja-JP' },
    selection: { filePath: 'ui/金床.json' }, state, diagnostics: rows,
    events: Array.from({ length: 200 }, (_, index) => ({ type: 'editor/move', index })) });
  const serialized = JSON.stringify(payload);
  assert(Buffer.byteLength(serialized) <= PREVIEW_DEBUG_BUDGET23.total);
  assert.equal(payload.diagnostics.at(-1).id, 699);
  assert.equal(payload.events.at(-1).index, 199);
  assert.equal(payload.state.context.selectedUi.filePath, 'ui/金床.json');
  assert.deepEqual(payload.state.context.workspace.pending.operationDetails[0].delta, [2, 3]);
  assert.equal(payload.state.capture.diagnostics.omitted, 700 - payload.diagnostics.length);
  assert(payload.state.capture.diagnostics.omitted > 0);
  for (const secret of ['PRIVATE_SOURCE_SENTINEL', 'TOKEN_SENTINEL', 'IMAGE_SENTINEL']) assert(!serialized.includes(secret));
  const checked = validateDebugRequest(payload);
  assert(checked.summary.nodes <= 50000);
  assert.equal(checked.data.diagnostics.at(-1).id, 699);
});

test('通常の詳細ログ500件を時系列で保持し、capture情報は状態に同名キーがあっても破壊されない', () => {
  const diagnostics = Array.from({ length: 500 }, (_, id) => ({ id, code: 'DRAFT_READY', offset: [id, 3] }));
  const payload = createPreviewDebugRequest23({ state: { capture: 'old' }, diagnostics });
  assert.equal(payload.diagnostics.length, 500);
  assert.equal(payload.diagnostics[0].id, 0); assert.equal(payload.diagnostics.at(-1).id, 499);
  assert.equal(payload.state.capture.diagnostics.omitted, 0);
  assert.equal(payload.state.capture.schema, 'jsonui-debug-capture-v23');
  assert.equal(validateDebugRequest(payload).summary.truncated, false);
});
