import { siteText, translateSiteMessage } from '../i18n/site-messages.js';
/** 選択したUIにある入力bindingを調べ、明示した変更だけ適用する。
 * モデルは読み取り専用。画面に作る入力欄は最大24件で、入力中は再解釈しない。
 */
const cache = new WeakMap();
const bindingName = /^#[A-Za-z_][A-Za-z0-9_.:/-]{0,127}$/u;
const booleanTargets = new Set(['visible', 'enabled', 'ignored', 'checked', 'selected', 'grayscale']);
const numericTargets = new Set(['alpha', 'layer', 'value', 'clip_ratio', 'progress', 'slider_value']);

export function buildRuntimeInputCatalog(model) {
  if (!model?.root || typeof model !== 'object') return { inputs: [], collections: [], truncated: false };
  if (cache.has(model)) return cache.get(model);
  const fields = new Map(), collections = new Set(), seen = new Set(), pending = [model.root];
  let visited = 0, truncated = false;
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    if (++visited > 20000) { truncated = true; break; }
    seen.add(node);
    for (const binding of node.bindings || []) {
      if (!binding || binding.ignored === true) continue;
      if (binding.binding_type === 'collection' || binding.binding_type === 'collection_details') {
        if (typeof binding.binding_collection_name === 'string') collections.add(binding.binding_collection_name);
        continue;
      }
      // View bindings refer to another control's output, not a game input.
      if (binding.binding_type === 'view' || binding.source_control_name) continue;
      const name = binding.binding_name;
      if (typeof name !== 'string' || !bindingName.test(name)) continue;
      if (!fields.has(name)) {
        if (fields.size >= 2000) { truncated = true; continue; }
        fields.set(name, { name, targets: new Set(), count: 0, type: 'string' });
      }
      const row = fields.get(name);
      const target = String(binding.binding_name_override || binding.target_property_name || name).replace(/^#/u, '');
      row.targets.add(target); row.count++;
      if (booleanTargets.has(target)) row.type = 'boolean';
      else if (numericTargets.has(target) && row.type !== 'boolean') row.type = 'number';
    }
    if (Array.isArray(node.children)) for (const child of node.children) pending.push(child);
  }
  const result = { inputs: [...fields.values()].map(row => Object.freeze({ ...row, targets: [...row.targets] })).sort((a, b) => a.name.localeCompare(b.name)), collections: [...collections].sort(), truncated };
  cache.set(model, result); return result;
}

export function parseRuntimeInputValue(text, type) {
  if (String(text).length > 65536) throw new Error(siteText('入力値は65,536文字以下にしてください。'));
  if (type === 'string') return String(text);
  if (type === 'boolean') {
    if (text === 'true') return true;
    if (text === 'false') return false;
    throw new Error(siteText('真偽値には true または false を指定してください。'));
  }
  if (type === 'number') {
    if (!String(text).trim()) throw new Error(siteText('数値が空です。指定をなくす場合は「解除」を使ってください。'));
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error(siteText('有限の数値を指定してください。'));
    return n;
  }
  if (type !== 'json') throw new Error(siteText('入力の型が不正です。'));
  try { return JSON.parse(text); } catch { throw new Error(siteText('JSONの書式を確認してください。')); }
}

export function applyRuntimeInputDraft(current, drafts) {
  const { __collections = {}, ...mockData } = current || {};
  for (const [name, draft] of Object.entries(drafts || {})) {
    if (!bindingName.test(name) || !draft || typeof draft !== 'object') throw new Error(siteText('入力bindingの指定が不正です。'));
    if (draft.remove === true) delete mockData[name];
    else mockData[name] = parseRuntimeInputValue(draft.text, draft.type);
  }
  return { mockData, collectionData: __collections };
}

function actualType(value, fallback) {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return typeof value;
  return value === undefined ? fallback : 'json';
}
function formatValue(value) {
  return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
}

export function renderRuntimeInputEditor(h, options) {
  const state = options.state;
  const summary = h('summary', {}, [siteText('このUIの入力値')]);
  const content = h('div', { class: 'runtime-input-content' }, []);
  let built = false, body = null, refreshPending = false;
  function mount() {
    if (built) return;
    built = true;
    body = renderRuntimeInputBody(h, options);
    content.replaceChildren(body);
    summary.textContent = siteText`このUIの入力値 (${buildRuntimeInputCatalog(options.model).inputs.length})`;
  }
  const details = h('details', { class: 'runtime-input-editor', open: state.open || null, onFocusout: () => {
    queueMicrotask(() => { if (refreshPending) details.refreshRuntimeInputs(); });
  }, onToggle: event => {
    state.open = event.currentTarget.open;
    if (state.open) mount();
  } }, [summary, content]);
  details.refreshRuntimeInputs = () => {
    if (!body) return;
    const active = details.ownerDocument?.activeElement;
    if (active && details.contains?.(active)) { refreshPending = true; return; }
    refreshPending = false; body.refreshRuntimeInputs();
  };
  if (state.open) mount();
  return details;
}

function renderRuntimeInputBody(h, { model, current = {}, getCurrent, state, disabled = false, onApply, onOpenJson }) {
  const catalog = buildRuntimeInputCatalog(model);
  state.drafts ||= Object.create(null); state.query ||= ''; state.page ||= 0;
  const list = h('div', { class: 'runtime-input-list' }, []);
  const message = h('span', { class: 'hint', role: 'status' }, []);
  const pageInfo = h('span', { class: 'hint' }, []);
  function report(text) { message.textContent = text; }
  function drawList() {
    current = getCurrent?.() || current;
    const matches = catalog.inputs.filter(row => (row.name + ' ' + row.targets.join(' ')).toLowerCase().includes(state.query.toLowerCase()));
    const pages = Math.max(1, Math.ceil(matches.length / 24));
    state.page = Math.max(0, Math.min(pages - 1, state.page));
    pageInfo.textContent = siteText`${matches.length}項目 · ${state.page + 1}/${pages}ページ`;
    previous.disabled = disabled || state.page === 0; next.disabled = disabled || state.page >= pages - 1;
    list.replaceChildren(...matches.slice(state.page * 24, state.page * 24 + 24).map(row => {
      const draft = state.drafts[row.name], specified = Object.hasOwn(current, row.name);
      let type = draft?.type || actualType(current[row.name], row.type);
      const value = draft?.remove ? '' : draft ? draft.text : formatValue(current[row.name]);
      const indicator = h('span', { class: 'runtime-input-indicator' }, [draft ? draft.remove ? siteText('解除予定') : siteText('変更あり') : specified ? siteText('指定済み') : siteText('未指定')]);
      const input = h('textarea', { id: `runtime-input-value-${encodeURIComponent(row.name)}`, class: 'runtime-input-value', rows: type === 'string' || type === 'json' ? '2' : '1', value, disabled, maxlength: '65536', placeholder: specified ? '' : siteText('未指定'), spellcheck: false,
        'aria-label': siteText`${row.name} の値`,
        onInput: event => { state.drafts[row.name] = { type, text: event.currentTarget.value }; indicator.textContent = siteText('変更あり'); report(siteText('編集中です。「入力値を適用」で反映します。')); },
      });
      const select = h('select', { id: `runtime-input-type-${encodeURIComponent(row.name)}`, 'aria-label': siteText`${row.name} の型`, value: type, disabled, onChange: event => {
        type = event.currentTarget.value;
        state.drafts[row.name] = { type, text: input.value }; indicator.textContent = siteText('変更あり');
      } }, [['string',siteText('文字列')],['number',siteText('数値')],['boolean',siteText('真偽値')],['json','JSON']].map(([value,label]) => h('option',{value},[label])));
      return h('div', { class: 'runtime-input-row' }, [
        h('div', { class: 'runtime-input-heading' }, [h('code', { title: siteText`${row.targets.join(', ')} / 参照 ${row.count}箇所` }, [row.name]), indicator]),
        h('div', { class: 'runtime-input-fields' }, [select, input, h('button', { class: 'btn', type: 'button', disabled, 'aria-label': siteText`${row.name} の指定を解除`, onClick: () => {
          state.drafts[row.name] = { remove: true }; input.value = ''; indicator.textContent = siteText('解除予定'); report(siteText('解除を予約しました。「入力値を適用」で反映します。'));
        } }, [siteText('解除')])]),
      ]);
    }));
  }
  const previous = h('button', { type: 'button', class: 'btn', disabled, onClick: () => { state.page--; drawList(); } }, [siteText('前へ')]);
  const next = h('button', { type: 'button', class: 'btn', disabled, onClick: () => { state.page++; drawList(); } }, [siteText('次へ')]);
  drawList();
  const section = h('section', { 'aria-label': siteText('選択中UIの入力値') }, [
    h('p', { class: 'hint' }, [siteText('UI定義が参照する値です。値を変えてから適用します。真偽値は true / false、文字列は引用符なしで入力します。')]),
    h('input', { id: 'runtime-input-search', class: 'runtime-input-search', type: 'search', value: state.query, disabled, placeholder: siteText('入力名・表示先で検索'), 'aria-label': siteText('このUIの入力値を検索'), onInput: event => {
      state.query = event.currentTarget.value; state.page = 0; drawList();
    } }), list,
    !catalog.inputs.length ? h('p', { class: 'hint' }, [model ? siteText('この定義に直接指定できる入力bindingはありません。項目一覧や変数は状態JSONで指定できます。') : siteText('ファイルとUI定義を選択すると入力値が表示されます。')]) : '',
    catalog.truncated ? h('p', { class: 'hint text-warn' }, [siteText('大きな定義のため一覧を制限しています。状態JSONからも指定できます。')]) : '',
    h('div', { class: 'runtime-input-pagination' }, [previous, pageInfo, next]),
    catalog.collections.length ? h('p', { class: 'hint' }, [siteText`項目一覧: ${catalog.collections.join(', ')}。collectionDataは状態JSONで編集できます。`]) : '',
    h('div', { class: 'runtime-input-actions' }, [h('button', { type: 'button', class: 'btn btn-primary', disabled: disabled || !model, onClick: () => {
      try {
        if (!Object.keys(state.drafts).length) { report(siteText('変更された入力値はありません。')); return; }
        const result = onApply(state.drafts);
        if (result === false) return;
        if (result && typeof result === 'object') current = result;
        state.drafts = Object.create(null); drawList(); report(siteText('入力値を適用しました。'));
      } catch (error) { report(siteText`適用できません: ${translateSiteMessage(error.message || error)}`); }
    } }, [siteText('入力値を適用')]), h('button', { type: 'button', class: 'btn', disabled, onClick: onOpenJson }, [siteText('状態JSONへ')])]), message,
  ]);
  section.refreshRuntimeInputs = drawList;
  return section;
}
