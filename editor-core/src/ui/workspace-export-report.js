import { workspaceExportDetail, EXPORT_DETAIL_NOTICE } from './workspace-export-detail.js';
import { siteText } from '../i18n/site-messages.js';

// Pure report formatting shared by the HTTP boundary, controller and UI.
// Never evaluate or translate strings authored inside the resource pack.
const text = value => typeof value === 'string' ? value.slice(0, 512) : '';
export function workspaceExportPlan(result) {
  const plan = result?.plan;
  return plan?.schema === 'jsonui-workspace-export-plan/v1' && Array.isArray(plan.unresolved)
    && Array.isArray(plan.warnings) ? plan : null;
}

function engineFactorySummary(proof) {
  if (!proof || typeof proof !== 'object' || !Array.isArray(proof.branches)) return null;
  const flatChecks = [];
  return { method: text(proof.method), sourceCommit: text(proof.sourceCommit), verified: proof.verified === true,
    factory: { definition: text(proof.factory?.definition), path: text(proof.factory?.path),
      matches: proof.factory?.matches === true, reason: text(proof.factory?.reason) },
    branches: proof.branches.slice(0, 2).map((branch, index) => {
      const checks = Array.isArray(branch?.checks) ? branch.checks : [];
      const omitted = Number.isSafeInteger(branch?.omittedChecks) && branch.omittedChecks > 0 ? branch.omittedChecks : 0;
      flatChecks.push(...checks.slice(0, 10).map(row => ({ branchIndex: index, code: text(row?.code), definition: text(row?.definition),
        path: text(row?.path), reference: text(row?.reference), reason: text(row?.reason),
        changed: row?.changed === true, included: row?.included === true, matches: row?.matches === true })));
      return { definition: text(branch?.definition), used: branch?.used === true, considered: branch?.considered === true, verified: branch?.verified === true,
        branchIndex: index, omittedChecks: omitted + Math.max(0, checks.length - 10) };
    }), checks: flatChecks, omittedBranches: Math.max(0, proof.branches.length - 2) };
}

export function workspaceExportDiagnosticSummary(result, options = {}) {
  const plan = workspaceExportPlan(result);
  if (!plan) return null;
  const maxIssues = Number.isInteger(options?.maxIssues) ? Math.max(1, Math.min(100, options.maxIssues)) : 100;
  const issues = rows => rows.slice(0, maxIssues).map(row => ({ code: text(row?.code),
    path: text(row?.path || row?.sourcePath), jsonPath: text(row?.jsonPath),
    reference: text(row?.reference || row?.qualifiedName || row?.renderer), reason: text(row?.reason) }));
  return { ok: result.ok !== false && plan.ok === true,
    unresolvedCount: plan.unresolved.length, warningCount: plan.warnings.length,
    fileCount: Array.isArray(plan.files) ? plan.files.length : 0,
    selectedDefinitionCount: Array.isArray(plan.selectedDefinitions) ? plan.selectedDefinitions.length : 0,
    selectedDefinitions: (Array.isArray(plan.selectedDefinitions) ? plan.selectedDefinitions : []).slice(0, Math.min(64, maxIssues)).map(row => ({
      sourceId: text(row?.sourceId), filePath: text(row?.filePath), rawKey: text(row?.rawKey), qualifiedName: text(row?.qualifiedName),
    })),
    unresolved: issues(plan.unresolved), warnings: issues(plan.warnings),
    omittedUnresolved: Math.max(0, plan.unresolved.length - maxIssues), omittedWarnings: Math.max(0, plan.warnings.length - maxIssues),
    engineFactoryProof: engineFactorySummary(plan.engineFactoryProof),
    entryPointPreservation: (Array.isArray(plan.entryPointPreservation) ? plan.entryPointPreservation : []).slice(0, 16).map(row => ({
      definition: text(row?.definition), path: text(row?.path), authoredKey: text(row?.authoredKey), exportedKey: text(row?.exportedKey),
      method: text(row?.method), deviceValidation: text(row?.deviceValidation),
      preservedProperties: (Array.isArray(row?.preservedProperties) ? row.preservedProperties : []).slice(0, 32).map(item => ({
        property: text(item?.property), authoredNamespace: text(item?.authoredNamespace),
      })),
    })),
    omittedEntryPoints: Math.max(0, (plan.entryPointPreservation?.length || 0) - 16),
    runtimeTextOverrideRetention: plan.runtimeTextOverrideRetention ? {
      policy: text(plan.runtimeTextOverrideRetention.policy),
      files: Number.isSafeInteger(plan.runtimeTextOverrideRetention.files) ? plan.runtimeTextOverrideRetention.files : null,
      paths: (Array.isArray(plan.runtimeTextOverrideRetention.paths) ? plan.runtimeTextOverrideRetention.paths : []).slice(0, 32).map(text),
      omittedPaths: Math.max(0, (plan.runtimeTextOverrideRetention.paths?.length || 0) - 32),
    } : null,
  };
}

export function workspaceExportError(result, correlationId) {
  const plan = workspaceExportPlan(result);
  const unresolved = plan?.unresolved || [];
  const error = result?.error;
  const code = unresolved.length || plan?.ok === false ? 'WORKSPACE_EXPORT_UNRESOLVED'
    : text(typeof error === 'string' ? error : error?.code) || 'WORKSPACE_EXPORT_RESPONSE_INVALID';
  const message = unresolved.length ? siteText`書き出しを中止しました。未解決の依存関係が ${unresolved.length} 件あります。下の一覧を確認してください。`
    : text(typeof error === 'string' ? error : error?.message) || siteText('書き出し結果を取得できませんでした。依存範囲を検査して詳細を確認してください。');
  return Object.assign(new Error(message), { code, ...(plan ? { exportResult: result } : {}),
    ...(correlationId ? { correlation_id: correlationId } : {}) });
}

function issueHint(code) {
  if (/MISSING|NOT_FOUND/u.test(code)) return siteText('参照先を含むパックを読み込むか、原文の参照名を確認してください。');
  if (/LIMIT/u.test(code)) return siteText('依存関係の検査上限に達しました。対象と診断コードを確認してください。');
  if (/CONFLICT|AMBIGUOUS|SHADOWED/u.test(code)) return siteText('同名定義またはパックの優先順位を確認してください。');
  return siteText('この参照を静的に確定できません。対象の原文と診断コードを確認してください。');
}

export function renderWorkspaceExportReport(h, result) {
  const summary = workspaceExportDiagnosticSummary(result);
  if (!summary) return '';
  const detail = workspaceExportDetail(result, summary);
  const rows = (items, hints) => h('ul', {}, items.map(row => h('li', {}, [
    h('code', {}, [row.code]),
    row.path ? h('div', {}, [row.path + (row.jsonPath ? ` · ${row.jsonPath}` : '')]) : '',
    row.reference ? h('div', {}, [siteText`参照: ${row.reference}`]) : '',
    row.reason ? h('div', {}, [row.reason]) : '',
    hints ? h('p', { class: 'hint' }, [issueHint(row.code)]) : '',
  ])));
  const proof = summary.engineFactoryProof;
  const usedBranches = proof?.branches.filter(branch => branch.used || branch.considered) || [];
  return h('div', { class: 'workspace-export-result' }, [
    h('p', { role: 'status' }, [summary.ok ? siteText`依存範囲の検査が完了しました。${summary.fileCount} ファイルを書き出します。`
      : siteText`書き出しを止めている問題: ${summary.unresolvedCount} 件`]),
    rows(summary.unresolved, true),
    summary.omittedUnresolved ? h('p', {}, [siteText`一覧は先頭100件です。残り ${summary.omittedUnresolved} 件は省略されています。`]) : '',
    summary.warningCount ? h('details', {}, [h('summary', {}, [siteText`注意事項: ${summary.warningCount} 件`]), rows(summary.warnings, false)]) : '',
    usedBranches.length ? h('details', { open: !proof.verified }, [
      h('summary', {}, [siteText('標準ダイアログの依存確認')]),
      !proof.factory.matches && proof.factory.reason ? h('p', {}, [proof.factory.path, ' · ', proof.factory.reason]) : '',
      ...usedBranches.map(branch => h('div', {}, [
        h('code', {}, [branch.definition]),
        h('p', {}, [branch.verified ? siteText('必要な変更と素材を確認し、ゲーム側の定義への参照を維持します。')
          : siteText('変更や参照を確認できないため、この定義の依存関係を追加で検査しています。下の理由を確認してください。')]),
        rows(proof.checks.filter(row => row.branchIndex === branch.branchIndex).map(row => ({ ...row, reference: row.reference || row.definition })), false),
        branch.omittedChecks ? h('p', {}, [siteText`確認項目は各定義の先頭10件です。残り ${branch.omittedChecks} 件は省略されています。`]) : '',
      ])),
    ]) : '',
    h('details', {}, [h('summary', {}, [siteText('書き出し検査の詳細')]),
      h('p', { class: 'hint' }, [siteText(EXPORT_DETAIL_NOTICE)]),
      h('pre', { class: 'workspace-export-report' }, [detail.text])]),
  ]);
}
