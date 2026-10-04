import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CliClient } from '../cli-client.mjs';
import { parseEditableJsonc } from '../workspace-jsonc.mjs';
import { compileWorkspacePending23 } from '../../editor-core/src/ui/workspace-pending-additions23.js';
import { createWorkspaceDraftPreview23 } from '../../editor-core/src/ui/workspace-draft-preview23.js';

const input = process.env.JSONUI_REAL_ANVIL_PACK23;
const output = process.env.JSONUI_REAL_ANVIL_REPORT23;
const seed = 0x23A11E;
const preview = { variables: { $desktop_screen: true, $pocket_screen: false } };
const frameInput = { generation: 1, preset: { width: 480, height: 270 }, animationTime: 0, visibilityMode: 'safe' };
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
const summary = error => ({ code: error?.code || error?.name || 'ERROR', message: String(error?.message || error).slice(0, 3000) });
const delayTurn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { resolve, reject, promise }; };
const same = (value, expected, label) => assert.equal(digest(value), digest(expected), label);
const frameValue = frame => ({ boxes: frame.layout.boxes, scroll: frame.layout.scrollMetaById,
  props: frame.propsById, baseProps: frame.basePropsById });
const historyValue = state => ({ revision: state.revision, canUndo: state.canUndo, canRedo: state.canRedo,
  editCount: state.editCount, undoCount: state.undoCount, redoCount: state.redoCount });

function runtimeFields(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    if (['bindings', 'button_mappings', 'property_bag', 'collection_name'].includes(key)) result.push([key, digest(child)]);
    else if (child && typeof child === 'object') runtimeFields(child, result);
  }
  return result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function addedValues(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'pending_probe23') result.push(child);
    else if (child && typeof child === 'object') addedValues(child, result);
  }
  return result;
}

function rawDefinitionsPreserved(before, after, except) {
  for (const [filename, text] of Object.entries(before)) {
    const original = parseEditableJsonc(text), modified = parseEditableJsonc(after[filename]);
    for (const entry of original.entries) {
      if (`${filename}#${entry.key}` === except) continue;
      const next = modified.entries.find(item => item.key === entry.key);
      assert(next, `既存定義消失: ${filename}#${entry.key}`);
      assert.equal(after[filename].slice(next.node.start, next.node.end), text.slice(entry.node.start, entry.node.end),
        `選択画面以外の既存定義変更: ${filename}#${entry.key}`);
    }
  }
}

function casesFor(projection) {
  const targets = [
    ['title-label', '/title_label', false, '子・翻訳ラベル'],
    ['anvil-icon', '/anvil_icon', false, '子・画像'],
    ['cost-binding', '/cost_label_0', true, '子・text/visible binding'],
    ['same-gray', '/cost_label_0/controls/0/gray', false, '別親に同名・共有2個'],
    ['text-edit-parent', '/text_edit_control', true, '親・入力操作・多段継承'],
    ['clear-button', '/clear_text_button', true, '共通ファイル・clip内のボタン'],
    ['repeated-container', '/input_item_slot/controls/0/container_item', true, '共有3個・スロット入力'],
    ['root-parent', '/root_panel', false, '親・画面全体・子孫操作'],
  ];
  let state = seed;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  return targets.flatMap(([name, suffix, binding, relationship], targetIndex) => {
    const match = Object.entries(projection.nodeSources).find(([pointer]) => pointer.endsWith(suffix));
    assert(match, `実添付に対象が必要: ${name}`);
    const [effectivePointer, source] = match;
    return ['screen', 'shared'].flatMap(scope => ['visual', 'interaction'].flatMap(targetMode => [-1, 1].map(sign => ({
      id: `${name}-${scope}-${targetMode}-${sign < 0 ? 'negative' : 'positive'}`,
      targetIndex, name, effectivePointer, source, binding, relationship, scope, targetMode,
      delta: [sign * (3 + next() % 17), -sign * (2 + next() % 11)],
      anchor: ['top_left', 'center', 'bottom_right'][next() % 3], alpha: (2 + next() % 7) / 10,
    }))));
  });
}

function operationsFor(item, screen, sourceId, number, previewOptions = preview) {
  const common = { path: item.source.path, pointer: item.source.pointer, sourceId,
    screen, scope: item.scope, targetMode: item.targetMode, effectivePointer: item.effectivePointer,
    generatedScope: 'template', preview: previewOptions };
  const first = { ...common, type: 'move', delta: item.delta };
  const operations = [first,
    { ...common, type: 'set', property: 'alpha', value: item.alpha },
    { ...common, type: 'set', property: 'anchor_from', value: item.anchor },
    { ...common, type: 'set', property: 'anchor_to', value: item.anchor },
    { ...common, type: 'move', delta: item.delta.map(number => -number / 4) }];
  if (item.scope === 'shared') {
    // 同名でも親が異なる二つの原文追加。追加への後続編集は通常 add 一つへ畳む。
    const entries = operations.map(operation => ({ operation }));
    for (const [index, parentPointer] of ['/anvil_icon_panel', '/title_panel'].entries()) {
      const id = `case-${number}-added-${index}`;
      entries.push({ pendingAdditionId: id, operation: { type: 'add', path: 'ui/anvil_screen.json', sourceId,
        parentPointer, name: 'pending_probe23', value: { type: 'label', size: [18 + index, 9],
          offset: [index + 1, 2], anchor_from: item.anchor, anchor_to: item.anchor, text: `初期${index}` } } });
      entries.push({ pendingAdditionId: id, pendingAdditionEdit: true, operation: { type: 'move', delta: [index ? -3 : 4, number % 7] } });
      entries.push({ pendingAdditionId: id, pendingAdditionEdit: true, operation: { type: 'set', property: 'text', value: `追加${index}・${number}` } });
    }
    return { first, operations: compileWorkspacePending23(entries) };
  }
  return { first, operations };
}

test('実添付金床: 64組の草稿複合操作・原文確定・取消世代・undo/redo',
  { timeout: 3900000, skip: !input && 'JSONUI_REAL_ANVIL_PACK23 を明示した監査実行専用' }, async t => {
  const result = { schema: 'jsonui-real-anvil-draft-audit23-v1', seed, maximumCases: 64,
    startedAt: new Date().toISOString(), input: null, baseline: null, cases: [], generations: [], status: 'RUNNING' };
  const began = performance.now(), client = await CliClient.start({ signal: AbortSignal.timeout(3800000) });
  const call = (action, payload) => client.request(`/api/node/${action}`, { payload, timeout: 45000 });
  try {
    const pack = await client.importPack(input);
    result.input = { name: pack.source.name, bytes: pack.source.size_bytes, sha256: pack.source.checksum_sha256 };
    const workspace = await call('workspace-open', { sources: [{ id: pack.id, kind: 'imported' }] });
    const workspaceId = workspace.workspaceId;
    const catalog = await call('workspace-catalog', { workspaceId });
    const selected = catalog.records.find(row => row.qualifiedName === 'anvil.anvil_screen');
    assert(selected, '添付の金床画面が必要');
    const screen = { path: selected.filePath, pointer: `/${selected.rawKey}`, sourceId: pack.id };
    const paths = [...new Set(workspace.nodes.map(node => node.path))].sort();
    const readTexts = async () => {
      const texts = {};
      // 全件を並列化すると queue=8 を超える。読取も有界にし、監査自身で過負荷を作らない。
      for (const path of paths) texts[path] = (await call('workspace-read', { workspaceId, path, sourceId: pack.id })).text;
      return texts;
    };
    const project = async (qualifiedName, knownCatalog = null, previewOptions = preview) => {
      const currentCatalog = knownCatalog || await call('workspace-catalog', { workspaceId });
      const record = currentCatalog.records.find(row => row.qualifiedName === qualifiedName); assert(record, qualifiedName);
      const projection = await call('project', { catalogId: currentCatalog.nodeCatalogId, recordId: record.id, ...previewOptions });
      const frame = await call('frame', { ...frameInput, projectionId: projection.nodeProjectionId, filePath: record.filePath });
      return { projection, frame };
    };
    const textsBefore = await readTexts(), base = await project('anvil.anvil_screen', catalog);
    const otherBefore = await project('anvil.top_half_panel', catalog);
    result.baseline = { revision: workspace.revision, fileCount: paths.length,
      sourceSha256: Object.fromEntries(Object.entries(textsBefore).map(([path, text]) => [path, digest(text)])),
      projectionSha256: digest(base.projection.document), frameSha256: digest(frameValue(base.frame)),
      runtimeFields: runtimeFields(base.projection.document),
      boxCount: base.frame.layout.boxes.length, sourceErrors: workspace.diagnostics.filter(row => row.severity === 'error'),
      projectionDiagnostics: base.projection.diagnostics, compareUi: 'anvil.top_half_panel' };
    if (process.env.JSONUI_REAL_ANVIL_RESUME23 === '1') {
      assert(output, '再開には結果 JSON が必要');
      const checkpoint = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(checkpoint.seed, seed); assert.equal(checkpoint.input.sha256, result.input.sha256);
      same(checkpoint.baseline.sourceSha256, result.baseline.sourceSha256, '再開前後の原本が一致');
      result.previousRuns = [...(checkpoint.previousRuns || []), { startedAt: checkpoint.startedAt, finishedAt: checkpoint.finishedAt || null,
        elapsedMs: checkpoint.elapsedMs || null, passed: checkpoint.cases.filter(row => row.status === 'PASS').length }];
      result.previousFailures = [...(checkpoint.previousFailures || []), ...checkpoint.cases.filter(row => row.status !== 'PASS')];
      result.priorInvariantCoverage = checkpoint.cases.filter(row => row.status === 'PASS' && !row.runtimeFieldsSha256).map(row => ({ id: row.id, note: '描画・原文・履歴は成功、追加した動作属性保存の検査は未実行' }));
      result.cases = checkpoint.cases.filter(row => row.status === 'PASS' && row.runtimeFieldsSha256); result.generations = checkpoint.generations || [];
    }
    if (output) await writeFile(output, JSON.stringify(result, null, 2));
    const planned = casesFor(base.projection); assert.equal(planned.length, 64);
    let clearButtonScenario = null;
    for (const [number, item] of planned.entries()) {
      if (performance.now() - began > 3600000) throw new Error('監査全体の有限上限に到達');
      if (result.cases.some(row => row.status === 'FAIL')) break;
      if (result.cases.some(row => row.id === item.id && row.status === 'PASS')) continue;
      await t.test(item.id, async () => {
        const row = { id: item.id, factors: item, status: 'RUNNING', stage: '準備' }, start = performance.now();
        result.cases.push(row);
        try {
          // 原本ではクリアボタンの親が静的非表示で、子の変数解釈は意図的に省略される。
          // この対象だけ明示した表示シナリオを使い、同じ条件の基準・草稿・確定を比較する。
          const casePreview = item.name === 'clear-button'
            ? { variables: { ...preview.variables, $text_clear_button_enabled: true } } : preview;
          if (item.name === 'clear-button' && !clearButtonScenario) {
            clearButtonScenario = { base: await project('anvil.anvil_screen', null, casePreview),
              other: await project('anvil.top_half_panel', null, casePreview) };
          }
          const caseBase = item.name === 'clear-button' ? clearButtonScenario.base : base;
          const caseOtherBefore = item.name === 'clear-button' ? clearButtonScenario.other : otherBefore;
          row.preview = casePreview;
          if (item.name === 'clear-button') row.scenarioBaseline = {
            projectionSha256: digest(caseBase.projection.document), frameSha256: digest(frameValue(caseBase.frame)),
            reason: '原本の非表示親を表示するプレビュー変数を明示。原文は変更しない。' };
          const status = await call('workspace-status', { workspaceId });
          assert.equal(status.revision, workspace.revision, '各ケースは原本 revision から開始');
          const { first, operations } = operationsFor(item, screen, pack.id, number, casePreview);
          row.operations = operations.map(({ sourceId, ...operation }) => operation);
          const draftInput = { workspaceId, expectedRevision: status.revision, pendingVersion: number * 4 + 1,
            screen, ...casePreview, frame: frameInput, operation: { type: 'batch', pointerBasis: 'base-revision', operations: [first] } };
          row.timings ||= {}; row.timings[row.stage] = Math.round(performance.now() - start);
          row.stage = '移動草稿'; console.log(item.id, row.stage);
          const firstDraft = await call('workspace-preview-draft', draftInput);
          assert.equal(firstDraft.ok, true, JSON.stringify({ code: firstDraft.code, message: firstDraft.message,
            diagnostics: firstDraft.diagnostics?.slice(0, 3), batch: firstDraft.batch }));
          row.timings ||= {}; row.timings[row.stage] = Math.round(performance.now() - start);
          row.stage = '複合草稿'; console.log(item.id, row.stage);
          const compoundInput = { ...draftInput, pendingVersion: draftInput.pendingVersion + 1,
            operation: { ...draftInput.operation, operations } };
          const draft = await call('workspace-preview-draft', compoundInput);
          assert.equal(draft.ok, true, JSON.stringify({ code: draft.code, message: draft.message,
            diagnostics: draft.diagnostics?.slice(0, 3), batch: draft.batch }));
          same(await readTexts(), textsBefore, '草稿は原文を変更しない');
          same(historyValue(await call('workspace-status', { workspaceId })), historyValue(status), '草稿は履歴を変更しない');
          assert.notEqual(digest(draft.projection.document), digest(firstDraft.projection.document), '複合属性が草稿に反映する');
          if (item.scope === 'shared') {
            const additions = draft.frame.layout.boxes.filter(box => box.id.endsWith('/pending_probe23'));
            assert.equal(additions.length, 2, '親が異なる同名追加を両方表示');
            assert.equal(new Set(additions.map(box => box.parentId)).size, 2);
            const values = addedValues(draft.projection.document);
            assert.equal(values.length, 2);
            for (const index of [0, 1]) {
              const value = values.find(value => value.text === `追加${index}・${number}`); assert(value, '親ごとの追加文字を保持');
              assert.deepEqual(value.offset, [index ? -1 : 5, 2 + number % 7], '追加の後続移動が親を取り違えない');
            }
          }
          same(runtimeFields(draft.projection.document), runtimeFields(caseBase.projection.document), '継承したbindings・button mappings・property bag・collectionを保持');
          row.runtimeFieldsSha256 = digest(runtimeFields(draft.projection.document));
          row.draft = { projectionSha256: digest(draft.projection.document), frameSha256: digest(frameValue(draft.frame)),
            boxCount: draft.frame.layout.boxes.length, batchCount: draft.batch.appliedCount };
          row.timings ||= {}; row.timings[row.stage] = Math.round(performance.now() - start);
          row.stage = '確定と一致'; console.log(item.id, row.stage);
          const applied = await call('workspace-edit', { workspaceId, expectedRevision: status.revision, operation: compoundInput.operation });
          assert.equal(applied.ok, true, JSON.stringify({ code: applied.code, batch: applied.batch }));
          const final = await project('anvil.anvil_screen', null, casePreview), afterTexts = await readTexts();
          same(final.projection.document, draft.projection.document, '草稿と原文確定後の解釈が一致');
          same(frameValue(final.frame), frameValue(draft.frame), '全box・clip・有効属性が一致');
          const otherAfter = await project('anvil.top_half_panel', null, casePreview);
          if (item.scope === 'screen') {
            rawDefinitionsPreserved(textsBefore, afterTexts, `${screen.path}#${selected.rawKey}`);
            same(otherAfter.projection.document, caseOtherBefore.projection.document, '他UIは原本から不変');
            same(frameValue(otherAfter.frame), frameValue(caseOtherBefore.frame), '他UIのlayout・属性も不変');
          } else {
            const permitted = new Set([...operations.map(operation => operation.path)]);
            for (const [path, text] of Object.entries(afterTexts)) if (!permitted.has(path)) assert.equal(text, textsBefore[path], `共有対象外ファイル: ${path}`);
            assert.notEqual(digest(otherAfter.projection.document), digest(caseOtherBefore.projection.document), '明示sharedの追加は共有プレビューへ届く');
          }
          row.applied = { revision: applied.revision, projectionSha256: digest(final.projection.document),
            frameSha256: digest(frameValue(final.frame)), otherUiChanged: digest(otherAfter.projection.document) !== digest(caseOtherBefore.projection.document),
            modifiedFiles: paths.filter(path => textsBefore[path] !== afterTexts[path]) };
          row.timings ||= {}; row.timings[row.stage] = Math.round(performance.now() - start);
          row.stage = 'undo/redo'; console.log(item.id, row.stage);
          const undone = await call('workspace-undo', { workspaceId, expectedRevision: applied.revision });
          same(await readTexts(), textsBefore, 'undoで全原文が完全一致'); assert.equal(undone.revision, workspace.revision);
          const redone = await call('workspace-redo', { workspaceId, expectedRevision: undone.revision });
          same(await readTexts(), afterTexts, 'redoで全確定原文が完全一致'); assert.equal(redone.revision, applied.revision);
          const redoneView = await project('anvil.anvil_screen', null, casePreview);
          same(frameValue(redoneView.frame), frameValue(final.frame), 'redoで描画も一致');
          await call('workspace-undo', { workspaceId, expectedRevision: redone.revision });
          if (number % 8 === 0) {
            row.timings ||= {}; row.timings[row.stage] = Math.round(performance.now() - start);
          row.stage = '取消と新世代';
            let snapshot = draftInput, first = true;
            const arrived = deferred(), release = deferred(), ready = deferred();
            const scheduler = createWorkspaceDraftPreview23({ readSnapshot: () => snapshot, delayMs: 0, timeoutMs: 45000,
              project: async payload => {
                let reply;
                try { reply = await call('workspace-preview-draft', payload); }
                catch (error) { arrived.reject(error); throw error; }
                if (first) { first = false; arrived.resolve(); await release.promise; }
                return reply;
              }, onChange: (state, kind) => {
                if (kind === 'draft-ready') ready.resolve();
                if (kind === 'draft-error') { arrived.reject(Object.assign(new Error(state.error.message), state.error)); ready.reject(Object.assign(new Error(state.error.message), state.error)); }
              } });
            ready.promise.catch(() => {});
            const cancelled = scheduler.flush();
            await Promise.race([arrived.promise, new Promise((_, reject) => {
              const timer = setTimeout(() => reject(new Error('旧世代応答の有限期限超過')), 45000); timer.unref();
            })]); scheduler.cancel();
            snapshot = { ...compoundInput, pendingVersion: compoundInput.pendingVersion + 1 };
            scheduler.flush(); release.resolve(); await cancelled;
            await Promise.race([ready.promise, new Promise((_, reject) => {
              const timer = setTimeout(() => reject(new Error('新世代の有限期限超過')), 45000); timer.unref();
            })]);
            await delayTurn();
            const selectedResult = scheduler.getResult(); assert(selectedResult);
            assert.equal(selectedResult.pendingVersion, snapshot.pendingVersion);
            same(selectedResult.projection.document, draft.projection.document, '取消後は最新草稿のみを採用');
            result.generations.push({ target: item.name, status: scheduler.getStatus(),
              adoptedVersion: selectedResult.pendingVersion, discardedVersion: draftInput.pendingVersion });
            scheduler.cancel();
          }
          row.status = 'PASS'; row.stage = '完了';
        } catch (error) {
          row.status = 'FAIL'; row.error = summary(error);
          console.error(JSON.stringify({ case: row.id, stage: row.stage, error: row.error }));
          if (output) await writeFile(output, JSON.stringify(result, null, 2));
          throw error;
        }
        finally {
          row.elapsedMs = Math.round(performance.now() - start);
          // 失敗時も次の実験へ確定変更を持ち越さない。復旧上限は 2 回。
          for (let attempt = 0; attempt < 2; attempt++) {
            const current = await call('workspace-status', { workspaceId });
            if (current.revision === workspace.revision) break;
            assert.equal(current.canUndo, true, '失敗後の原文復旧が可能');
            await call('workspace-undo', { workspaceId, expectedRevision: current.revision });
          }
          same(await readTexts(), textsBefore, 'ケース終端で全原文を復旧');
          if (output) await writeFile(output, JSON.stringify(result, null, 2));
        }
      });
    }
    assert.equal(createHash('sha256').update(await readFile(input)).digest('hex'), result.input.sha256, '添付原本のSHA-256が不変');
    result.status = result.cases.length === 64 && result.cases.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL';
  } catch (error) { result.status = 'FAIL'; result.error = summary(error); throw error; }
  finally {
    result.finishedAt = new Date().toISOString(); result.elapsedMs = Math.round(performance.now() - began);
    result.summary = { passed: result.cases.filter(row => row.status === 'PASS').length,
      failed: result.cases.filter(row => row.status === 'FAIL').length, generations: result.generations.length };
    if (output) await writeFile(output, JSON.stringify(result, null, 2));
    await client.close();
  }
});
