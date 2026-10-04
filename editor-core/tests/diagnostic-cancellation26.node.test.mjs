import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticsStore } from '../src/diagnostics/diagnostics-store.js';
import { createSiteDiagnosticSession } from '../src/diagnostics/site-diagnostic-session.js';

test('取消分類は操作・例外の両境界で失敗件数から分離し相関を保持する', () => {
  const store = createDiagnosticsStore();
  const session = createSiteDiagnosticSession({ diagnosticsStore: store });
  session.start();
  session.recordOperation('commit', 'failure', 'NODE_JOB_CANCELLED', {
    correlation_id: 'operation-26', queue_wait_ms: 127, work_ms: 432, retryable: false,
  });
  store.captureError(Object.assign(new Error('Node作業の取消'), {
    code: 'NODE_JOB_CANCELLED', category: 'cancelled', correlation_id: 'request-26', retryable: false,
  }), { source: 'workspace-edit' });
  const { snapshot } = session.stop();
  assert.equal(snapshot.summary.errorCount, 0);
  assert.equal(snapshot.summary.cancelledCount, 2);
  const operation = snapshot.events.find(item => item.operation === 'commit');
  assert.equal(operation.phase, 'cancelled');
  assert.equal(operation.level, 'info');
  assert.deepEqual(operation.details, { correlation_id: 'operation-26', queue_wait_ms: 127, retryable: false, work_ms: 432 });
  const error = snapshot.events.find(item => item.resultCode === 'APP_OPERATION_CANCELLED');
  assert.equal(error.operation, 'edit');
  assert.equal(error.details.error.correlation_id, 'request-26');
  assert.equal(error.details.error.retryable, false);
  session.dispose();
});

test('timeout・未分類AbortError・取消を含む表示文は取消に読み替えない', () => {
  const session = createSiteDiagnosticSession(); session.start();
  for (const error of [
    { code: 'NODE_JOB_CANCELLED', category: 'timeout', message: '期限' },
    new DOMException('aborted', 'AbortError'),
    new Error('NODE_JOB_CANCELLED と同じ表示文でも実際は別エラー'),
  ]) session.captureDiagnosticEntry({ source: 'preview', level: 'error', error });
  const { snapshot } = session.stop();
  assert.equal(snapshot.summary.errorCount, 3);
  assert.equal(snapshot.summary.cancelledCount, 0);
  session.dispose();
});

test('新セッション開始で取消集計を初期化し有限の既存byte予算を守る', () => {
  const session = createSiteDiagnosticSession({ maxBytes: 16384 }); session.start();
  for (let i = 0; i < 200; i++) session.recordOperation('preview', 'cancelled', 'USER_CANCEL', { correlation_id: 'r'.repeat(500) });
  const stopped = session.stop();
  assert.equal(stopped.snapshot.summary.cancelledCount, 200);
  assert.ok(new TextEncoder().encode(session.toJson()).length <= 16384);
  assert.ok(stopped.snapshot.summary.droppedEventCount > 0);
  session.start();
  assert.equal(session.stop().snapshot.summary.cancelledCount, 0);
  session.dispose();
});
