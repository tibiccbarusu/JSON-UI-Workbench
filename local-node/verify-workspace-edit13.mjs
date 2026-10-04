/** 固定バニラ原文を使う再現可能な編集検査。原資料は読み取り専用。 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectWorkspace, editWorkspace, workspaceRevision } from './workspace-edit.mjs';

const [sourceRoot, outputPath] = process.argv.slice(2);
if (!sourceRoot || !outputPath) {
  console.error('使用法: node local-node/verify-workspace-edit13.mjs <resource_pack ディレクトリ> <検査結果.json>');
  process.exitCode = 2;
} else {
  const report = { validation_status: 'INCONCLUSIVE', run_id: 'jsonui-revision13', stage_ref: 'workspace-edit-official',
    started_at: new Date().toISOString(), runtime: process.version, checks: [],
    limitation: 'Node の原文編集と検査結果であり、Windows 実起動・Minecraft 実機表示の一致を検証するものではありません。' };
  try {
    const documents = Object.create(null);
    async function visit(relative) {
      for (const entry of await readdir(path.join(sourceRoot, relative), { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_FORBIDDEN');
        const file = `${relative}/${entry.name}`;
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile() && /\.jsonc?$/iu.test(entry.name)) documents[file] = await readFile(path.join(sourceRoot, file), 'utf8');
      }
    }
    await visit('ui');
    const beforeRevision = workspaceRevision(documents);
    report.source = { files: Object.keys(documents).length, textBytes: Object.values(documents).reduce((sum, text) => sum + Buffer.byteLength(text), 0), revision: beforeRevision,
      hashes: Object.fromEntries(Object.entries(documents).map(([file, text]) => [file, createHash('sha256').update(text).digest('hex')])) };
    let started = performance.now();
    const inspection = inspectWorkspace({ documents });
    report.checks.push({ name: '全 UI 原文の構文・要素一覧', validation_status: inspection.ok ? 'PASS' : 'FAIL', duration_ms: performance.now() - started,
      elements: inspection.nodes?.length, knownDiagnostics: inspection.diagnostics?.length, existingErrors: inspection.diagnostics?.filter(item => item.severity === 'error'), heapBytes: process.memoryUsage().heapUsed });
    if (!inspection.ok) throw new Error(inspection.code);
    const target = inspection.nodes.find(node => node.path === 'ui/beacon_screen.json' && !node.isDefinition && typeof node.props.text === 'string');
    if (!target) throw new Error('OFFICIAL_EDIT_TARGET_MISSING');
    const operations = [
      { name: 'ビーコン文字列を原文編集', operation: { type: 'set', path: target.path, pointer: `${target.pointer}/text`, value: '原文編集検査13' } },
      { name: 'ビーコン子要素を移動', operation: { type: 'move', path: target.path, pointer: target.pointer, offset: [12, 24] } },
      { name: 'ビーコン子要素を追加', operation: { type: 'add', path: target.path, parentPointer: target.parentPointer, name: 'revision13_edit_probe', value: { type: 'label', text: '検査', offset: [2, 3] } } },
      { name: 'ビーコン子要素の継承を解除', operation: { type: 'inherit', path: target.path, pointer: target.pointer, baseRef: null } },
      { name: 'ビーコン子要素を連鎖削除', operation: { type: 'delete', path: target.path, pointer: target.pointer, cascade: true } },
    ];
    for (const item of operations) {
      started = performance.now();
      const result = editWorkspace({ documents, expectedRevision: beforeRevision, operation: item.operation });
      const unchanged = workspaceRevision(documents) === beforeRevision;
      const oneFile = result.changes?.length === 1 && result.changes[0].path === target.path;
      const roundTrip = result.ok && editWorkspace({ documents: result.documents, operation: { type: 'replaceText', path: target.path, text: result.changes[0].before } });
      report.checks.push({ name: item.name, validation_status: result.ok && unchanged && oneFile && roundTrip.ok && roundTrip.revision === beforeRevision ? 'PASS' : 'FAIL',
        duration_ms: performance.now() - started, code: result.code, unchangedOriginal: unchanged, onlySelectedFileChanged: oneFile,
        exactUndo: roundTrip?.revision === beforeRevision, deletedElements: result.deletePlan?.count, heapBytes: process.memoryUsage().heapUsed });
      console.log(JSON.stringify({ name: item.name, validation_status: report.checks.at(-1).validation_status }));
    }
    const invalid = editWorkspace({ documents, operation: { type: 'replaceText', path: target.path, text: '{ broken JSONC' } });
    report.checks.push({ name: '不正な直接編集の拒否と原文保持', validation_status: !invalid.ok && invalid.previewAllowed === false && workspaceRevision(documents) === beforeRevision ? 'PASS' : 'FAIL', code: invalid.code });
    report.validation_status = report.checks.every(check => check.validation_status === 'PASS') ? 'PASS' : 'FAIL';
  } catch (error) {
    report.validation_status = 'FAIL';
    report.error = /^[A-Z][A-Z0-9_]+$/u.test(error.message) ? error.message : 'VERIFICATION_FAILED';
    console.error(JSON.stringify({ code: report.error, message: '原文編集検査を完了できませんでした。' }));
  }
  report.finished_at = new Date().toISOString();
  try { await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
  catch (error) {
    console.error(JSON.stringify({ code: error.code === 'EEXIST' ? 'REPORT_ALREADY_EXISTS' : 'REPORT_WRITE_FAILED',
      message: error.code === 'EEXIST' ? '検査結果の保存先が存在するため上書きしませんでした。別名で実行してください。' : '検査結果を保存できませんでした。' }));
    process.exitCode = 1;
  }
  if (report.validation_status !== 'PASS') process.exitCode = 1;
}
