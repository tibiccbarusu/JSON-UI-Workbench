import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosticsSnapshot } from '../../editor-core/src/diagnostics/log-export.js';
import { redactDiagnosticValue, summarizeDiagnosticMetadata } from '../../editor-core/src/diagnostics/site-diagnostic-session.js';
import { localizeConsoleResult } from '../console-i18n.mjs';

test('oversized optional diagnostic context preserves newest error events', () => {
  const result = buildDiagnosticsSnapshot({
    maxBytes: 16 * 1024,
    context: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`metric${i}`, 'x'.repeat(1024)])),
    entries: [{ id: 'recent-failure', level: 'error', source: 'edit', message: 'latest edit failure' }],
  });
  const saved = JSON.parse(result.text);
  assert.equal(saved.entries[0]?.id, 'recent-failure');
  assert.equal(saved.summary.droppedEntryCount, 0);
  assert.equal(saved.privacy.contextOmittedForSize, true);
  assert.equal(saved.summary.outputBytes, Buffer.byteLength(result.text));
  assert.ok(result.bytes <= 16 * 1024);
});

test('bounded logs keep newest records and report exact omitted count after removing context', () => {
  const entries = Array.from({ length: 60 }, (_, i) => ({ id: `entry-${i}`, level: 'warn', message: '日本語'.repeat(500) }));
  const { text, bytes } = buildDiagnosticsSnapshot({ maxBytes: 16384, entries, droppedEntryCount: 7, context: { count: 60 } });
  const saved = JSON.parse(text);
  assert.equal(saved.entries.at(-1)?.id, 'entry-59');
  assert.equal(saved.summary.droppedEntryCount, 7 + 60 - saved.entries.length);
  assert.equal(saved.summary.outputBytes, bytes);
  assert.equal(bytes, Buffer.byteLength(text));
  assert.ok(bytes <= 16384);
});

for (const [name, project] of [['redaction', redactDiagnosticValue], ['metadata', summarizeDiagnosticMetadata], ['localization', localizeConsoleResult]]) {
  test(`${name} preserves an own __proto__ diagnostic field without changing the public object prototype`, () => {
    const input = JSON.parse('{"__proto__":{"marker":"retained"},"safe":1}');
    const result = project(input);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.hasOwn(result, '__proto__'), true);
    assert.equal(result.safe, 1);
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(result)), '__proto__'), true);
    assert.equal({}.marker, undefined);
    assert.equal(Object.hasOwn(input, '__proto__'), true);
  });
}

test('oversized optional environment is omitted before newest error logs', () => {
  const result = buildDiagnosticsSnapshot({ maxBytes: 16384, includeEnv: true,
    environment: { userAgent: 'a'.repeat(512), timeZone: 'z'.repeat(512), url: 'https://example.com',
      viewport: Object.fromEntries(Array.from({length: 30}, (_, i) => [`dimension${i}`, 'x'.repeat(512)])) },
    entries: [{ level: 'error', message: 'newest', id: 'last' }] });
  const saved = JSON.parse(result.text);
  assert.ok(result.bytes <= 16384);
  assert.equal(saved.entries[0]?.id, 'last');
  assert.equal(saved.environment, null);
  assert.equal(saved.privacy.environmentIncluded, false);
  assert.equal(saved.privacy.environmentOmittedForSize, true);
  assert.equal(saved.summary.outputBytes, Buffer.byteLength(result.text));
});
