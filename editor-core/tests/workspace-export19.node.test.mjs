import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceExportDiagnosticSummary, renderWorkspaceExportReport } from '../src/ui/workspace-export-report.js';
import { setSiteLocale } from '../src/i18n/site-messages.js';
import { sanitizeDiagnosticEntry, buildDiagnosticsSnapshot } from '../src/diagnostics/log-export.js';

const response = () => ({ ok: false, plan: { schema: 'jsonui-workspace-export-plan/v1', ok: false,
  unresolved: [{ code: 'EXPORT_UI_SYMBOL_MISSING', reference: 'popup_dialog.modal_first_button' }],
  warnings: Array.from({ length: 47 }, (_, i) => ({ code: 'EXPORT_ENGINE_TEXT_BINDING_DEPENDENCY', reference: '#text_' + i })),
  files: [], selectedDefinitions: [], engineFactoryProof: { method: 'pinned-reachable-definitions-v1',
    sourceCommit: 'test-source', verified: false, factory: { definition: 'common.screen_panel', path: 'ui/ui_common.json', matches: true },
    branches: [{ definition: 'storage_management_popup.storage_dependency_modal', used: true, verified: false,
      checks: [{ code: 'DEPENDENCY_CHANGED_NOT_INCLUDED', definition: '<img onerror=alert(1)>', path: 'ui/ui_common.json', changed: true, included: false }], omittedChecks: 0 }] } } });
const h = (tag, attrs, children) => ({ tag, attrs, children });
const allText = value => typeof value === 'string' ? value : (value?.children || []).map(allText).join(' ');

test('拒否した定義と変更状態を保持し、日英で文字列として表示する', () => {
  const result = response(), before = structuredClone(result);
  const summary = workspaceExportDiagnosticSummary(result);
  assert.equal(summary.engineFactoryProof.checks[0].changed, true);
  assert.equal(summary.engineFactoryProof.checks[0].included, false);
  try {
    for (const [locale, title] of [['ja_JP', '標準ダイアログの依存確認'], ['en_US', 'Standard dialog dependency checks']]) {
      setSiteLocale(locale); const output = renderWorkspaceExportReport(h, result), content = allText(output);
      assert(content.includes(title)); assert(content.includes('DEPENDENCY_CHANGED_NOT_INCLUDED'));
      assert(content.includes('<img onerror=alert(1)>')); assert(!JSON.stringify(output).includes('innerHTML'));
    }
  } finally { setSiteLocale('ja_JP'); }
  assert.deepEqual(result, before);
});

test('診断ログの47警告を20件と省略27件にし、構造確認も有界かつ省略数を正確に保持する', () => {
  const result = response();
  const branch = result.plan.engineFactoryProof.branches[0];
  branch.checks = Array.from({ length: 50 }, () => ({ code: 'X', path: 'p'.repeat(1000) })); branch.omittedChecks = 3;
  const summary = workspaceExportDiagnosticSummary(result, { maxIssues: 20 });
  assert.equal(summary.warningCount, 47); assert.equal(summary.warnings.length, 20); assert.equal(summary.omittedWarnings, 27);
  assert.equal(summary.engineFactoryProof.checks.length, 10);
  assert.equal(summary.engineFactoryProof.branches[0].omittedChecks, 43);
  assert.equal(summary.engineFactoryProof.checks[0].path.length, 512);
  result.plan.engineFactoryProof.branches[0].checks = 'invalid';
  assert.deepEqual(workspaceExportDiagnosticSummary(result).engineFactoryProof.checks, []);
});

test('実際の診断sanitizerを通しても変更した定義と拒否コードが残る', () => {
  const summary = workspaceExportDiagnosticSummary(response(), { maxIssues: 20 });
  const entry = sanitizeDiagnosticEntry({ level: 'error', message: 'export failed', data: { export: summary } });
  const proof = entry.data.export.engineFactoryProof;
  assert.equal(proof.checks[0].code, 'DEPENDENCY_CHANGED_NOT_INCLUDED');
  assert.equal(proof.checks[0].definition, '<img onerror=alert(1)>');
  assert.equal(proof.checks[0].path, 'ui/ui_common.json');
  assert.equal(proof.checks[0].changed, true); assert.equal(proof.checks[0].included, false);
  assert.equal(entry.data.export.warnings.length, 20); assert.equal(entry.data.export.omittedWarnings, 27);
  const snapshot = buildDiagnosticsSnapshot({ context: { workspace: { export: summary } }, entries: [entry] });
  assert.equal(snapshot.document.context.workspace.export.engineFactoryProof.checks[0].code, 'DEPENDENCY_CHANGED_NOT_INCLUDED');
  assert.equal(snapshot.document.entries[0].data.export.engineFactoryProof.checks[0].definition, '<img onerror=alert(1)>');
});

test('参照に到達したが検証に失敗した枝も理由欄に表示する', () => {
  const result = response();
  Object.assign(result.plan.engineFactoryProof.branches[0], { used: false, considered: true });
  assert(allText(renderWorkspaceExportReport(h, result)).includes('DEPENDENCY_CHANGED_NOT_INCLUDED'));
  result.plan.engineFactoryProof.branches[0].considered = false;
  const view = renderWorkspaceExportReport(h, result);
  assert(!view.children.some(child => child?.tag === 'details' && allText(child.children[0]).includes('標準ダイアログの依存確認')));
});
