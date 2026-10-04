import { siteText, translateSiteMessage } from '../i18n/site-messages.js';

// ブラウザ用。移動の意味と適用範囲を保持する。解釈・複製・offset 計算は Node が行う。
const GEOMETRY_PROPERTIES = new Set(['offset', 'size', 'min_size', 'max_size', 'anchor_from', 'anchor_to']);
const MODES = new Set(['interaction', 'visual']);
const SCOPES = new Set(['screen', 'shared']);
function fail(code, message) { throw Object.assign(new Error(message || code), { code }); }
export const workspaceEditSelectionIdentity = selection => JSON.stringify(selection ? [selection.fileId, selection.previewDefinitionId,
  selection.nodeId, selection.sourceId, selection.path, selection.pointer, selection.effectivePointer, selection.screen, selection.preview] : null);

/** プレビューの選択情報を API 契約へ変換する。原文の文字列やキーを翻訳しない。 */
export function workspacePreviewEditOperation(state, change = { type: 'move' }) {
  const selected = state.previewSelection;
  if (!selected?.screen?.path || !selected.screen.pointer || !selected.effectivePointer
    || selected.pointer !== state.selectedPointer || selected.path !== state.activePath
    || String(selected.sourceId || '') !== String(state.activeSourceId || '')) {
    fail('WORKSPACE_PREVIEW_EDIT_SELECTION_REQUIRED', siteText('プレビューで編集対象を選び直してください。画面と原文の対応を確認してから変更します。'));
  }
  if (!['move', 'set'].includes(change.type)) fail('WORKSPACE_PREVIEW_EDIT_INVALID');
  const scope = SCOPES.has(state.editScope) ? state.editScope : 'screen';
  const targetMode = change.type === 'set' && !GEOMETRY_PROPERTIES.has(change.property) ? 'visual'
    : MODES.has(state.editTargetMode) ? state.editTargetMode : 'visual';
  return { ...change, path: selected.path, pointer: selected.pointer, sourceId: selected.sourceId,
    screen: { ...selected.screen }, effectivePointer: selected.effectivePointer, scope, targetMode,
    ...(selected.preview ? { preview: selected.preview } : {}),
    ...(state.editGeneratedTemplate ? { generatedScope: 'template' } : {}) };
}

/** 説明 API の独立したライフサイクル。計画だけの取得で旧プレビューを無効化しない。 */
export function createWorkspaceEditIntent({ state, request, notify }) {
  let generation = 0, abort = null, pending = null, pendingKey = '';
  const identity = () => JSON.stringify([state.workspaceId, state.revision, state.mode, state.editScope, state.editTargetMode,
    workspaceEditSelectionIdentity(state.previewSelection)]);
  const consentIdentity = plan => plan ? JSON.stringify([identity(), plan.target, plan.generated, plan.affectedInstances, plan.affectedEffectivePointers, plan.affectedScreens, plan.scopeCertainty]) : '';
  function invalidate({ keepConsent = false } = {}) {
    generation++; abort?.abort(); abort = null; pending = null; pendingKey = '';
    state.editPlan = null; state.editPlanKey = ''; state.editPlanBusy = false; state.editPlanError = '';
    if (!keepConsent) { state.editGeneratedTemplate = false; state.editTemplateConsentKey = ''; }
  }
  const api = {
    invalidate,
    setOptions(options) {
      if (state.busy) fail('WORKSPACE_BUSY', siteText('処理中です。完了してから操作してください。'));
      if (options.scope !== undefined && !SCOPES.has(options.scope)) fail('WORKSPACE_EDIT_SCOPE_INVALID');
      if (options.targetMode !== undefined && !MODES.has(options.targetMode)) fail('WORKSPACE_EDIT_TARGET_INVALID');
      if (options.scope !== undefined && options.scope !== state.editScope
        && (state.pendingOperations?.length || state.pendingCommitUncertain)) {
        fail('WORKSPACE_PENDING_SCOPE_CHANGE', siteText('未反映の変更を反映するか破棄してから、適用する UI の範囲を切り替えてください。共有元とこの UI 専用の変更が混在するのを防ぎます。'));
      }
      if (options.scope === state.editScope && options.targetMode === state.editTargetMode) return;
      invalidate();
      if (options.scope !== undefined) state.editScope = options.scope;
      if (options.targetMode !== undefined) state.editTargetMode = options.targetMode;
      state.addType = '';
      state.lastHistoryAction = null;
      state.propertyInputs?.clear();
      notify('edit-options');
    },
    setGeneratedTemplate(checked) {
      state.editGeneratedTemplate = checked === true && Boolean(state.editPlan);
      state.editTemplateConsentKey = state.editGeneratedTemplate ? consentIdentity(state.editPlan) : '';
      notify('edit-consent');
    },
    async plan(change = { type: 'move' }) {
      if (state.busy) fail('WORKSPACE_BUSY', siteText('処理中です。完了してから操作してください。'));
      const operation = workspacePreviewEditOperation(state, change);
      const ownIdentity = identity();
      // 移動量・値は Node の mutation が別途検証する。対象の事前計画は共有できる。
      // 同じ選択・適用範囲・実際の変更先なら、move と表示属性に原文の再解析は不要。
      // interaction の非配置属性は workspacePreviewEditOperation が visual に分離する。
      const key = JSON.stringify([ownIdentity, operation.targetMode]);
      if (state.editPlan && state.editPlanKey === key) return state.editPlan;
      if (pending && pendingKey === key) return pending;
      invalidate({ keepConsent: true });
      const ownGeneration = generation, controller = new AbortController(); abort = controller;
      state.editPlanBusy = true; pendingKey = key; notify('edit-plan-busy');
      const current = () => ownGeneration === generation && ownIdentity === identity();
      pending = (async () => {
        try {
          const result = await request('edit', { workspaceId: state.workspaceId, expectedRevision: state.revision,
            operation: { ...operation, type: 'planEdit', intendedType: operation.type } }, { signal: controller.signal });
          if (!current()) fail('WORKSPACE_SELECTION_SUPERSEDED');
          if (!result || result.ok === false) {
            const error = result?.error;
            fail(typeof error === 'object' ? error.code : error || result?.code || 'WORKSPACE_EDIT_PLAN_FAILED',
              typeof error === 'object' ? error.message : result?.diagnostics?.find(item => item.severity === 'error')?.message || error);
          }
          const plan = result.editPlan || result.result?.editPlan;
          if (!plan || typeof plan !== 'object' || !plan.target) fail('WORKSPACE_EDIT_PLAN_INVALID', siteText('編集対象を確認できませんでした。要素を選び直して再確認してください。'));
          if (state.editGeneratedTemplate && state.editTemplateConsentKey !== consentIdentity(plan)) {
            state.editGeneratedTemplate = false; state.editTemplateConsentKey = '';
          }
          state.editPlan = plan; state.editPlanKey = key; state.editPlanError = '';
          return plan;
        } catch (error) {
          if (!current() || controller.signal.aborted) fail('WORKSPACE_SELECTION_SUPERSEDED');
          state.editPlanError = String(error.message || error); throw error;
        } finally {
          if (current()) { state.editPlanBusy = false; pending = null; pendingKey = ''; abort = null; notify('edit-plan'); }
        }
      })();
      return pending;
    },
    async enqueue(change, edit) {
      // 選択直後のドラッグも、未完了の説明を待ってからキューへ入れる。
      // 取得済み計画は同じ選択で再利用し、個々の移動で再投影しない。
      const expectedIdentity = identity();
      const plan = await api.plan(change);
      if (expectedIdentity !== identity()) fail('WORKSPACE_SELECTION_SUPERSEDED');
      if ((plan.requiresTemplateConsent || plan.generated || Number(plan.affectedInstances) > 1)
        && (!state.editGeneratedTemplate || state.editTemplateConsentKey !== consentIdentity(plan))) {
        fail('WORKSPACE_GENERATED_SCOPE_REQUIRED', plan.generated ? siteText('このスロットは共通テンプレートから生成されています。現在の版では1枠だけの独立移動に未対応です。全体への適用に同意しても1枠だけの変更にはなりません。') : siteText('同じテンプレートを使う要素にも反映されます。編集対象の説明を確認し、テンプレート全体への適用にチェックしてからもう一度操作してください。'));
      }
      // 計画待ちの間に設定された同意も、確認した範囲のものだけを保存する。
      const operation = workspacePreviewEditOperation(state, change);
      const result = await edit(operation, { editPlan: plan });
      state.lastEditPlan = plan;
      return result;
    },
    async apply(change, edit) {
      const expectedIdentity = identity();
      const plan = await api.plan(change);
      if (expectedIdentity !== identity()) fail('WORKSPACE_SELECTION_SUPERSEDED');
      if ((plan.requiresTemplateConsent || plan.generated || Number(plan.affectedInstances) > 1)
        && (!state.editGeneratedTemplate || state.editTemplateConsentKey !== consentIdentity(plan))) {
        fail('WORKSPACE_GENERATED_SCOPE_REQUIRED', plan.generated ? siteText('このスロットは共通テンプレートから生成されています。現在の版では1枠だけの独立移動に未対応です。全体への適用に同意しても1枠だけの変更にはなりません。') : siteText('同じテンプレートを使う要素にも反映されます。編集対象の説明を確認し、テンプレート全体への適用にチェックしてからもう一度操作してください。'));
      }
      const operation = workspacePreviewEditOperation(state, change);
      const result = await edit(operation);
      state.lastEditPlan = plan;
      invalidate();
      return result;
    },
  };
  return api;
}

/** キャンバス／属性編集に共通の選択。直接 JSON 編集の契約とは分けて表示する。 */
export function renderWorkspaceEditPolicy(h, { controller, onError }) {
  const state = controller.state;
  const change = options => {
    try {
      controller.setEditOptions(options);
      if (state.previewSelection?.screen) void controller.planPreviewEdit().catch(onError);
    } catch (error) { onError?.(error); }
  };
  return h('fieldset', { class: 'workspace-edit-policy', disabled: state.busy, 'aria-describedby': 'workspace-edit-policy-help' }, [
    h('legend', {}, [siteText('Minecraftへ反映する編集範囲')]),
    h('div', { class: 'workspace-edit-policy-fields' }, [
      h('label', { for: 'workspace-edit-scope' }, [siteText('どの UI に反映するか'),
        h('select', { id: 'workspace-edit-scope', value: state.editScope || 'screen', disabled: Boolean(state.pendingOperations?.length || state.pendingCommitUncertain),
          title: state.pendingOperations?.length ? siteText('「JSON UIに確定」または「未確定の変更を破棄」の後で、適用範囲を切り替えられます。') : '', onChange: event => change({ scope: event.currentTarget.value }) }, [
          h('option', { value: 'screen' }, [siteText('この UI だけ')]),
          h('option', { value: 'shared' }, [siteText('共有元を編集（他の UI にも反映）')]),
        ]),
      ]),
      h('label', { for: 'workspace-edit-target' }, [siteText('移動・サイズ変更の対象'),
        h('select', { id: 'workspace-edit-target', value: state.editTargetMode || 'visual', onChange: event => change({ targetMode: event.currentTarget.value }) }, [
          h('option', { value: 'interaction' }, [siteText('操作要素全体（操作範囲も移動）')]),
          h('option', { value: 'visual' }, [siteText('見た目の部品だけ')]),
        ]),
      ]),
    ]),
    state.pendingOperations?.length ? h('p', { class: 'hint' }, [siteText('適用範囲は未反映の変更を反映・破棄した後で切り替えられます。')]) : '',
    h('p', { id: 'workspace-edit-policy-help', class: 'hint' }, [state.editTargetMode === 'visual'
      ? siteText('選択した表示部品を変更します。画像だけの編集ではMinecraftの操作位置は移動しません。親の操作要素を直接選択した場合は、その要素自身を変更します。')
      : siteText('Minecraftのボタン・入力欄・スロットの操作本体を、表示と一緒に移動します。サイト内の動作確認ON/OFFとは別です。生成スロット1枠の独立移動は対象外です。')]),
    state.editScope === 'shared' ? h('p', { class: 'workspace-scope-notice' }, [siteText('同じ共有元を使う他の UI にも変更が届きます。Pocket の共有元にも影響する場合があります。')]) : '',
    state.lastHistoryAction?.editPlan ? h('p', { class: 'hint', role: 'status' }, [siteText`履歴の編集範囲も復元しました: ${state.lastHistoryAction.editPlan.scope === 'screen' ? siteText('この UI だけ') : siteText('共有元を編集（他の UI にも反映）')} / ${state.lastHistoryAction.editPlan.targetMode === 'interaction' ? siteText('操作要素全体（操作範囲も移動）') : siteText('見た目の部品だけ')}`]) : '',
  ]);
}

const targetLabel = target => target ? `${target.rawKey || target.name || String(target.pointer || '').split('/').at(-1).replace(/~1/gu, '/').replace(/~0/gu, '~')}${target.type ? ` (${target.type})` : ''}` : '';
/** 選択画像と操作所有者を混同せず、反復テンプレートの適用を明示的に選ぶ。 */
export function renderWorkspaceEditPlan(h, { controller, onError }) {
  const state = controller.state, plan = state.editPlan;
  const refresh = () => void controller.planPreviewEdit().catch(onError);
  return h('section', { class: 'workspace-edit-plan', 'aria-label': siteText('実際に変更する要素'), 'aria-busy': String(Boolean(state.editPlanBusy)) }, [
    h('strong', {}, [siteText('実際に変更する要素')]),
    state.editPlanBusy ? h('p', { class: 'hint', role: 'status' }, [siteText('操作範囲と共有範囲を確認しています…')]) : '',
    plan ? h('dl', { class: 'workspace-edit-plan-facts' }, [
      h('dt', {}, [siteText('選んだ部品')]), h('dd', {}, [targetLabel({ ...state.previewSelection, ...plan.selected })]),
      h('dt', {}, [siteText('変更する要素')]), h('dd', {}, [targetLabel(plan.target)]),
      h('dt', {}, [siteText('適用範囲')]), h('dd', {}, [plan.scope === 'shared' ? siteText('共有元を使う UI') : siteText('現在選択している UI 定義')]),
    ]) : '',
    plan?.instanceIsolation === 'single-placement' ? h('p', { class: 'workspace-owner-notice' },
      [siteText`選択した配置だけを独立させて変更します。同じ原文を使う ${plan.sharedSourceInstances} 配置のうち、変更するのは 1 配置です。`]) : '',
    plan?.reason ? h('p', { class: 'hint', role: 'status' }, [translateSiteMessage(plan.reason)]) : '',
    Number.isSafeInteger(plan?.affectedDescendants) ? h('p', { class: 'hint' }, [siteText`変更対象の配下（現在の解析条件）: ${plan.affectedDescendants}要素${plan.targetAnalysisComplete === false ? '以上・部分解析' : ''}`]) : '',
    plan?.promoted ? h('p', { class: 'workspace-owner-notice' }, [siteText('選んだ画像の親にある操作要素へ変更先を切り替えます。操作位置と各状態の見た目を一緒に移動します。')]) : '',
    plan && !plan.promoted && plan.targetMode === 'interaction' ? h('p', { class: 'hint' }, [siteText('この要素自身が変更対象です。操作を含む親への切り替えはありません。')]) : '',
    plan?.generated || Number(plan?.affectedInstances) > 1 ? h('div', { class: 'workspace-generated-consent' }, [
      h('p', {}, [plan.generated
        ? siteText`同じテンプレートの反復要素が対象です（確認できた要素数: ${plan.affectedInstances ?? '?'}）。この 1 枠だけへの変更にはなりません。`
        : siteText`通常・ホバーなどの表示や複数の配置が、同じ部品の原文を共用しています（確認できた要素数: ${plan.affectedInstances ?? '?'}）。この部品だけの変更でも、その共用先に反映されます。`]),
      !plan.generated && plan.targetMode === 'visual' ? h('p', { class: 'hint' }, [siteText('ボタン一つを移動したい場合は、移動・サイズ変更の対象を「操作要素全体」に切り替え、変更先を確認してください。')]) : '',
      h('label', { for: 'workspace-generated-template' }, [h('input', { id: 'workspace-generated-template', type: 'checkbox', checked: state.editGeneratedTemplate === true, disabled: state.busy,
        onChange: event => controller.setEditGeneratedTemplate(event.currentTarget.checked) }), siteText('表示された範囲の同じテンプレート全体に適用する')]),
    ]) : '',
    Array.isArray(plan?.affectedScreens) && plan.affectedScreens.length ? h('details', {}, [
      h('summary', {}, [siteText`影響する UI の確認結果（${plan.affectedScreens.length} 件）`]),
      h('ul', {}, plan.affectedScreens.slice(0, 30).map(screen => h('li', {}, [typeof screen === 'string' ? screen : `${screen.path || screen.filePath || ''} · ${screen.rawKey || screen.pointer || screen.qualifiedName || ''}`]))),
      plan.affectedScreens.length > 30 ? h('p', { class: 'hint' }, [siteText('先頭 30 件を表示しています。')]) : '',
    ]) : '',
    plan?.scopeCertainty === 'loaded-reference-candidates' ? h('p', { class: 'hint' }, [siteText('共有範囲は読み込んだ定義から確認しています。ゲーム側の別の UI が同じ共有元を参照する場合は、そこにも反映されます。')]) : '',
    state.editPlanError ? h('p', { class: 'workspace-error', role: 'alert' }, [translateSiteMessage(state.editPlanError)]) : '',
    !plan && !state.editPlanBusy ? h('p', { class: 'hint' }, [siteText('プレビューで部品を選ぶと、実際の変更先と適用範囲を表示します。')]) : '',
    state.previewSelection?.screen ? h('button', { type: 'button', class: 'btn', disabled: state.busy || state.editPlanBusy, onClick: refresh }, [siteText('変更先を再確認')]) : '',
  ]);
}
