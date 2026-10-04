import { test, assert, assertEqual, assertThrows } from './test-harness.js';
import { normalizeZipPath } from '../src/path/normalize-zip-path.js';
import { normalizePackPath } from '../src/path/normalize-pack-path.js';

test('normalizeZipPath normalizes slashes and dot segments', () => {
  const out = normalizeZipPath('ui\\./screens//sample.json');
  assertEqual(out, 'ui/screens/sample.json');
});

test('normalizeZipPath rejects absolute paths', async () => {
  await assertThrows(() => normalizeZipPath('/ui/a.json'), { includes: 'ABSOLUTE' });
});

test('normalizeZipPath rejects path traversal', async () => {
  await assertThrows(() => normalizeZipPath('../ui/a.json'), { includes: 'PATH_TRAVERSAL' });
});

test('normalizeZipPath rejects drive letters', async () => {
  await assertThrows(() => normalizeZipPath('C:\\ui\\a.json'), { includes: 'DRIVE_LETTER' });
});

test('normalizeZipPath rejects Windows drive-relative paths', async () => {
  await assertThrows(() => normalizeZipPath('C:ui/a.json'), { messageIncludes: 'DRIVE_LETTER' });
  await assertThrows(() => normalizeZipPath('./C:ui/a.json'), { messageIncludes: 'DRIVE_LETTER' });
  await assertThrows(() => normalizeZipPath('ui/C:relative.json'), { messageIncludes: 'DRIVE_LETTER' });
});

test('normalizeZipPath rejects URL-scheme-like pack paths', async () => {
  await assertThrows(() => normalizeZipPath('http:evil.example/a.json'), { messageIncludes: 'URL_SCHEME' });
  await assertThrows(() => normalizeZipPath('https://evil.example/a.json'), { messageIncludes: 'URL_SCHEME' });
  await assertThrows(() => normalizeZipPath('./http:evil.example/a.json'), { messageIncludes: 'URL_SCHEME' });
  await assertThrows(() => normalizeZipPath(' http:evil.example/a.json'), { messageIncludes: 'URL_SCHEME' });
});

test('normalizeZipPath preserves a colon outside the leading URL-scheme position', () => {
  assertEqual(normalizeZipPath('ui/status:http.json'), 'ui/status:http.json');
});

test('normalizePackPath prefixes error codes distinctly', async () => {
  await assertThrows(() => normalizePackPath('../ui/a.json'), { includes: 'PACK_PATH_INVALID' });
});
