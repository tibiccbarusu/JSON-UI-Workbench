import { test, assert, assertDeepEqual, assertEqual } from './test-harness.js';
import { createEventBus } from '../src/state-store/event-bus.js';
import {
  collectMissingReferences,
  collectMissingReferencesFromScreenFiles,
  getMissingReferenceDisplayValue,
  getReferenceScopeScreenFiles,
} from '../src/diagnostics/missing-references.js';
import {
  createSiteDiagnosticSession,
  redactDiagnosticString,
  redactDiagnosticValue,
  summarizeConsoleArguments,
} from '../src/diagnostics/site-diagnostic-session.js';

function utf8Bytes(text) {
  return new TextEncoder().encode(String(text)).byteLength;
}

function makeGlobal(overrides = {}) {
  return {
    navigator: { userAgent: 'UnitTestBrowser/1.0' },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000066' },
    console: {
      debug() {},
      log() {},
      info() {},
      warn() {},
      error() {},
    },
    ...overrides,
  };
}

test('missing-reference reports isolate the selected screen while export can scan all open screens', () => {
  const issue = (code, refValue) => ({ code, refValue, message: refValue });
  const horse = {
    id: 'horse',
    kind: 'screen',
    packPath: 'ui/horse_screen.json',
    meta: { selectedDefinition: { qualifiedName: 'horse.horse_screen', definition: 'horse_screen' } },
    validation: { issues: [issue('MISSING_TEXTURE_REF', 'textures/ui/horse_missing')] },
  };
  const crafting = {
    id: 'crafting',
    kind: 'screen',
    packPath: 'ui/inventory_screen.json',
    meta: { selectedDefinition: { qualifiedName: 'crafting.crafting_screen', definition: 'crafting_screen' } },
    validation: { issues: [issue('MISSING_GLOBAL_VAR', '$crafting_missing')] },
  };
  const nonScreen = {
    id: 'lang', kind: 'lang', packPath: 'texts/en_US.lang',
    validation: { issues: [issue('MISSING_LANG_KEY', 'must.not.leak')] },
  };
  const state = {
    files: {
      currentFileId: 'crafting',
      openFileIds: ['horse', 'lang', 'crafting'],
      byId: { horse, crafting, lang: nonScreen },
    },
  };

  assertDeepEqual(getReferenceScopeScreenFiles(state.files).map((file) => file.id), ['crafting']);
  assertDeepEqual(getReferenceScopeScreenFiles(state.files, 'open').map((file) => file.id), ['horse', 'crafting']);

  const current = collectMissingReferences(state);
  assertEqual(current.scope, 'current-screen');
  assertEqual(current.scannedScreens, 1);
  assertEqual(current.screen.qualifiedName, 'crafting.crafting_screen');
  assertEqual(current.textures.length, 0);
  assertDeepEqual(current.globalVars, [{
    ref: '$crafting_missing',
    count: 1,
    files: ['ui/inventory_screen.json#crafting_screen'],
  }]);

  const allOpen = collectMissingReferences(state, { scope: 'open' });
  assertEqual(allOpen.scope, 'open-screens');
  assertEqual(allOpen.scannedScreens, 2);
  assertEqual(allOpen.screen, null);
  assertDeepEqual(allOpen.textures, [{
    ref: 'textures/ui/horse_missing',
    count: 1,
    files: ['ui/horse_screen.json#horse_screen'],
  }]);
  assertEqual(allOpen.langKeys.length, 0);

  const switched = collectMissingReferences({
    files: { ...state.files, currentFileId: 'horse' },
  });
  assertEqual(switched.scannedScreens, 1);
  assertEqual(switched.screen.qualifiedName, 'horse.horse_screen');
  assertEqual(switched.globalVars.length, 0);
  assertEqual(switched.textures[0].ref, 'textures/ui/horse_missing');
});

test('open-screen reference reports distinguish definitions that share one JSON path', () => {
  const makeScreen = (id, definition) => ({
    id,
    kind: 'screen',
    packPath: 'ui/redstone_screen.json',
    meta: { selectedDefinition: { qualifiedName: `redstone.${definition}`, definition } },
    validation: { issues: [{ code: 'MISSING_TEXTURE_REF', refValue: 'textures/ui/shared_missing' }] },
  });
  const state = {
    files: {
      currentFileId: 'hopper',
      openFileIds: ['hopper', 'crafter'],
      byId: {
        hopper: makeScreen('hopper', 'hopper_screen'),
        crafter: makeScreen('crafter', 'crafter_screen'),
      },
    },
  };
  const report = collectMissingReferences(state, { scope: 'open' });
  assertEqual(report.textures[0].count, 2);
  assertDeepEqual(report.textures[0].files, [
    'ui/redstone_screen.json#crafter_screen',
    'ui/redstone_screen.json#hopper_screen',
  ]);
});

test('missing-reference scope fails closed for an absent or non-screen selection', () => {
  const files = {
    currentFileId: 'lang',
    openFileIds: ['screen', 'lang'],
    byId: {
      screen: { id: 'screen', kind: 'screen', validation: { issues: [] } },
      lang: { id: 'lang', kind: 'lang', validation: { issues: [] } },
    },
  };
  assertDeepEqual(getReferenceScopeScreenFiles(files), []);
  assertDeepEqual(getReferenceScopeScreenFiles(files, 'unsupported'), []);
  const report = collectMissingReferences({ files });
  assertEqual(report.scannedScreens, 0);
  assertEqual(report.screen, null);

  const stale = {
    currentFileId: 'stale',
    openFileIds: ['screen'],
    byId: {
      ...files.byId,
      stale: { id: 'stale', kind: 'screen', validation: { issues: [{ code: 'MISSING_TEXTURE_REF', refValue: 'must-not-leak' }] } },
    },
  };
  assertDeepEqual(getReferenceScopeScreenFiles(stale), []);
  assertEqual(collectMissingReferences({ files: stale }).scannedScreens, 0);

  const direct = collectMissingReferencesFromScreenFiles([
    files.byId.screen,
    stale.byId.stale,
  ], { scope: 'current' });
  assertEqual(direct.scannedScreens, 0);
  assertEqual(direct.textures.length, 0);
});

test('missing-reference display values support current and legacy report shapes', () => {
  assertEqual(getMissingReferenceDisplayValue({ ref: 'textures/ui/current' }), 'textures/ui/current');
  assertEqual(getMissingReferenceDisplayValue({ refValue: '$legacy_ref' }), '$legacy_ref');
  assertEqual(getMissingReferenceDisplayValue({ value: 'legacy.value' }), 'legacy.value');
  assertEqual(getMissingReferenceDisplayValue({ key: 'legacy.key' }), 'legacy.key');
  assertEqual(getMissingReferenceDisplayValue({ ref: '  current.wins  ', refValue: 'legacy.loses' }), 'current.wins');
  assertEqual(getMissingReferenceDisplayValue(null), '');
});

test('export reference aggregation can use full-document results without mutating the current-screen report', () => {
  const selected = {
    id: 'shared',
    kind: 'screen',
    packPath: 'ui/shared.json',
    meta: { selectedDefinition: { definition: 'selected_screen' } },
    validation: {
      issues: [{ code: 'MISSING_TEXTURE_REF', refValue: 'textures/ui/selected' }],
    },
  };
  const state = {
    files: {
      currentFileId: 'shared',
      openFileIds: ['shared'],
      byId: { shared: selected },
    },
  };
  const fullDocumentAudit = {
    ...selected,
    meta: { ...selected.meta, selectedDefinition: null },
    validation: {
      issues: [
        { code: 'MISSING_TEXTURE_REF', refValue: 'textures/ui/selected' },
        { code: 'MISSING_TEXTURE_REF', refValue: 'textures/ui/sibling' },
      ],
    },
  };

  const exported = collectMissingReferencesFromScreenFiles([fullDocumentAudit], { scope: 'open' });
  assertDeepEqual(exported.textures.map((item) => item.ref), [
    'textures/ui/selected',
    'textures/ui/sibling',
  ]);
  assertDeepEqual(exported.textures[0].files, ['ui/shared.json']);
  assertDeepEqual(collectMissingReferences(state).textures.map((item) => item.ref), [
    'textures/ui/selected',
  ]);
  assertDeepEqual(collectMissingReferences(state).textures[0].files, ['ui/shared.json#selected_screen']);
});

test('site diagnostics require explicit start/stop and include core session metadata', () => {
  let tick = 0;
  const recorder = createSiteDiagnosticSession({
    appVersion: 's066-test',
    globalObject: makeGlobal(),
    idFactory: () => 'site-fixed-id',
    clock: () => new Date(Date.UTC(2026, 7, 30, 12, 0, tick++)),
  });

  assertEqual(recorder.recordOperation('import', 'start', 'TEST').code, 'SITE_DIAG_NOT_ACTIVE');
  const started = recorder.start({ includeUserAgent: true, captureConsole: false });
  assertEqual(started.code, 'SITE_DIAG_STARTED');
  assertEqual(started.sessionId, 'site-fixed-id');
  assertEqual(recorder.start().code, 'SITE_DIAG_ALREADY_ACTIVE');

  recorder.recordOperation('preview', 'success', 'PREVIEW_OK', { boxCount: 12 });
  recorder.addScreenshotReference({
    fileName: 'C:\\private\\capture-preview.png',
    view: 'preview',
    note: 'Canvas result',
  });
  const stopped = recorder.stop({ resultCode: 'MANUAL_SITE_PASS', summary: 'Operator completed the route.' });
  assertEqual(stopped.ok, true);
  assertEqual(stopped.resultCode, 'MANUAL_SITE_PASS');
  assertEqual(stopped.snapshot.session.id, 'site-fixed-id');
  assertEqual(stopped.snapshot.session.appVersion, 's066-test');
  assertEqual(stopped.snapshot.session.userAgent, 'UnitTestBrowser/1.0');
  assertEqual(stopped.snapshot.screenshotReferences[0].fileName, 'capture-preview.png');
  assertEqual(stopped.snapshot.policy.packAndFileBodiesCollected, false);
  assertEqual(recorder.recordOperation('export', 'start', 'LATE').code, 'SITE_DIAG_NOT_ACTIVE');
  assertEqual(recorder.stop().code, 'SITE_DIAG_ALREADY_STOPPED');
});

test('site diagnostic redaction removes credentials and body-shaped values', () => {
  const redacted = redactDiagnosticValue({
    safeCount: 7,
    password: 'open-sesame',
    authorization: 'Bearer should-not-remain',
    content: '{"pack":"body"}',
    nested: {
      api_key: 'api-key-value',
      url: 'https://example.test/?token=query-secret&mode=test',
    },
  });
  const text = JSON.stringify(redacted);
  assertEqual(text.includes('open-sesame'), false);
  assertEqual(text.includes('should-not-remain'), false);
  assertEqual(text.includes('api-key-value'), false);
  assertEqual(text.includes('query-secret'), false);
  assertEqual(text.includes('"pack":"body"'), false);
  assertEqual(redacted.safeCount, 7);
});

test('diagnostic string redaction masks Cookie headers and session query parameters', () => {
  const redacted = redactDiagnosticValue({
    request: 'Cookie: sessionid=SUPERSECRET; theme=x',
    response: 'Set-Cookie: auth=ANOTHERSECRET; HttpOnly; Secure',
    url: 'https://example.test/path?session=QUERYSECRET&mode=test',
  });
  const text = JSON.stringify(redacted);
  assertEqual(text.includes('SUPERSECRET'), false);
  assertEqual(text.includes('ANOTHERSECRET'), false);
  assertEqual(text.includes('QUERYSECRET'), false);
  assert(text.includes('[REDACTED]'));
});

test('diagnostic string redaction masks colon-form authorization and secret labels', () => {
  const text = [
    'Authorization: ApiKey AUTH_HEADER_SECRET',
    'X-API-Key: API_HEADER_SECRET',
    'token: TOKEN_COLON_SECRET',
    'password: PASSWORD_COLON_SECRET',
  ].map((value) => redactDiagnosticString(value)).join('\n');
  for (const secret of ['AUTH_HEADER_SECRET', 'API_HEADER_SECRET', 'TOKEN_COLON_SECRET', 'PASSWORD_COLON_SECRET']) {
    assertEqual(text.includes(secret), false);
  }
});

test('public operation metadata omits nested arbitrary document values', () => {
  const recorder = createSiteDiagnosticSession({ globalObject: makeGlobal() });
  recorder.start();
  recorder.recordOperation('import', 'success', 'IMPORT_OK', {
    entryCount: 12,
    unknownWrapper: { unknownDocumentField: 'NESTED_PRIVATE_PACK_VALUE' },
    manifestLike: {
      format_version: 2,
      header: { name: 'PRIVATE_PACK_NAME' },
      modules: [],
    },
  });
  const stopped = recorder.stop();
  const text = JSON.stringify(stopped.snapshot);
  assertEqual(text.includes('NESTED_PRIVATE_PACK_VALUE'), false);
  assertEqual(text.includes('PRIVATE_PACK_NAME'), false);
  assert(text.includes('OMITTED_BY_POLICY'));
  assert(text.includes('REDACTED_PACK_DOCUMENT'));
  assert(text.includes('entryCount'));
});

test('console summaries omit object values and JSON document strings', () => {
  const summary = summarizeConsoleArguments([
    '{"manifest":{"name":"private-pack"}}',
    { sourceText: 'complete pack body', safe: 'also omitted' },
    'Bearer abc.def.ghi',
  ]);
  const text = JSON.stringify(summary);
  assertEqual(text.includes('private-pack'), false);
  assertEqual(text.includes('complete pack body'), false);
  assertEqual(text.includes('also omitted'), false);
  assertEqual(text.includes('abc.def.ghi'), false);
  assert(text.includes('OMITTED_BY_POLICY'));
  assert(text.includes('REDACTED_JSON_DOCUMENT'));
});

test('console capture is opt-in, preserves original console calls, and restores methods', () => {
  const observed = [];
  const consoleObject = {
    debug: (...args) => observed.push(['debug', ...args]),
    log: (...args) => observed.push(['log', ...args]),
    info: (...args) => observed.push(['info', ...args]),
    warn: (...args) => observed.push(['warn', ...args]),
    error: (...args) => observed.push(['error', ...args]),
  };
  const originalLog = consoleObject.log;
  const recorder = createSiteDiagnosticSession({ globalObject: makeGlobal({ console: consoleObject }) });

  recorder.start({ captureConsole: true });
  assert(consoleObject.log !== originalLog, 'console.log should be wrapped only during the active opt-in session');
  consoleObject.log('visible message', { payload: 'must not be serialized' });
  const stopped = recorder.stop();

  assertEqual(consoleObject.log, originalLog);
  assertEqual(observed.length, 1);
  assertEqual(stopped.snapshot.summary.consoleEventCount, 1);
  const text = JSON.stringify(stopped.snapshot);
  assertEqual(text.includes('must not be serialized'), false);
});

test('diagnostic and store sources auto-classify import, export, preview, error, and rejection', () => {
  const diagnosticsEvents = createEventBus();
  const storeEvents = createEventBus();
  const recorder = createSiteDiagnosticSession({
    globalObject: makeGlobal(),
    diagnosticsStore: { events: diagnosticsEvents },
    store: { events: storeEvents },
  });
  recorder.start();

  storeEvents.emit('action', { action: { type: 'pack/importSuccess', pack: { content: 'SECRET_PACK_BODY' } } });
  storeEvents.emit('action', { action: { type: 'preview/setMockData', mockData: { secret: 'SECRET_MOCK_DATA' } } });
  diagnosticsEvents.emit('entry', { id: 'd1', level: 'info', source: 'export', message: 'Export started' });
  diagnosticsEvents.emit('entry', { id: 'd2', level: 'error', source: 'window.error', message: 'Render failed' });
  diagnosticsEvents.emit('entry', {
    id: 'd3',
    level: 'error',
    source: 'window.unhandledrejection',
    message: 'Unhandled promise rejection',
  });

  const stopped = recorder.stop();
  const operations = new Set(stopped.snapshot.events.map((event) => event.operation));
  const kinds = new Set(stopped.snapshot.events.map((event) => event.kind));
  assert(operations.has('import'));
  assert(operations.has('export'));
  assert(operations.has('preview'));
  assert(kinds.has('error'));
  assert(kinds.has('unhandled_rejection'));
  const text = JSON.stringify(stopped.snapshot);
  assertEqual(text.includes('SECRET_PACK_BODY'), false);
  assertEqual(text.includes('SECRET_MOCK_DATA'), false);
  assertEqual(stopped.resultCode, 'SITE_DIAGNOSTIC_ERRORS_CAPTURED');
});

test('site diagnostic JSON obeys the exact UTF-8 byte limit and reports dropped events', () => {
  const maxBytes = 16 * 1024;
  const recorder = createSiteDiagnosticSession({
    globalObject: makeGlobal(),
    maxBytes,
    maxEvents: 10000,
  });
  recorder.start();
  for (let index = 0; index < 1000; index += 1) {
    recorder.recordOperation('preview', 'frame', 'PREVIEW_FRAME', {
      index,
      note: `frame-${index}-${'x'.repeat(1000)}`,
    });
  }
  recorder.stop();
  const text = recorder.toJson();
  const parsed = JSON.parse(text);
  assert(utf8Bytes(text) <= maxBytes, `Expected <= ${maxBytes} bytes, got ${utf8Bytes(text)}`);
  assert(parsed.summary.droppedEventCount > 0);
  assertEqual(parsed.outcome.resultCode, 'SITE_DIAGNOSTIC_WARNINGS_CAPTURED');
  assertEqual(parsed.summary.outputBytes, utf8Bytes(text));
});

test('user agent is omitted by default and only included by explicit opt-in', () => {
  const globalObject = makeGlobal();
  const recorder = createSiteDiagnosticSession({ globalObject });
  recorder.start();
  const stopped = recorder.stop();
  assertEqual(stopped.snapshot.session.userAgentIncluded, false);
  assertEqual(stopped.snapshot.session.userAgent, null);
  assertEqual(JSON.stringify(stopped.snapshot).includes('UnitTestBrowser/1.0'), false);
});

test('copy and download helpers return result codes and the same bounded JSON', async () => {
  let copiedText = '';
  let downloadParams = null;
  const recorder = createSiteDiagnosticSession({
    globalObject: makeGlobal(),
    clipboardWriteText: async (text) => { copiedText = text; },
    downloadText: async (params) => { downloadParams = params; },
  });
  recorder.start();
  recorder.recordOperation('import', 'success', 'IMPORT_OK', { entryCount: 42 });
  recorder.stop({ resultCode: 'SITE_TEST_PASS' });

  const copied = await recorder.copy();
  const downloaded = await recorder.download();
  assertEqual(copied.code, 'SITE_DIAG_COPIED');
  assertEqual(downloaded.code, 'SITE_DIAG_DOWNLOADED');
  assertEqual(JSON.parse(copiedText).outcome.resultCode, 'SITE_TEST_PASS');
  assertEqual(downloadParams.text, copiedText);
  assertEqual(downloadParams.mime, 'application/json');
  assert(downloadParams.filename.endsWith('.json'));
});

test('site diagnostic output cannot be submitted before a completed stop', async () => {
  let writeCount = 0;
  const recorder = createSiteDiagnosticSession({
    globalObject: makeGlobal(),
    clipboardWriteText: async () => { writeCount += 1; },
    downloadText: async () => { writeCount += 1; },
  });

  assertEqual(recorder.snapshot().outcome.resultCode, 'SITE_DIAGNOSTIC_NOT_STARTED');
  assertEqual((await recorder.copy()).code, 'SITE_DIAG_NOT_STARTED');
  assertEqual((await recorder.download()).code, 'SITE_DIAG_NOT_STARTED');

  recorder.start();
  assertEqual(recorder.snapshot().outcome.resultCode, 'SITE_DIAGNOSTIC_IN_PROGRESS');
  assertEqual((await recorder.copy()).code, 'SITE_DIAG_NOT_STOPPED');
  assertEqual((await recorder.download()).code, 'SITE_DIAG_NOT_STOPPED');
  assertEqual(writeCount, 0, 'No clipboard or download writer may run before stop');

  recorder.stop({ resultCode: 'SITE_TEST_PASS' });
  assertEqual((await recorder.copy()).code, 'SITE_DIAG_COPIED');
  assertEqual((await recorder.download()).code, 'SITE_DIAG_DOWNLOADED');
  assertEqual(writeCount, 2);
});

test('public operation error, rejection, and warning phases cannot produce a false PASS', () => {
  const failed = createSiteDiagnosticSession({ globalObject: makeGlobal() });
  failed.start();
  failed.recordOperation('export', 'rejected', 'EXPORT_REJECTED');
  const failedStop = failed.stop({ resultCode: 'MANUAL_SITE_PASS' });
  assertEqual(failedStop.snapshot.summary.errorCount, 1);
  assertEqual(failedStop.resultCode, 'SITE_DIAGNOSTIC_ERRORS_CAPTURED');
  assertEqual(failedStop.snapshot.outcome.operatorResultCode, 'MANUAL_SITE_PASS');
  assertEqual(failedStop.snapshot.events.find((event) => event.resultCode === 'EXPORT_REJECTED').phase, 'failure');

  const warned = createSiteDiagnosticSession({ globalObject: makeGlobal() });
  warned.start();
  warned.recordOperation('preview', 'warning', 'PREVIEW_WARNING');
  const warnedStop = warned.stop({ resultCode: 'MANUAL_SITE_PASS' });
  assertEqual(warnedStop.snapshot.summary.warningCount, 1);
  assertEqual(warnedStop.resultCode, 'SITE_DIAGNOSTIC_WARNINGS_CAPTURED');
  assertEqual(warnedStop.snapshot.outcome.operatorResultCode, 'MANUAL_SITE_PASS');
});

test('public filename, result code, and console object keys redact embedded secrets', () => {
  const consoleObject = {
    debug() {}, log() {}, info() {}, warn() {}, error() {},
  };
  const recorder = createSiteDiagnosticSession({ globalObject: makeGlobal({ console: consoleObject }) });
  recorder.start({ captureConsole: true });
  recorder.addScreenshotReference({ fileName: 'token=SUPERSECRET.png', view: 'preview' });
  consoleObject.log({ 'token=OBJECTKEYSECRET': true });
  const stopped = recorder.stop({ resultCode: 'token=RESULTCODESECRET' });
  const text = JSON.stringify(stopped.snapshot);
  assertEqual(text.includes('SUPERSECRET'), false);
  assertEqual(text.includes('OBJECTKEYSECRET'), false);
  assertEqual(text.includes('RESULTCODESECRET'), false);
  assert(stopped.snapshot.summary.redactionCount >= 3);
});
