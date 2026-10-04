import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = join(projectRoot, 'release');
const mirroredDirectories = ['app', 'docs', 'src', 'vendor'];

if (!projectRoot.endsWith(`${join('candidate', 'PROJECT')}`) && !projectRoot.endsWith(`${join('PROJECT')}`) && !projectRoot.endsWith(`${join('jsonui-preview-studio', 'editor-core')}`)) {
  throw new Error(`REFUSE_UNEXPECTED_PROJECT_ROOT: ${projectRoot}`);
}

await mkdir(releaseRoot, { recursive: true });
for (const name of mirroredDirectories) {
  // Replace each generated mirror atomically at directory granularity. A plain
  // recursive copy leaves files behind when they were deleted from source.
  await rm(join(releaseRoot, name), { recursive: true, force: true });
  await cp(join(projectRoot, name), join(releaseRoot, name), {
    recursive: true,
    force: true,
    errorOnExist: false,
    preserveTimestamps: false,
  });
}

console.log(JSON.stringify({ status: 'SYNCED', mirroredDirectories }, null, 2));
