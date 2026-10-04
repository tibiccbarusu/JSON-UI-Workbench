'use strict';
// 配布一式の欠落・空ファイルを起動前に検出する。ユーザーのソース改変は禁止しない。
const fs = require('node:fs');
const path = require('node:path');
function inspectPackage(root = path.resolve(__dirname, '..')) {
  const canonical = fs.realpathSync(root), manifestPath = path.join(canonical, 'local-node/runtime-files28.json');
  const manifestInfo = fs.lstatSync(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 256 * 1024) throw new Error('LAUNCH_PACKAGE_MANIFEST_INVALID');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== 'jsonui-runtime-files-v1' || !Array.isArray(manifest.files)
    || manifest.files.length < 5 || manifest.files.length > 2000) throw new Error('LAUNCH_PACKAGE_MANIFEST_INVALID');
  const required = ['local-node/server.mjs', 'editor-core/src/main.js', 'editor-core/app/index.html'];
  const seen = new Set(), failures = [];
  for (const relative of manifest.files) {
    if (typeof relative !== 'string' || relative.length > 240 || !/^(local-node|editor-core)\/[a-zA-Z0-9_@./-]+$/u.test(relative)
      || relative.split('/').some(x => !x || x === '..' || x === '.') || seen.has(relative)) throw new Error('LAUNCH_PACKAGE_MANIFEST_INVALID');
    seen.add(relative);
    try {
      const file = path.join(canonical, relative), info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) { failures.push({ path: relative, reason: 'NOT_A_NONEMPTY_FILE' }); continue; }
      const real = fs.realpathSync(file), rel = path.relative(canonical, real);
      if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) failures.push({ path: relative, reason: 'OUTSIDE_PACKAGE' });
    } catch (cause) { failures.push({ path: relative, reason: typeof cause.code === 'string' ? cause.code : 'UNREADABLE' }); }
  }
  if (required.some(name => !seen.has(name))) throw new Error('LAUNCH_PACKAGE_MANIFEST_INVALID');
  return { schema: 'jsonui-package-preflight-v1', checked_at: new Date().toISOString(), ok: !failures.length,
    required_count: seen.size, failure_count: failures.length, failures: failures.slice(0, 50), omitted_failures: Math.max(0, failures.length - 50),
    checksum_verification: false, note: '欠落・空ファイル・パッケージ外参照の検査。改ざん検知、構文検査、Windows実機検査ではありません。' };
}
module.exports = { inspectPackage };
if (require.main === module) {
  try {
    if (process.argv.length !== 2) throw new Error('LAUNCH_PREFLIGHT_ARGUMENTS');
    const result = inspectPackage();
    console.log(JSON.stringify(result));
    if (!result.ok) { console.error('LAUNCH_PACKAGE_INCOMPLETE: ZIP一式を新しい空のフォルダーへ展開し直してください。'); process.exitCode = 1; }
  } catch (cause) {
    console.error(JSON.stringify({ ok: false, code: 'LAUNCH_PREFLIGHT_FAILED', reason: cause.code || cause.message })); process.exitCode = 1;
  }
}
