import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '../api.mjs';
import { createRendererServer } from '../api-server.mjs';
import { apiFailure, checkedApiRequest, copyJsonInput } from '../api-request.mjs';

const categories = new Set(['validation', 'authentication', 'authorization', 'not_found', 'already_exists',
  'failed_precondition', 'conflict', 'aborted', 'rate_limit', 'resource_exhausted', 'timeout', 'cancelled',
  'dependency', 'unavailable', 'configuration', 'data_loss', 'internal', 'not_implemented']);

function validError(error) {
  assert.match(error.code, /^[A-Z][A-Z0-9_]{1,61}[A-Z0-9]$/u);
  assert.ok(categories.has(error.category), `Unknown error category: ${error.category}`);
  assert.equal(typeof error.retryable, 'boolean');
  assert.ok(error.correlation_id === null || typeof error.correlation_id === 'string');
  assert.ok(Array.isArray(error.details));
  if (error.category === 'validation') {
    assert.ok(error.details.length > 0, 'validation errors describe a rejected field or request');
    for (const detail of error.details) {
      for (const field of ['kind', 'field', 'reason', 'message']) assert.equal(typeof detail[field], 'string');
    }
  }
  const output = error.toJSON();
  assert.equal(Object.hasOwn(output, 'stack'), false);
  assert.equal(Object.hasOwn(output, 'cause'), false);
  return true;
}

test('SDK input rejects accessors, prototype pollution and non-JSON data without executing user hooks', () => {
  let hookCalls = 0;
  const getter = { get width() { hookCalls++; throw new Error('getter must not run'); } };
  const toJSON = { toJSON() { hookCalls++; throw new Error('toJSON must not run'); } };
  const cycle = {}; cycle.self = cycle;
  const sparse = []; sparse.length = 2; sparse[1] = 1;
  const symbol = { [Symbol('private')]: 1 };
  let deep = {}; for (let index = 0; index < 34; index++) deep = { nested: deep };
  for (const input of [getter, toJSON, cycle, sparse, symbol, deep, { width: NaN }, { width: undefined },
    JSON.parse('{"__proto__":{"polluted":true}}'), JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'),
    Object.assign(Object.create({ inherited: true }), { width: 1 })]) {
    assert.throws(() => copyJsonInput(input), error => {
      assert.ok(['API_REQUEST_INVALID', 'API_INPUT_LIMIT'].includes(error.code));
      return validError(error);
    });
  }
  assert.equal(hookCalls, 0);
  assert.equal(Object.prototype.polluted, undefined);
});

test('SDK snapshots JSON input and rejects unknown public fields', () => {
  const input = { state: { nested: { text: 'original' } }, width: 120, format: 'json' };
  const snapshot = checkedApiRequest('render', input);
  input.width = 999; input.state.nested.text = 'changed';
  assert.equal(snapshot.width, 120);
  assert.equal(snapshot.state.nested.text, 'original');
  assert.throws(() => checkedApiRequest('render', { outputPath: 'should-not-be-a-write-route' }), validError);
});

test('SDK unknown native exceptions retain cause privately and never reflect message or path publicly', () => {
  const sentinel = 'PRIVATE_NATIVE_MESSAGE_19';
  const native = Object.assign(new Error(`${sentinel}: failed reading C:\\private\\auth-token.txt`), { code: 'ERR_PRIVATE_UNKNOWN' });
  const error = apiFailure(native);
  assert.equal(error.cause, native);
  validError(error);
  const output = JSON.stringify(error);
  assert.equal(output.includes(sentinel), false);
  assert.equal(output.includes('auth-token.txt'), false);
  assert.equal(output.includes(native.stack), false);
});

test('queued abort and close race rejects safely and closes the owned renderer idempotently', async t => {
  const deadline = AbortSignal.abort(new DOMException('PRIVATE_TIMEOUT_REASON', 'TimeoutError'));
  await assert.rejects(createRenderer({}, { signal: deadline }), error => {
    assert.equal(error.code, 'API_TIMEOUT'); assert.equal(error.category, 'timeout'); return validError(error);
  });
  const renderer = await createRenderer(); t.after(() => renderer.close());
  const abort = new AbortController();
  const request = renderer.status({}, { signal: abort.signal });
  const rejected = assert.rejects(request, error => { assert.equal(error.code, 'API_CANCELLED'); return validError(error); });
  abort.abort(new Error('PRIVATE_ABORT_REASON'));
  await rejected;
  assert.equal((await renderer.status()).imported, false, 'an aborted status does not poison subsequent calls');
  const pending = Array.from({ length: 4 }, () => renderer.status());
  const observed = Promise.allSettled(pending);
  const firstClose = renderer.close();
  assert.equal(renderer.close(), firstClose);
  await firstClose;
  for (const result of await observed) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.code, 'API_CLOSED');
    validError(result.reason);
  }
  await assert.rejects(renderer.status(), error => { assert.equal(error.code, 'API_CLOSED'); return validError(error); });
});

test('server lifetime abort and explicit close share cleanup and leave no reachable listener', async t => {
  for (const [name, category] of [['AbortError', 'cancelled'], ['TimeoutError', 'timeout']]) {
    await assert.rejects(createRendererServer({ signal: AbortSignal.abort(new DOMException('PRIVATE_REASON', name)) }), error => {
      assert.equal(error.category, category); assert.notEqual(error.code, 'API_HTTP_FAILED'); return validError(error);
    });
  }
  const abort = new AbortController();
  const app = await createRendererServer({ signal: abort.signal }); t.after(() => app.close());
  abort.abort();
  await Promise.all([app.close(), app.close()]);
  await assert.rejects(fetch(app.connection.base_url + '/health', { signal: AbortSignal.timeout(3000) }));
});
