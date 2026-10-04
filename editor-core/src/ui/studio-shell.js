/** Studio の表示部品。状態・処理・保存は呼出元が所有する。import 時の副作用はない。 */
export function studioCommandGroup(h, label, content) {
  return h('div', { class: 'studio-command-group', role: 'group', 'aria-label': label }, [
    h('div', { class: 'studio-command-buttons' }, content),
    h('span', { class: 'studio-command-label' }, [label]),
  ]);
}

/** 詳細は native details に任せ、再描画を発生させず開閉状態だけを記録する。 */
export function studioDetails(h, { id, label, state, className = '', open = false }, content) {
  return h('details', {
    id, class: `studio-details ${className}`.trim(), open: state?.[id] ?? open,
    onToggle: event => { if (state) state[id] = event.currentTarget.open; },
  }, [h('summary', {}, [label]), h('div', { class: 'studio-details-content' }, content)]);
}

export function renderStudioTabs(h, { tabs, selected, onSelect, focusTab }) {
  return h('div', { class: 'studio-ribbon-tabs', role: 'tablist', 'aria-label': '操作の分類' }, tabs.map(([id, label], index) => h('button', {
    id: `studio-tab-${id}`, role: 'tab', type: 'button', 'aria-selected': String(selected === id),
    'aria-controls': 'studio-ribbon-content', tabindex: selected === id ? 0 : -1,
    onClick: () => onSelect(id),
    onKeydown: event => {
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (event.isComposing || (!delta && !['Home', 'End'].includes(event.key))) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + delta + tabs.length) % tabs.length;
      onSelect(tabs[next][0]); focusTab(tabs[next][0]);
    },
  }, [label])));
}

/** 最大化中に常に残る操作入口。hover に頼らずタッチ・キーボードでも到達できる。 */
export function renderStudioExpandedBar(h, viewport) {
  return h('div', { id: 'studio-expanded-bar', class: 'studio-expanded-bar', 'aria-label': '最大化中の操作' }, [
    h('button', { id: 'studio-expanded-reveal', type: 'button', class: 'btn',
      'aria-controls': 'studio-ribbon', 'aria-expanded': String(viewport.ribbonVisible),
      title: '上端へマウスを移すか、このボタンを押すとコマンドを表示します。F6 でも切り替えられます。',
      onClick: () => viewport.showRibbon({ focus: true }),
    }, ['タブ・コマンド ▾']),
    h('span', { class: 'studio-expanded-hint' }, ['F6 でコマンドと画面を切替']),
    h('button', { id: 'studio-expanded-pin', type: 'button', class: 'btn',
      'aria-pressed': String(viewport.ribbonPinned), title: 'コマンドを常に表示します。',
      onClick: () => viewport.setRibbonPinned(!viewport.ribbonPinned),
    }, [viewport.ribbonPinned ? '固定中' : 'コマンドを固定']),
    h('button', { id: 'studio-expanded-exit', type: 'button', class: 'btn',
      title: '最大化を終了して前のズームと位置へ戻ります。Esc でも終了できます。',
      onClick: () => viewport.exit(),
    }, ['最大化を終了', h('kbd', {}, ['Esc'])]),
  ]);
}

export function pendingPreviewText(count) {
  return count > 0 ? `編集中 ${count}件 · JSON UIは未確定` : 'JSON UIへの未確定変更なし';
}

export function pendingApplyText(count) {
  return count > 0 ? `JSON UIに確定（${count}件）` : 'JSON UIに確定';
}
