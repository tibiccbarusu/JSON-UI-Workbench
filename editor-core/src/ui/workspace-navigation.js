import { siteText, translateSiteMessage } from '../i18n/site-messages.js';
// Browser UI helpers. Importing this module performs no DOM or network work.
export const PICKER_PAGE_SIZE = 100;

/** Return a bounded page while keeping the explicit selection available.
 * Search uses literal, case-insensitive tokens; pack text is never executed.
 * @param {Array<{value:string,label:string,search?:string}>} entries
 * @param {{query?:string,page?:number,selectedValue?:string,pageSize?:number}} options
 */
export function pageWorkspaceEntries(entries, options = {}) {
  const input = Array.isArray(entries) ? entries : [];
  const query = String(options.query || '').slice(0, 256).trim().toLowerCase();
  const tokens = query.split(/\s+/u).filter(Boolean);
  const size = Math.max(1, Math.min(PICKER_PAGE_SIZE, Math.floor(Number(options.pageSize) || PICKER_PAGE_SIZE)));
  const selectedValue = String(options.selectedValue || '');
  const matches = [];
  let selected = null;
  for (const entry of input) {
    if (!entry || typeof entry.value !== 'string') continue;
    if (entry.value === selectedValue) selected = entry;
    const searchable = String(entry.search || entry.label || entry.value).toLowerCase();
    if (tokens.every((token) => searchable.includes(token))) matches.push(entry);
  }
  const pageCount = Math.max(1, Math.ceil(matches.length / size));
  const requestedPage = Number(options.page);
  const page = Math.min(pageCount - 1, Math.max(0, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  const start = page * size;
  const visible = matches.slice(start, start + size);
  const pinned = selected && !visible.some((entry) => entry.value === selectedValue) ? selected : null;
  return { entries: visible, pinned, page, pageCount, total: matches.length, start: matches.length ? start + 1 : 0, end: Math.min(start + size, matches.length) };
}

/** Render a searchable native select. Query/page changes update only this
 * control, so typing does not rebuild the Canvas or lose Japanese IME input.
 * @param {Function} h safe DOM element builder
 * @param {{id:string,label:string,entries:Array,selectedValue:string,state:object,disabled?:boolean,placeholder?:string,onSelect:Function}} options
 */
export function renderWorkspacePicker(h, options) {
  const { id, label, entries, selectedValue, state, disabled = false, onSelect } = options;
  let composing = false;
  const select = h('select', {
    id, class: 'screen-open-select', disabled,
    'aria-describedby': `${id}-count`,
    onChange: (event) => onSelect(String(event.currentTarget.value || '')),
  });
  const count = h('span', { id: `${id}-count`, class: 'workspace-picker-count', role: 'status' });
  const previous = h('button', {
    type: 'button', class: 'btn btn-small', 'aria-label': siteText`${label}の前の100件`,
    onClick: () => { state.page -= 1; update(); },
  }, [siteText('前へ')]);
  const next = h('button', {
    type: 'button', class: 'btn btn-small', 'aria-label': siteText`${label}の次の100件`,
    onClick: () => { state.page += 1; update(); },
  }, [siteText('次へ')]);
  const search = h('input', {
    id: `${id}-search`, type: 'search', class: 'workspace-picker-search',
    value: state.query || '', maxlength: '256', disabled,
    placeholder: options.placeholder || siteText`${label}を検索`,
    'aria-label': siteText`${label}を検索`, 'aria-controls': id,
    onCompositionstart: () => { composing = true; },
    onInput: (event) => { if (composing || event.isComposing) return; state.query = event.currentTarget.value; state.page = 0; update(); },
    onCompositionend: (event) => { composing = false; state.query = event.currentTarget.value; state.page = 0; update(); },
    onKeydown: (event) => {
      if (composing || event.isComposing) return;
      if (event.key === 'Enter' || event.key === 'ArrowDown') { event.preventDefault(); select.focus(); }
      if (event.key === 'Escape') { event.preventDefault(); search.value = ''; state.query = ''; state.page = 0; update(); }
    },
  });
  function update() {
    const page = pageWorkspaceEntries(entries, { ...state, selectedValue });
    state.page = page.page;
    const rows = page.pinned ? [page.pinned, ...page.entries] : page.entries;
    select.replaceChildren(...rows.map((entry) => h('option', { value: entry.value }, [
      `${entry === page.pinned ? siteText('選択中: ') : ''}${entry.label}`,
    ])));
    if (!rows.length) select.append(h('option', { value: '' }, [siteText('（該当する項目なし）')]));
    // A filter never changes what will be previewed without explicit selection.
    select.value = selectedValue;
    select.disabled = disabled || !rows.length;
    count.textContent = siteText`${page.start}–${page.end} / ${page.total} 件${page.pinned ? siteText('・選択中を別表示') : ''}`;
    previous.disabled = disabled || page.page === 0;
    next.disabled = disabled || page.page + 1 >= page.pageCount;
    previous.hidden = next.hidden = page.pageCount <= 1;
  }
  update();
  return h('div', { class: 'workspace-picker' }, [
    h('label', { class: 'screen-open-label', for: id }, [label]),
    search, select,
    h('div', { class: 'workspace-picker-pagination' }, [count, previous, next]),
  ]);
}

/** Build expensive editor sections only when opened; discard hidden DOM.
 * The caller owns openState so normal app renders preserve disclosure state.
 */
export function renderLazyWorkspaceDetails(h, { className, title, openState, renderBody, onError }) {
  const details = h('details', { class: className || '', open: openState.open ? 'open' : null }, [
    h('summary', {}, [title]),
  ]);
  let body = null;
  function updateBody() {
    openState.open = details.open;
    if (details.open && !body) {
      try {
        body = h('div', { class: 'workspace-details-content' }, [renderBody()]);
      } catch (error) {
        body = h('div', { class: 'workspace-error', role: 'alert' }, [
          siteText('詳細設定を表示できませんでした。'),
          error instanceof Error ? error.message : String(error),
        ]);
        if (typeof onError === 'function') onError(error);
      }
      details.append(body);
    }
    if (!details.open && body) { body.remove(); body = null; }
  }
  details.addEventListener('toggle', () => {
    // A removed disclosure may still have a queued toggle event. It must not
    // overwrite the state of a replacement UI or a newly imported pack.
    if (details.isConnected) updateBody();
  });
  updateBody();
  return details;
}

/** Human-readable import states. Unknown phases remain truthful text. */
export function formatWorkspaceImportPhase(phase) {
  const labels = {
    idle: siteText('待機中'), 'node-upload': siteText('ローカル処理へ読み込み中'),
    indexing: siteText('ファイル索引を作成中'), 'asset-index': siteText('素材索引を作成中'),
    'ui-catalog': siteText('UI定義を解析中'), complete: siteText('読み込み完了'),
    cancelling: siteText('キャンセル処理中'), opening: siteText('ZIPを確認中'),
  };
  return labels[String(phase)] || String(phase || siteText('処理中'));
}
