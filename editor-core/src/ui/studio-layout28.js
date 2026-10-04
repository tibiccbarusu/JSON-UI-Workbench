/** 表示領域だけを変更する。JSON UI・編集履歴・未確定操作には触れない。 */
export function applyStudioLayout28(ui, preset, viewportWidth = 1440) {
  if (!ui || typeof ui !== 'object' || !['browse', 'properties', 'focus', 'restore'].includes(preset)) {
    throw new TypeError('STUDIO_LAYOUT_INVALID');
  }
  const keys = ['leftOpen', 'rightOpen', 'compactRibbon26', 'leftView26', 'rightView'];
  if (preset === 'focus') {
    if (ui.leftOpen || ui.rightOpen || !ui.compactRibbon26) {
      ui.layoutRestore28 = Object.fromEntries(keys.map(key => [key, ui[key]]));
    }
    ui.leftOpen = false; ui.rightOpen = false; ui.compactRibbon26 = true;
  } else if (preset === 'restore') {
    const saved = ui.layoutRestore28;
    if (saved) for (const key of keys) ui[key] = saved[key];
    else { ui.leftOpen = true; ui.rightOpen = false; ui.compactRibbon26 = false; }
    if (viewportWidth <= 900 && ui.leftOpen && ui.rightOpen) ui.leftOpen = false;
    ui.layoutRestore28 = null;
  } else {
    ui.leftOpen = preset === 'browse' || viewportWidth > 900;
    ui.rightOpen = preset === 'properties'; ui.compactRibbon26 = false;
    ui.leftView26 = preset === 'browse' ? 'screens' : 'elements'; ui.rightView = 'properties';
  }
  return ui;
}

export function renderStudioLayoutTools28(h, onApply) {
  return h('div', { class: 'studio-layout-tools28', role: 'group', 'aria-label': '作業領域の切り替え' }, [
    ['browse', '一覧中心', '左にUI一覧、中央にプレビューを表示'],
    ['properties', 'プロパティ中心', '選択した要素の設定を右に表示'],
    ['focus', '集中表示', 'サイドパネルとリボン内容を畳む。未確定の変更は保持'],
  ].map(([preset, label, title]) => h('button', { id: `studio-layout-${preset}28`, type: 'button', class: 'btn', title,
    onClick: () => onApply(preset) }, [label])));
}
