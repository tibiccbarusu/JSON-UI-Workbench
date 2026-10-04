/** Asset-independent public tests. No historical reports or game installation required. */
import { readdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dirs = ['editor-core/tests', 'local-node/tests'];
const privateTests = new Set([
 'local-node/tests/horse.test.mjs',
 'local-node/tests/native-player-default.test.mjs',
 'local-node/tests/texture-value37.test.mjs',
 'editor-core/tests/ui-interaction-actions.node.test.mjs',
 'editor-core/tests/ui-audio-main12.node.test.mjs',
]);
const files = [];
for (const dir of dirs) for (const name of (await readdir(path.join(root, dir))).sort()) {
 const relative = `${dir}/${name}`;
 if (name.endsWith('.test.mjs') && !privateTests.has(relative)) files.push(relative);
}
console.log('JSON UI Workbench public regression suite. Minecraft asset-dependent archival tests are excluded, not passed.');
const run = (args) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
const tests = run(['--test', '--test-concurrency=2', ...files]);
if (tests.error || tests.status !== 0) process.exit(tests.status || 1);
const temp = await mkdtemp(path.join(tmpdir(), 'jsonui-workbench-tests-'));
try {
 const reportPath = path.join(temp, 'core.json');
 const core = run(['scripts/verify-core.mjs', reportPath]);
 if (core.error || core.status !== 0) process.exitCode = core.status || 1;
 const report = JSON.parse(await readFile(reportPath, 'utf8'));
 console.log('Core engine suite:', JSON.stringify(report.totals));
 for (const failure of report.results.filter(row => !row.ok)) console.error(JSON.stringify(failure));
} finally { await rm(temp, { recursive: true, force: true }); }
