import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = join(projectRoot, 'release');
const mirroredDirectories = ['app', 'docs', 'src', 'vendor'];

async function collectFiles(root, current = root, out = []) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) await collectFiles(root, full, out);
    else if (entry.isFile()) out.push(relative(root, full).replaceAll('\\', '/'));
    else throw new Error(`UNSUPPORTED_RELEASE_ENTRY: ${full}`);
  }
  return out;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

const differences = [];
for (const name of mirroredDirectories) {
  const sourceRoot = join(projectRoot, name);
  const targetRoot = join(releaseRoot, name);
  const sourceFiles = await collectFiles(sourceRoot);
  const targetFiles = await collectFiles(targetRoot);
  const all = [...new Set([...sourceFiles, ...targetFiles])].sort();

  for (const rel of all) {
    if (!sourceFiles.includes(rel)) {
      differences.push({ directory: name, path: rel, kind: 'release-only' });
      continue;
    }
    if (!targetFiles.includes(rel)) {
      differences.push({ directory: name, path: rel, kind: 'source-only' });
      continue;
    }
    const [sourceSha256, releaseSha256] = await Promise.all([
      sha256(join(sourceRoot, rel)),
      sha256(join(targetRoot, rel)),
    ]);
    if (sourceSha256 !== releaseSha256) {
      differences.push({ directory: name, path: rel, kind: 'content', sourceSha256, releaseSha256 });
    }
  }
}

const result = {
  status: differences.length === 0 ? 'PASS' : 'FAIL',
  mirroredDirectories,
  differenceCount: differences.length,
  differences,
};
console.log(JSON.stringify(result, null, 2));
if (differences.length > 0) process.exitCode = 1;
