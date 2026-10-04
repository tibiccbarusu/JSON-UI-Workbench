import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp,mkdir,writeFile,readFile,rm,symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectPackage } from '../preflight28.cjs';
const required=['local-node/server.mjs','editor-core/src/main.js','editor-core/app/index.html','local-node/test.cjs','editor-core/app/styles.css'];
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'jsonui-preflight28-'));t.after(()=>rm(root,{recursive:true,force:true}));for(const name of required){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),'fixture');}await writeFile(path.join(root,'local-node/runtime-files28.json'),JSON.stringify({schema:'jsonui-runtime-files-v1',files:required}));return root;}
test('R28: 実際の配布ソースで起動必須258ファイル以上を確認できる',()=>{const r=inspectPackage(fileURLToPath(new URL('../../',import.meta.url)));assert.equal(r.ok,true);assert(r.required_count>=258);assert.equal(r.checksum_verification,false);});
test('R28: 起動前検査は欠落と空ファイルを区別し、入力ファイルを変えない',async t=>{const root=await fixture(t);assert.equal(inspectPackage(root).ok,true);await rm(path.join(root,required[0]));await writeFile(path.join(root,required[1]),'');const r=inspectPackage(root);assert.equal(r.ok,false);assert.equal(r.failure_count,2);assert.equal(r.failures[0].reason,'ENOENT');assert.equal(r.failures[1].reason,'NOT_A_NONEMPTY_FILE');assert.equal((await readFile(path.join(root,required[1]))).length,0);});
test('R28: マニフェストの重複・経路脱出・必須入口抜けを拒否',async t=>{const root=await fixture(t),file=path.join(root,'local-node/runtime-files28.json');for(const files of [[...required,required[0]],[...required,'local-node/../outside.cjs'],required.map(n=>n===required[0]?'local-node/other.js':n)]){await writeFile(file,JSON.stringify({schema:'jsonui-runtime-files-v1',files}));assert.throws(()=>inspectPackage(root),/MANIFEST_INVALID/u);}});
test('R28: パッケージ内部から外部へのシンボリックリンクを検出',async t=>{const root=await fixture(t);await rm(path.join(root,required[3]));await symlink(path.join(root,required[0]),path.join(root,required[3]));const r=inspectPackage(root);assert.equal(r.ok,false);assert.equal(r.failures[0].reason,'NOT_A_NONEMPTY_FILE');});
test('R28: BATとPowerShellは起動前検査失敗時に後続を実行しない', async () => {
  const bat = await readFile(new URL('../../start.bat', import.meta.url), 'utf8');
  const ps = await readFile(new URL('../bootstrap.ps1', import.meta.url), 'utf8');
  const launch = bat.split(/\r?\n:launch\r?\n/u)[1]?.split(/\r?\n:[a-z_]+\r?\n/u)[0];
  assert(launch, ':launch の処理範囲が存在する');
  const cleanup = launch.indexOf('call :clean_stage');
  const preflight = launch.indexOf('"%JSONUI_NODE%" "%~dp0local-node\\preflight28.cjs"');
  assert(cleanup >= 0 && cleanup < preflight, '一時ファイルを片付けてから配布検査を実行する');
  // A startup log before preflight is harmless. Nothing may clobber ERRORLEVEL
  // between preflight and its guard, or launch the site before that guard.
  assert.match(launch, /"%JSONUI_NODE%" "%~dp0local-node\\preflight28.cjs"\r?\nif not "%errorlevel%"=="0" goto package_incomplete\r?\n"%JSONUI_NODE%" "%~dp0local-node\\launcher.mjs"/u);
  assert.equal(launch.indexOf('"%JSONUI_NODE%" "%~dp0local-node\\launcher.mjs"'), launch.lastIndexOf('"%JSONUI_NODE%" "%~dp0local-node\\launcher.mjs"'));
  assert.match(ps, /& \$nodeExecutable \$preflight\r?\n\s+if \(\$LASTEXITCODE -ne 0\) \{ throw 'LAUNCH_PACKAGE_INCOMPLETE' \}/u);
  assert(!/ExecutionPolicy\s+Bypass/iu.test(bat + ps));
});

test('R28: 配布欠落はINFOではなくERRORとして記録する',async()=>{const{launcherLogRecord}=await import('../launcher.mjs');assert.equal(launcherLogRecord('LAUNCH_PACKAGE_INCOMPLETE').severity,'ERROR');});
