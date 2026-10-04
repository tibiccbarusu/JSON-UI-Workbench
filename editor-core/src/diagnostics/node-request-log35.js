/** Node通信の有限履歴。URLのquery・パック名・本文・tokenは受け取らない。 */
export function createNodeRequestLog35({ capacity = 200, failureCapacity = 40 } = {}) {
  const recent = [], failures = [];
  const limit = Math.max(1, Math.min(500, Number.isFinite(capacity) ? Math.trunc(capacity) : 200));
  const errorLimit = Math.max(1, Math.min(100, Number.isFinite(failureCapacity) ? Math.trunc(failureCapacity) : 40));
  let sequence = 0, totalFailures = 0;
  const counters = { started: 0, completed: 0, failed: 0, cancelled: 0 };
  const routeName = route => {
    const path = String(route || '').split('?')[0].split('/');
    if (path[0] === 'packs') return path.length > 2 ? `packs/:id/${['read', 'preview-image'].includes(path[2]) ? path[2] : 'operation'}` : path.length > 1 ? 'packs/:id' : 'packs';
    return /^[a-z][a-z0-9-]{0,60}$/u.test(path[0]) ? path[0] : 'unknown';
  };
  function begin(route, method = 'GET') {
    counters.started++;
    return { sequence: ++sequence, route: routeName(route), method: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'].includes(method) ? method : 'OTHER',
      started_at: new Date().toISOString(), tick: globalThis.performance?.now?.() ?? Date.now() };
  }
  function end(handle, { status = 0, correlationId = '', code = '', cancelled = false } = {}) {
    if (!handle || handle.finished) return;
    handle.finished = true;
    const ok = status >= 200 && status < 300 && !code;
    const outcome = cancelled ? 'cancelled' : ok ? 'complete' : 'error';
    counters[cancelled ? 'cancelled' : ok ? 'completed' : 'failed']++;
    const entry = { sequence: handle.sequence, route: handle.route, method: handle.method, started_at: handle.started_at,
      ended_at: new Date().toISOString(), duration_ms: Math.max(0, Math.round((globalThis.performance?.now?.() ?? Date.now()) - handle.tick)),
      status: Number.isInteger(status) ? status : 0, outcome, phase: status ? 'response-headers' : 'transport',
      correlation_id: /^[a-zA-Z0-9_-]{1,100}$/u.test(correlationId) ? correlationId : null,
      code: /^[A-Z][A-Z0-9_]{0,95}$/u.test(code) ? code : code ? 'NODE_REQUEST_FAILED' : null };
    recent.push(entry); if (recent.length > limit) recent.shift();
    if (outcome === 'error') { totalFailures++; failures.push(entry); if (failures.length > errorLimit) failures.shift(); }
  }
  return { begin, end, snapshot: () => ({ schema: 'jsonui-node-request-log/v1', counters: { ...counters },
    retention: { recent: limit, failures: errorLimit, dropped_recent: Math.max(0, sequence - (counters.started - counters.completed - counters.failed - counters.cancelled) - recent.length), dropped_failures: Math.max(0, totalFailures - failures.length) },
    failures: failures.map(x => ({ ...x })), recent: recent.map(x => ({ ...x })) }) };
}
