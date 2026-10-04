/*
  test-harness.js (S059)

  Minimal, buildless unit test harness.

  Goals:
  - Run in a browser with native ES modules.
  - No external dependencies.
  - Focus on "pure" logic modules under /src.
*/

/** @typedef {{ name: string, fn: () => (void|Promise<void>) }} TestCase */

/** @type {TestCase[]} */
const _tests = [];

/**
 * Register a test.
 * @param {string} name
 * @param {() => (void|Promise<void>)} fn
 */
export function test(name, fn) {
  _tests.push({ name: String(name), fn });
}

/** @returns {TestCase[]} */
export function getRegisteredTests() {
  return _tests.slice();
}

/**
 * Basic assertion.
 * @param {any} condition
 * @param {string} [message]
 */
export function assert(condition, message = 'Assertion failed') {
  if (!condition) throw new Error(String(message || 'Assertion failed'));
}

/**
 * Strict equality assertion.
 * @param {any} actual
 * @param {any} expected
 * @param {string} [message]
 */
export function assertEqual(actual, expected, message = '') {
  if (!Object.is(actual, expected)) {
    const hint = message ? `: ${message}` : '';
    throw new Error(`Expected ${formatValue(expected)} but got ${formatValue(actual)}${hint}`);
  }
}

/**
 * Deep equality for JSON-friendly values (plain objects / arrays / primitives).
 * @param {any} actual
 * @param {any} expected
 * @param {string} [message]
 */
export function assertDeepEqual(actual, expected, message = '') {
  if (!deepEqual(actual, expected)) {
    const hint = message ? `: ${message}` : '';
    throw new Error(`DeepEqual failed${hint}\nexpected=${formatValue(expected)}\nactual=${formatValue(actual)}`);
  }
}

/**
 * Assert that a function throws.
 * Works for sync and async functions.
 *
 * @param {() => any} fn
 * @param {{
 *   nameIncludes?: string,
 *   messageIncludes?: string,
 *   predicate?: (error: any) => boolean,
 * }} [opts]
 */
export async function assertThrows(fn, opts = {}) {
  let threw = false;
  try {
    const v = fn();
    if (v && typeof v.then === 'function') {
      await v;
    }
  } catch (err) {
    threw = true;

    const name = err && typeof err === 'object' && 'name' in err ? String(/** @type {any} */ (err).name) : '';
    const msg = err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err || '');

    if (opts.nameIncludes) {
      assert(name.includes(String(opts.nameIncludes)), `Expected error.name to include "${opts.nameIncludes}", got "${name}"`);
    }
    if (opts.messageIncludes) {
      assert(msg.includes(String(opts.messageIncludes)), `Expected error.message to include "${opts.messageIncludes}", got "${msg}"`);
    }
    if (typeof opts.predicate === 'function') {
      assert(Boolean(opts.predicate(err)), 'Expected error to satisfy predicate');
    }
  }
  if (!threw) throw new Error('Expected function to throw, but it did not');
}

/**
 * Run all registered tests in-order.
 *
 * @param {{
 *   onCaseResult?: (r: any) => void,
 * }} [options]
 */
export async function runRegisteredTests(options = {}) {
  const startedAt = Date.now();

  /** @type {any[]} */
  const results = [];

  for (const tc of getRegisteredTests()) {
    const startedCase = Date.now();
    try {
      await tc.fn();
      const r = { name: tc.name, ok: true, durationMs: Date.now() - startedCase };
      results.push(r);
      if (typeof options.onCaseResult === 'function') options.onCaseResult(r);
    } catch (err) {
      const r = {
        name: tc.name,
        ok: false,
        durationMs: Date.now() - startedCase,
        error: serializeError(err),
      };
      results.push(r);
      if (typeof options.onCaseResult === 'function') options.onCaseResult(r);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  const durationMs = Date.now() - startedAt;
  const stats = { total: results.length, passed, failed, durationMs };

  return {
    startedAtIso: new Date(startedAt).toISOString(),
    durationMs,
    totals: { total: results.length, passed, failed },
    stats,
    results,
  };
}

function isPlainObject(v) {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
    }
    for (const k of ak) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  return false;
}

function formatValue(v) {
  try {
    if (typeof v === 'string') return JSON.stringify(v);
    return JSON.stringify(v);
  } catch {
    try {
      return String(v);
    } catch {
      return '[unprintable]';
    }
  }
}

function serializeError(err) {
  try {
    if (!err || typeof err !== 'object') return { name: 'Error', message: String(err || '') };
    const anyErr = /** @type {any} */ (err);
    return {
      name: typeof anyErr.name === 'string' ? anyErr.name : 'Error',
      message: typeof anyErr.message === 'string' ? anyErr.message : String(err),
      stack: typeof anyErr.stack === 'string' ? anyErr.stack : undefined,
    };
  } catch {
    return { name: 'Error', message: 'Failed to serialize error' };
  }
}
