import { test, assertEqual, assertThrows } from './test-harness.js';
import { sanitizeUrlForAttribute } from '../src/security/sanitize.js';
import { HttpPackSource } from '../src/pack-io/http-pack-source.js';
import { ZIP_READER_INTEGRITY_OPTIONS, ZipReader } from '../src/pack-io/zip-reader.js';
import { extractManifestSummary, validateManifest } from '../src/pack-io/manifest-utils.js';
import { validateUiDefsState } from '../src/validation/validator.js';

function resourcePackManifest(minEngineVersion) {
  const header = {
    name: 'Manifest security test',
    description: 'Manifest security test',
    uuid: '00000000-0000-4000-8000-000000000001',
    version: [1, 0, 0],
  };
  if (minEngineVersion !== undefined) header.min_engine_version = minEngineVersion;
  return {
    format_version: 2,
    header,
    modules: [{
      type: 'resources',
      uuid: '00000000-0000-4000-8000-000000000002',
      version: [1, 0, 0],
    }],
  };
}

test('manifest import preserves only canonical min_engine_version values', () => {
  for (const [raw, expected] of [
    [[1, 26, 40], '1.26.40'],
    ['1.16.0', '1.16.0'],
  ]) {
    const manifest = resourcePackManifest(raw);
    assertEqual(extractManifestSummary(manifest).header.minEngineVersion, expected);
    assertEqual(validateManifest(manifest).warnings.some((item) => (
      item.code === 'MANIFEST_MIN_ENGINE_VERSION_INVALID'
      || item.code === 'MANIFEST_MIN_ENGINE_VERSION_MISSING'
    )), false);
  }

  for (const raw of [
    [1, 2, 3, 4],
    [1, 16.5, 0],
    [-1, 16, 0],
    '01.16.0',
  ]) {
    const manifest = resourcePackManifest(raw);
    assertEqual(extractManifestSummary(manifest).header.minEngineVersion, null);
    const validation = validateManifest(manifest);
    assertEqual(validation.ok, true);
    assertEqual(validation.warnings.some((item) => item.code === 'MANIFEST_MIN_ENGINE_VERSION_INVALID'), true);
  }

  const missing = resourcePackManifest(undefined);
  assertEqual(extractManifestSummary(missing).header.minEngineVersion, null);
  assertEqual(validateManifest(missing).warnings.some((item) => (
    item.code === 'MANIFEST_MIN_ENGINE_VERSION_MISSING'
  )), true);
});

test('ui_defs validation rejects absolute, drive, scheme, and control-bearing paths', () => {
  const result = validateUiDefsState({
    filePath: 'ui/_ui_defs.json',
    formatVersion: 1,
    uiDefs: [
      '/ui/absolute.json',
      'C:ui/drive.json',
      'https:ui/remote.json',
      'ui/control\u0000.json',
    ],
  });
  assertEqual(result.ok, false);
  assertEqual(result.errors.filter((item) => item.code === 'UI_DEFS_PATH_INVALID').length, 4);
});

test('ZipReader 2.8.16 enables its CRC signature gate and overlap checks', () => {
  assertEqual(ZIP_READER_INTEGRITY_OPTIONS.checkSignature, true);
  assertEqual(ZIP_READER_INTEGRITY_OPTIONS.checkOverlappingEntry, true);
  assertEqual(Object.isFrozen(ZIP_READER_INTEGRITY_OPTIONS), true);
});

test('ZipReader entry indexing observes cancellation before commit', async () => {
  const originalZip = globalThis.zip;
  const controller = new AbortController();
  globalThis.zip = {
    BlobReader: class BlobReader {},
    ZipReader: class FakeZipReader {
      async *getEntriesGenerator() {
        yield {
          get filename() {
            controller.abort();
            return 'ui/screen.json';
          },
          directory: false,
          compressedSize: 10,
          uncompressedSize: 20,
          encrypted: false,
          zip64: false,
        };
      }
      async close() {}
    },
  };
  try {
    const reader = new ZipReader({ limits: { useWebWorkers: false } });
    await reader.openFromFile({ name: 'cancel.zip', size: 10 });
    await assertThrows(
      () => reader.listEntries({ signal: controller.signal }),
      { messageIncludes: 'ZIP_LIST_ABORTED' },
    );
  } finally {
    globalThis.zip = originalZip;
  }
});

test('sanitizeUrlForAttribute rejects embedded ASCII controls in schemes', () => {
  const dangerous = [
    'java\u0000script:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    'java\u001fscript:alert(1)',
    'java\u007fscript:alert(1)',
  ];

  for (const value of dangerous) {
    assertEqual(sanitizeUrlForAttribute(value), '', `Expected control-bearing URL to be blocked: ${JSON.stringify(value)}`);
  }
});

test('sanitizeUrlForAttribute continues to allow established safe URL forms', () => {
  assertEqual(sanitizeUrlForAttribute('#/route'), '#/route');
  assertEqual(sanitizeUrlForAttribute('./images/icon.png'), './images/icon.png');
  assertEqual(sanitizeUrlForAttribute('https://example.test/image.png'), 'https://example.test/image.png');
  assertEqual(sanitizeUrlForAttribute('blob:https://example.test/id'), 'blob:https://example.test/id');
});

test('HttpPackSource blocks canonicalized request paths outside its base before fetch', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('FETCH_SHOULD_NOT_RUN');
  };

  try {
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      retry: { maxRetries: 0 },
    });

    await assertThrows(
      () => source.readText('%2e%2e/secret.json'),
      { messageIncludes: 'PACK_HTTP_URL_OUTSIDE_BASE' },
    );
    assertEqual(fetchCalls, 0, 'Containment must be checked before network access');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpPackSource blocks ambiguous percent-encoded path forms before fetch', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('FETCH_SHOULD_NOT_RUN');
  };

  try {
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      retry: { maxRetries: 2, backoffBaseMs: 0, backoffMaxMs: 0 },
    });

    for (const path of ['%252e%252e/secret.json', 'ui%2fscreen.json', 'ui/%00screen.json']) {
      await assertThrows(
        () => source.readText(path),
        { messageIncludes: 'PACK_HTTP_AMBIGUOUS_PATH_ENCODING' },
      );
    }
    assertEqual(fetchCalls, 0, 'Ambiguous encoded paths must be rejected before network access');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpPackSource rejects a cross-origin final response URL without retry', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      status: 200,
      ok: true,
      url: 'https://evil.example/redirected.json',
      headers: { get: () => null },
      text: async () => '{"unsafe":true}',
    };
  };

  try {
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      retry: { maxRetries: 2, backoffBaseMs: 0, backoffMaxMs: 0 },
    });

    await assertThrows(
      () => source.readText('ui/screen.json'),
      { messageIncludes: 'PACK_HTTP_URL_OUTSIDE_BASE' },
    );
    assertEqual(fetchCalls, 1, 'A deterministic containment failure must not be retried');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpPackSource rejects a same-origin redirect outside the base pathname', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    url: 'https://trusted.example/assets/other/screen.json',
    headers: { get: () => null },
    text: async () => '{"unsafe":true}',
  });

  try {
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      retry: { maxRetries: 0 },
    });

    await assertThrows(
      () => source.readText('ui/screen.json'),
      { messageIncludes: 'PACK_HTTP_URL_OUTSIDE_BASE' },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpPackSource accepts a final response URL within the configured base', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    url: 'https://trusted.example/assets/root/ui/screen.json',
    headers: { get: () => null },
    text: async () => '{"safe":true}',
  });

  try {
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      retry: { maxRetries: 0 },
    });

    assertEqual(await source.readText('ui/screen.json'), '{"safe":true}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpPackSource applies final response containment to blob reads', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    url: 'https://evil.example/redirected.png',
    headers: { get: () => null },
    blob: async () => new Blob(['unsafe'], { type: 'image/png' }),
  });

  try {
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      retry: { maxRetries: 0 },
    });

    await assertThrows(
      () => source.readBlob('textures/icon.png'),
      { messageIncludes: 'PACK_HTTP_URL_OUTSIDE_BASE' },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpPackSource stops a chunked text response as soon as maxBytes is exceeded', async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    url: 'https://trusted.example/assets/root/ui/large.json',
    headers: { get: () => null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel() {
        cancelled = true;
      },
    }),
  });

  try {
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      retry: { maxRetries: 0 },
    });
    await assertThrows(
      () => source.readText('ui/large.json', { maxBytes: 4 }),
      { messageIncludes: 'PACK_HTTP_TOO_LARGE' },
    );
    assertEqual(cancelled, true, 'Over-limit body stream should be cancelled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpPackSource applies the same incremental limit to chunked blob responses', async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    url: 'https://trusted.example/assets/root/textures/large.png',
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'image/png' : null) },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel() {
        cancelled = true;
      },
    }),
  });

  try {
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      retry: { maxRetries: 0 },
    });
    await assertThrows(
      () => source.readBlob('textures/large.png', { maxBytes: 4 }),
      { messageIncludes: 'PACK_HTTP_TOO_LARGE' },
    );
    assertEqual(cancelled, true, 'Over-limit blob stream should be cancelled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpPackSource keeps timeout active while a response body is pending', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    url: 'https://trusted.example/assets/root/ui/slow.json',
    headers: { get: () => null },
    body: new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
    }),
  });

  try {
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      timeoutMs: 10,
      retry: { maxRetries: 0 },
    });
    await assertThrows(
      () => source.readText('ui/slow.json', { maxBytes: 1024 }),
      { messageIncludes: 'PACK_HTTP_TIMEOUT' },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpPackSource distinguishes caller abort from a body timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    url: 'https://trusted.example/assets/root/ui/aborted.json',
    headers: { get: () => null },
    body: new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
    }),
  });

  try {
    const abortController = new AbortController();
    const source = new HttpPackSource({
      id: 'security-test',
      baseUrl: 'https://trusted.example/assets/root/',
      timeoutMs: 1000,
      retry: { maxRetries: 0 },
    });
    const pendingRead = source.readText('ui/aborted.json', {
      maxBytes: 1024,
      signal: abortController.signal,
    });
    abortController.abort();
    await assertThrows(
      () => pendingRead,
      { messageIncludes: 'PACK_ABORTED' },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
