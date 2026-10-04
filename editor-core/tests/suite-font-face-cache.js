import { test, assertEqual } from './test-harness.js';
import { createFontFaceCache } from '../src/assets/font-face-cache.js';

test('font face cache rejects a load that completes after clear generation', async () => {
  const cache = createFontFaceCache({ maxEntries: 4, maxBytesTotal: 1024 });
  let resolveLoader;
  const deferred = new Promise((resolve) => { resolveLoader = resolve; });
  const pending = cache.load('vanilla:font/test.ttf', async () => deferred);
  await Promise.resolve();
  cache.clear();
  resolveLoader({ family: 'stale-family', face: {}, bytes: 100 });
  let code = null;
  try { await pending; }
  catch (error) { code = error instanceof Error ? error.message : String(error); }
  assertEqual(code, 'FONT_LOAD_STALE_GENERATION');
  assertEqual(cache.get('vanilla:font/test.ttf'), null);
  assertEqual(cache.getFailure('vanilla:font/test.ttf'), null);
  assertEqual(cache.stats().entries, 0);
});

test('stale font completion cannot delete a newer in-flight load for the same key', async () => {
  const cache = createFontFaceCache({ maxEntries: 4, maxBytesTotal: 1024 });
  let resolveOld;
  let resolveNew;
  const oldDeferred = new Promise((resolve) => { resolveOld = resolve; });
  const newDeferred = new Promise((resolve) => { resolveNew = resolve; });
  const oldLoad = cache.load('vanilla:font/test.ttf', async () => oldDeferred).catch((error) => error.message);
  await Promise.resolve();
  cache.clear();
  const newLoad = cache.load('vanilla:font/test.ttf', async () => newDeferred);
  resolveOld({ family: 'old-family', face: {}, bytes: 100 });
  await oldLoad;
  assertEqual(cache.isLoading('vanilla:font/test.ttf'), true);
  resolveNew({ family: 'new-family', face: {}, bytes: 100 });
  const entry = await newLoad;
  assertEqual(entry.family, 'new-family');
  assertEqual(cache.get('vanilla:font/test.ttf').family, 'new-family');
});
