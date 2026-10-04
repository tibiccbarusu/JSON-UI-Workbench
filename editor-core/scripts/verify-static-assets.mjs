import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(projectRoot, 'app', 'index.html');
const html = await readFile(indexPath, 'utf8');
const failures = [];

const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
if (scriptSources.length < 3) failures.push('EXPECTED_THREE_LOCAL_SCRIPTS');

for (const source of scriptSources) {
  if (/^https?:/i.test(source) || source.startsWith('//')) {
    failures.push(`REMOTE_SCRIPT:${source}`);
    continue;
  }
  const target = normalize(join(projectRoot, 'app', source));
  if (!target.startsWith(`${projectRoot}/`)) {
    failures.push(`SCRIPT_OUTSIDE_PROJECT:${source}`);
    continue;
  }
  try {
    await access(target);
  } catch {
    failures.push(`MISSING_SCRIPT:${source}`);
  }
}

const cspMeta = html.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0] || '';
const csp = cspMeta.match(/\bcontent="([^"]*)"/i)?.[1]
  || cspMeta.match(/\bcontent='([^']*)'/i)?.[1]
  || '';
for (const required of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'"]) {
  if (!csp.includes(required)) failures.push(`CSP_MISSING:${required}`);
}
if (!csp.includes("style-src 'self' 'unsafe-inline'")) {
  failures.push('CSP_DYNAMIC_STYLE_POLICY_MISSING');
}

const lockPath = join(projectRoot, 'vendor', 'THIRD_PARTY_LOCK.tsv');
const lockLines = (await readFile(lockPath, 'utf8')).trim().split(/\r?\n/);
if (lockLines.length < 2) failures.push('EMPTY_THIRD_PARTY_LOCK');

for (const [index, line] of lockLines.slice(1).entries()) {
  const fields = line.split('\t');
  if (fields.length !== 7) {
    failures.push(`LOCK_FIELD_COUNT:line=${index + 2}`);
    continue;
  }
  const [, , , , relativePath, expectedSha256] = fields;
  const target = join(projectRoot, 'vendor', relativePath);
  try {
    const actualSha256 = createHash('sha256').update(await readFile(target)).digest('hex');
    if (actualSha256 !== expectedSha256) {
      failures.push(`LOCK_HASH_MISMATCH:${relativePath}`);
    }
  } catch {
    failures.push(`LOCK_FILE_MISSING:${relativePath}`);
  }
}

const result = {
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  localScriptCount: scriptSources.length,
  lockedFileCount: Math.max(0, lockLines.length - 1),
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exitCode = 1;
