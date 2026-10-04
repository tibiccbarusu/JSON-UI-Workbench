import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const verifyManifest = args.includes('--verify-manifest');
const root = path.resolve(args.find(value => !value.startsWith('--')) || fileURLToPath(new URL('../../', import.meta.url)));
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', '__pycache__']);
const blocked = [
  /^editor-core\/assets\/native-default-player\//,
  /^local-node\/vendor\/canvas\//,
  /^local-node\/tests\/horse-v3-controller\.json$/,
  /^local-node\/tests\/fixtures\/settings-texture37\.json$/,
  /^editor-core\/tests\/fixtures\/revision12-actions\/official-action-excerpts\.json$/,
  /^docs\/(?:r\d|revision|resume)/,
  /^(?:uploads?|private-assets|private-fixtures|sessions|logs|outputs|\.jsonui(?:-cli|-api)?)\//,
  /(?:^|\/)\.env(?:\.|$)/,
  /\.(?:node|dll|exe|ttf|otf|pfx|pem|key|jsonl|log)$/i,
];
const errors = [];
const files = [];
const approvedArchives = new Set(['editor-core/app/fixtures/s018-small-fixture.zip', 'editor-core/app/fixtures/s025-minimal-resource-pack.zip']);
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isSymbolicLink()) { errors.push({ path: relative, reason: 'symbolic_link' }); continue; }
    if (blocked.some(pattern => pattern.test(relative + (entry.isDirectory() ? '/' : '')))) {
      errors.push({ path: relative, reason: 'excluded_publication_input' });
      continue;
    }
    if (entry.isDirectory()) { await walk(path.join(directory, entry.name), relative + '/'); continue; }
    if (!entry.isFile()) continue;
    files.push(relative);
    if (/\.(?:zip|mcpack|mcaddon)$/i.test(relative) && !approvedArchives.has(relative))
      errors.push({ path: relative, reason: 'unreviewed_archive' });
    const absolute = path.join(root, relative), stat = await lstat(absolute);
    if (stat.size > 16 * 1024 * 1024) errors.push({ path: relative, reason: 'unexpected_large_file' });
    if (/\.(?:m?js|cjs|json|md|txt|html|yml|yaml|py)$/i.test(relative) && stat.size < 8 * 1024 * 1024) {
      const text = await readFile(absolute, 'utf8');
      // High-confidence credential forms, not the words used by security tests.
      if (/(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text))
        errors.push({ path: relative, reason: 'credential_pattern' });
      // Session directories use an opaque hexadecimal ID. Match any actual
      // session ID while retaining generic documentation placeholders.
      if (/\/workspace\/scratch\/[a-f0-9]{12,64}(?=\/|[\s"'`]|$)/i.test(text))
        errors.push({ path: relative, reason: 'private_session_path' });
    }
  }
}
await walk(root);
for (const required of ['README.md', 'LICENSE.md', 'THIRD_PARTY_NOTICES.md', 'package-lock.json',
  'editor-core/vendor/zip.js-2.8.16/LICENSE', 'editor-core/vendor/jsonc-parser-3.3.1/LICENSE.md',
  'local-node/vendor/pngjs/LICENSE', '.github/workflows/ci.yml']) {
  if (!files.includes(required)) errors.push({ path: required, reason: 'missing_required_file' });
}
const manifestPath = path.join(root, 'PUBLIC-DISTRIBUTION.json');
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') errors.push({ path: 'PUBLIC-DISTRIBUTION.json', reason: 'invalid_manifest' });
}
if (verifyManifest && !manifest) errors.push({ path: 'PUBLIC-DISTRIBUTION.json', reason: 'distribution_manifest_missing' });
const recordedPaths = new Set();
if (verifyManifest && manifest && !Array.isArray(manifest.files)) errors.push({ path: 'PUBLIC-DISTRIBUTION.json', reason: 'invalid_manifest_files' });
if (verifyManifest && manifest && Array.isArray(manifest.files)) for (const record of manifest.files) {
  const relative = record.path;
  if (typeof relative !== 'string' || path.isAbsolute(relative) || /^[a-z]:/i.test(relative) || /[\\\u0000-\u001f]/u.test(relative)
      || relative.split('/').some(part => !part || part === '..' || part === '.') || relative === 'PUBLIC-DISTRIBUTION.json') {
    errors.push({ path: String(relative), reason: 'invalid_manifest_path' }); continue;
  }
  if (recordedPaths.has(relative)) errors.push({ path: relative, reason: 'duplicate_manifest_path' });
  recordedPaths.add(relative);
  try {
    const data = await readFile(path.join(root, relative));
    if (data.byteLength !== record.bytes || createHash('sha256').update(data).digest('hex') !== record.sha256)
      errors.push({ path: relative, reason: 'distribution_hash_mismatch' });
  } catch { errors.push({ path: relative, reason: 'distribution_file_missing' }); }
}
if (verifyManifest && manifest) {
  for (const relative of files) if (relative !== 'PUBLIC-DISTRIBUTION.json' && !recordedPaths.has(relative))
    errors.push({ path: relative, reason: 'distribution_file_unregistered' });
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    if (pkg.version !== manifest.version) errors.push({ path: 'package.json', reason: 'distribution_version_mismatch' });
  } catch { errors.push({ path: 'package.json', reason: 'invalid_package_json' }); }
}
console.log(JSON.stringify({ schema: 'jsonui-workbench-public-audit/v1', status: errors.length ? 'failed' : 'passed',
  checked_files: files.length, errors, distribution_hashes_checked: verifyManifest, native_parity_verified: false,
  scope: 'Public-file policy, retained notices, high-confidence secret patterns and optional distribution hashes; not a legal clearance.' }, null, 2));
if (errors.length) process.exitCode = 1;
