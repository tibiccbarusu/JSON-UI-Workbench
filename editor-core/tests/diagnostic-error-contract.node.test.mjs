import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticsStore } from '../src/diagnostics/diagnostics-store.js';
import { sanitizeDiagnosticEntry, buildDiagnosticsSnapshot, formatDiagnosticsText } from '../src/diagnostics/log-export.js';
import { createSiteDiagnosticSession, normalizeDiagnosticError, redactDiagnosticValue } from '../src/diagnostics/site-diagnostic-session.js';

const fields = { code: 'EDIT_SCOPE_CHANGED', category: 'conflict', retryable: false, correlation_id: 'operation-42' };
const classified = (extra = {}) => Object.assign(new Error('操作範囲が変わりました'), fields, extra);
const pickFields = value => Object.fromEntries(Object.keys(fields).map(key => [key, value[key]]));

test('capture→store→JSON export→site session の全境界で分類を保持する', () => {
  const store = createDiagnosticsStore();
  const session = createSiteDiagnosticSession({ diagnosticsStore: store });
  session.start();
  store.captureError(classified(), { source: 'workspace-edit' });
  const entry = store.getEntries()[0];
  assert.deepEqual(pickFields(entry.error), fields);
  assert.match(entry.error.stack, /操作範囲が変わりました/);
  const snapshot = store.exportSnapshot();
  assert.deepEqual(pickFields(snapshot.entries[0].error), fields);
  session.stop();
  const event = session.snapshot().events.find(item => item.details?.error?.code === fields.code);
  assert.ok(event);
  assert.deepEqual(pickFields(event.details.error), fields);
  session.dispose();
});

test('Error-like の明示値のみ保持し retryable を推測・文字列変換しない', () => {
  assert.deepEqual(pickFields(sanitizeDiagnosticEntry({ error: { ...fields, message: 'failure' } }).error), fields);
  const output = normalizeDiagnosticError({ message: 'retryable failure', retryable: 'false', code: { toString() { throw Error('coercion'); } } });
  assert.equal(output.retryable, undefined);
  assert.equal(output.code, undefined);
  assert.equal(normalizeDiagnosticError(new TypeError('type')).name, 'TypeError');
  assert.equal(normalizeDiagnosticError(new Error('failed')).retryable, undefined);
  assert.equal(normalizeDiagnosticError(42).message, '42');
});

test('DOMException AbortError の標準name/message/stackと分類を維持する', () => {
  const error = Object.assign(new DOMException('request aborted', 'AbortError'), { category: 'cancelled', retryable: false, correlation_id: 'abort-42' });
  const store = createDiagnosticsStore(); store.captureError(error);
  const output = store.exportSnapshot().entries[0].error;
  assert.equal(output.name, 'AbortError');
  assert.equal(output.message, 'request aborted');
  assert.match(output.stack, /AbortError: request aborted/);
  assert.equal(output.category, 'cancelled');
  assert.equal(output.retryable, false);
  assert.equal(output.correlation_id, 'abort-42');
  // DOMException.code is a legacy numeric prototype field, not our own code.
  assert.equal(output.code, undefined);
  const getter = Object.getOwnPropertyDescriptor(DOMException.prototype, 'message').get;
  const fake = Object.defineProperty({}, 'message', { get: getter });
  assert.doesNotThrow(() => normalizeDiagnosticError(fake));
  assert.equal(normalizeDiagnosticError(fake).message, undefined);
});

test('文字列exportでも分類を残し、既存secret/body除去を維持する', () => {
  const entry = { level: 'error', message: 'Token: root-secret', error: classified({
    correlation_id: 'token=correlation-secret', category: 'Authorization: category-secret',
    details: { namespace: 'never-copy-pack' }, payload: 'never-copy-payload',
  }), data: { body: 'never-copy-body', token: 'never-copy-token' } };
  const text = formatDiagnosticsText([entry]);
  assert.match(text, /EDIT_SCOPE_CHANGED/);
  assert.match(text, /"retryable":\s*false/);
  for (const value of ['root-secret', 'correlation-secret', 'category-secret', 'never-copy-pack', 'never-copy-payload', 'never-copy-body', 'never-copy-token']) {
    assert.ok(!text.includes(value), value);
  }
});

test('cause は循環を止め、分類だけを残し、正規化を繰り返しても失わない', () => {
  const root = classified();
  const cause = Object.assign(new Error('cause-message-private'), { code: 'CAUSE_CODE', retryable: true, details: 'cause-details-private' });
  root.cause = cause;
  cause.cause = root;
  const output = normalizeDiagnosticError(root);
  assert.equal(output.cause.code, 'CAUSE_CODE');
  assert.equal(output.cause.retryable, true);
  assert.equal(output.cause.cause.omitted, 'CIRCULAR_ERROR_CAUSE');
  assert.equal(output.cause.message, undefined);
  assert.equal(output.cause.stack, undefined);
  assert.ok(!JSON.stringify(output).includes('cause-message-private'));
  assert.ok(!JSON.stringify(output).includes('cause-details-private'));
  assert.deepEqual(normalizeDiagnosticError(output), output);
  assert.deepEqual(pickFields(redactDiagnosticValue(root)), fields);
});

test('cause の深い鎖と過大な文字列を有限の記録にする', () => {
  const root = classified({ message: 'M'.repeat(1024 * 1024), stack: 'S'.repeat(1024 * 1024), correlation_id: 'C'.repeat(1024 * 1024) });
  let cursor = root;
  for (let i = 0; i < 100; i++) cursor = cursor.cause = { code: `CAUSE_${i}`, message: 'hidden', stack: 'hidden' };
  const output = normalizeDiagnosticError(root);
  assert.match(output.message, /OMITTED_OVERSIZED_ERROR_FIELD/);
  assert.match(output.stack, /OMITTED_OVERSIZED_ERROR_FIELD/);
  assert.match(output.correlation_id, /OMITTED_OVERSIZED_ERROR_FIELD/);
  assert.equal(output.cause.cause.cause.cause.omitted, 'ERROR_CAUSE_DEPTH_LIMIT');
  assert.ok(JSON.stringify(output).length < 1500);
  assert.deepEqual(normalizeDiagnosticError(output), output);
});

test('Error-like と native Error の getter を実行せず、分類を保存する', () => {
  for (const error of [{}, new Error('temporary')]) {
    let calls = 0;
    for (const key of ['name', 'message', 'stack', 'category', 'retryable', 'correlation_id', 'cause']) {
      Object.defineProperty(error, key, { configurable: true, get() { calls++; throw Error('getter-must-not-run'); } });
    }
    error.code = 'GETTER_SAFE';
    const store = createDiagnosticsStore();
    assert.doesNotThrow(() => store.captureError(error));
    assert.equal(store.exportSnapshot().entries[0].error.code, 'GETTER_SAFE');
    assert.equal(calls, 0);
  }
});

test('拒否する Proxy や取り消し済み Proxy は診断経路を壊さない', () => {
  const hostile = new Proxy({}, {
    getOwnPropertyDescriptor() { throw Error('descriptor-failed'); },
    getPrototypeOf() { throw Error('prototype-failed'); },
  });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const error of [hostile, revoked.proxy]) {
    assert.doesNotThrow(() => normalizeDiagnosticError(error));
    assert.doesNotThrow(() => sanitizeDiagnosticEntry({ level: 'error', error }));
    assert.doesNotThrow(() => redactDiagnosticValue(error));
    assert.doesNotThrow(() => createDiagnosticsStore().captureError(error));
  }
});

test('通常のlazy stackは残し、後から追加されたstack formatterは実行しない', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
  let calls = 0;
  try {
    Object.defineProperty(Error, 'prepareStackTrace', { configurable: true, writable: true, value() {
      calls++; throw Error('formatter-must-not-run');
    } });
    assert.doesNotThrow(() => normalizeDiagnosticError(new Error('format-safe')));
    assert.equal(calls, 0);
  } finally {
    if (descriptor) Object.defineProperty(Error, 'prepareStackTrace', descriptor);
    else delete Error.prepareStackTrace;
  }
  assert.match(normalizeDiagnosticError(new Error('normal-stack')).stack, /normal-stack/);
});

test('error フィールド自身の accessor も JSON export / session で実行しない', () => {
  let calls = 0;
  const entry = { message: 'failure', level: 'error' };
  Object.defineProperty(entry, 'error', { get() { calls++; throw Error('entry-getter'); } });
  assert.doesNotThrow(() => sanitizeDiagnosticEntry(entry));
  const session = createSiteDiagnosticSession(); session.start();
  assert.doesNotThrow(() => session.captureDiagnosticEntry(entry));
  session.stop();
  assert.equal(calls, 0);
  session.dispose();
});

test('分類/cause追加後も最小 16 KiB のJSON・text・session予算と省略件数を守る', () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    id: `d${index}`, level: 'error', source: 'test', message: '表示'.repeat(1024),
    error: classified({ code: `ERROR_${index}`, stack: '日本語stack'.repeat(1024), cause: classified() }),
  }));
  const snapshot = buildDiagnosticsSnapshot({ entries, maxBytes: 16384 });
  assert.ok(snapshot.bytes <= 16384);
  assert.equal(snapshot.document.summary.outputBytes, snapshot.bytes);
  assert.ok(snapshot.document.summary.droppedEntryCount > 0);
  assert.ok(Buffer.byteLength(formatDiagnosticsText(entries, { maxBytes: 16384 })) <= 16384);
  const session = createSiteDiagnosticSession({ maxBytes: 16384 }); session.start();
  for (const entry of entries) session.captureDiagnosticEntry(entry);
  session.stop();
  assert.ok(Buffer.byteLength(session.toJson()) <= 16384);
  session.dispose();
});
