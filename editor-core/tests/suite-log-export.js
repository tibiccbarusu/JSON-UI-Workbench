import { test, assert, assertEqual } from './test-harness.js';
import {
  buildDiagnosticsSnapshot,
  filterDiagnosticEntries,
  formatDiagnosticsText,
  sanitizeDiagnosticEntry,
} from '../src/diagnostics/log-export.js';

const fixtureEntries = [
  {
    id: 'one',
    tsIso: '2026-09-02T12:00:00.000Z',
    level: 'error',
    source: 'renderer',
    message: 'Failed with token=private-value',
    data: {
      authorization: 'Bearer secret-token',
      body: '{"pack":"must not escape"}',
      definition: 'anvil_screen',
    },
    error: { name: 'Error', message: 'Bearer private-token', stack: 'Error: token=hidden\n at renderer' },
  },
  {
    id: 'two',
    tsIso: '2026-09-02T12:01:00.000Z',
    level: 'info',
    source: 'pack-import',
    message: 'Imported pack metadata',
  },
];

test('application log sanitization redacts secret keys, bodies, and embedded tokens', () => {
  const entry = sanitizeDiagnosticEntry(fixtureEntries[0]);
  const serialized = JSON.stringify(entry);
  assert(!serialized.includes('private-value'));
  assert(!serialized.includes('secret-token'));
  assert(!serialized.includes('private-token'));
  assert(!serialized.includes('must not escape'));
  assert(serialized.includes('[REDACTED'));
  assertEqual(entry.data.definition, 'anvil_screen');
});

test('application log filters combine severity, source, and free-text search', () => {
  assertEqual(filterDiagnosticEntries(fixtureEntries, { level: 'error' }).length, 1);
  assertEqual(filterDiagnosticEntries(fixtureEntries, { source: 'pack-import' }).length, 1);
  assertEqual(filterDiagnosticEntries(fixtureEntries, { query: 'IMPORTED PACK' }).length, 1);
  assertEqual(filterDiagnosticEntries(fixtureEntries, { level: 'error', source: 'pack-import' }).length, 0);
});

test('application log JSON export is bounded and excludes environment by default', () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({
    id: `entry-${index}`,
    tsIso: '2026-09-02T12:00:00.000Z',
    level: index % 2 ? 'warn' : 'debug',
    source: 'stress',
    message: `entry ${index} ${'x'.repeat(2048)}`,
  }));
  const result = buildDiagnosticsSnapshot({
    entries,
    maxBytes: 16 * 1024,
    context: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`field-${index}`, 'y'.repeat(2048)])),
    environment: { url: 'https://example.invalid/path?token=secret#fragment', userAgent: 'private-agent' },
  });
  const parsed = JSON.parse(result.text);
  assert(result.bytes <= 16 * 1024, `Expected <= 16384 bytes, got ${result.bytes}`);
  assertEqual(parsed.schema, 'jsonui.application-log');
  assertEqual(parsed.environment, null);
  assertEqual(parsed.privacy.environmentIncluded, false);
  assert(parsed.summary.droppedEntryCount > 0);
  assertEqual(parsed.summary.outputBytes, result.bytes);
});

test('application log environment export removes URL query and fragment when explicitly enabled', () => {
  const result = buildDiagnosticsSnapshot({
    entries: [],
    includeEnv: true,
    environment: {
      url: 'https://example.invalid/path?token=private#section',
      userAgent: 'test-agent',
      timeZone: 'Etc/UTC',
    },
  });
  const parsed = JSON.parse(result.text);
  assertEqual(parsed.privacy.environmentIncluded, true);
  assertEqual(parsed.environment.url, 'https://example.invalid/path');
  assert(!result.text.includes('private'));
  assert(!result.text.includes('#section'));
});

test('application log text export stays readable and redacted', () => {
  const text = formatDiagnosticsText(fixtureEntries);
  assert(text.includes('ERROR renderer'));
  assert(text.includes('INFO pack-import'));
  assert(text.includes('not Minecraft Content Log'));
  assert(!text.includes('private-value'));
  assert(!text.includes('secret-token'));
  assert(!text.includes('private-token'));
});
