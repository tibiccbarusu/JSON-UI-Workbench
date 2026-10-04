import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const entry = fileURLToPath(new URL('../../scripts/release/audit-public.mjs', import.meta.url));
test('release manifest covers every delivered file and rejects unregistered API files, duplicates and version drift', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-public-manifest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = ['README.md', 'LICENSE.md', 'THIRD_PARTY_NOTICES.md', 'package-lock.json',
    'editor-core/vendor/zip.js-2.8.16/LICENSE', 'editor-core/vendor/jsonc-parser-3.3.1/LICENSE.md',
    'local-node/vendor/pngjs/LICENSE', '.github/workflows/ci.yml', 'local-node/api.mjs', 'package.json'];
  const records = [];
  for (const name of names) {
    const bytes = Buffer.from(name === 'package.json' ? '{"name":"fixture","version":"0.15.0"}' : 'Original audit fixture\n');
    const destination = path.join(directory, name); await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    records.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const manifest = { schema: 'jsonui-workbench-public-distribution/v1', version: '0.15.0', files: records };
  async function check(value) {
    await writeFile(path.join(directory, 'PUBLIC-DISTRIBUTION.json'), JSON.stringify(value));
    const result = spawnSync(process.execPath, [entry, directory, '--verify-manifest'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined);
    return { exit: result.status, report: JSON.parse(result.stdout) };
  }
  assert.equal((await check(manifest)).exit, 0);
  await writeFile(path.join(directory, 'local-node/unregistered-api.mjs'), 'export const extra = true;\n');
  const extra = await check(manifest); assert.equal(extra.exit, 1);
  assert.ok(extra.report.errors.some(row => row.path === 'local-node/unregistered-api.mjs' && row.reason === 'distribution_file_unregistered'));
  await rm(path.join(directory, 'local-node/unregistered-api.mjs'));
  const duplicate = await check({ ...manifest, files: [...records, records[0]] });
  assert.equal(duplicate.exit, 1); assert.ok(duplicate.report.errors.some(row => row.reason === 'duplicate_manifest_path'));
  const version = await check({ ...manifest, version: '0.14.0' });
  assert.equal(version.exit, 1); assert.ok(version.report.errors.some(row => row.reason === 'distribution_version_mismatch'));
  const missing = await check({ ...manifest, files: records.slice(1) });
  assert.equal(missing.exit, 1); assert.ok(missing.report.errors.some(row => row.path === 'README.md' && row.reason === 'distribution_file_unregistered'));
  const unsafe = await check({ ...manifest, files: [...records, { path: 'C:\\private\\file', bytes: 0, sha256: '0'.repeat(64) }] });
  assert.equal(unsafe.exit, 1); assert.ok(unsafe.report.errors.some(row => row.reason === 'invalid_manifest_path'));
});

test('public audit rejects multiple scratch session IDs and retains generic path placeholders', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-public-private-path-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['README.md', 'LICENSE.md', 'THIRD_PARTY_NOTICES.md', 'package-lock.json',
    'editor-core/vendor/zip.js-2.8.16/LICENSE', 'editor-core/vendor/jsonc-parser-3.3.1/LICENSE.md',
    'local-node/vendor/pngjs/LICENSE', '.github/workflows/ci.yml']) {
    const destination = path.join(directory, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, 'Original audit fixture\n');
  }
  const prefix = ['/', 'workspace', '/', 'scratch', '/'].join('');
  function check() {
    const result = spawnSync(process.execPath, [entry, directory], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined);
    return { exit: result.status, report: JSON.parse(result.stdout) };
  }
  for (const session of ['13bc48a921df', '9FE41D23CB895BA473DF137921DE45AE']) {
    await writeFile(path.join(directory, 'README.md'), 'Private fixture: ' + prefix + session + '/input.json\n');
    const result = check();
    assert.equal(result.exit, 1);
    assert.ok(result.report.errors.some(row => row.path === 'README.md' && row.reason === 'private_session_path'));
  }
  await writeFile(path.join(directory, 'README.md'), 'Private root: ' + prefix + 'aabcdef12345' + '\n');
  assert.equal(check().exit, 1, 'A session root without a trailing slash is also private');
  await writeFile(path.join(directory, 'README.md'), 'Generic example: ' + prefix + '<session-id>/input.json\n');
  assert.equal(check().exit, 0, 'A generic documentation placeholder contains no session identifier');
});
