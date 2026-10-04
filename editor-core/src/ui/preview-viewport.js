import { siteText, translateSiteMessage } from '../i18n/site-messages.js';
/** 拡大表示の状態をDOM再生成から独立させる。Fullscreen非対応時も同じ操作を使える。 */
export function createPreviewViewportController({ document: doc, onResize, onExit, onNotice } = {}) {
  let active = false, nativeOwned = false, generation = 0, saved = null, disposed = false;
  let ribbonVisible = false, ribbonPinned = false, pointerInCommands = false;
  const commandTarget = target => Boolean(target?.closest?.('#studio-ribbon, #studio-expanded-bar'));
  const focusInCommands = () => commandTarget(doc.activeElement);
  function sync() {
    doc.documentElement.classList.toggle('preview-expanded', active);
    doc.documentElement.classList.toggle('preview-ribbon-visible', active && ribbonVisible);
    doc.documentElement.classList.toggle('preview-ribbon-pinned', active && ribbonPinned);
    const button = doc.getElementById('preview-expand');
    if (button) {
      button.textContent = active ? siteText('元の大きさに戻す') : siteText('全画面でプレビュー');
      button.setAttribute('aria-pressed', String(active));
    }
    const compact = doc.getElementById('studio-preview-expand');
    if (compact) { compact.textContent = active ? '最大化を終了' : '最大化'; compact.setAttribute('aria-pressed', String(active)); }
    const reveal = doc.getElementById('studio-expanded-reveal');
    reveal?.setAttribute('aria-expanded', String(active && ribbonVisible));
    const pin = doc.getElementById('studio-expanded-pin');
    if (pin) { pin.setAttribute('aria-pressed', String(ribbonPinned)); pin.textContent = ribbonPinned ? '固定中' : 'コマンドを固定'; }
  }
  function showRibbon({ focus = false } = {}) {
    if (!active || disposed) return;
    ribbonVisible = true; sync();
    if (focus) doc.querySelector?.('#studio-ribbon [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  }
  function hideRibbon({ focusCanvas = false } = {}) {
    if (!active || ribbonPinned) return;
    if (focusCanvas) doc.getElementById('preview-canvas')?.focus({ preventScroll: true });
    ribbonVisible = false; sync();
  }
  function setRibbonPinned(value) {
    const previous = ribbonPinned;
    ribbonPinned = Boolean(value);
    if (active) ribbonVisible = ribbonPinned || focusInCommands() || pointerInCommands;
    sync();
    if (active && previous !== ribbonPinned) onResize?.(true);
  }
  async function exit() {
    if (!active) return;
    active = false; ribbonVisible = false; pointerInCommands = false; generation++;
    const previous = saved; saved = null;
    const shouldExit = nativeOwned && doc.fullscreenElement === doc.documentElement;
    nativeOwned = false; sync(); onExit?.(previous); onResize?.(false);
    if (shouldExit) { try { await doc.exitFullscreen(); } catch { /* 拡大表示は解除済み */ } }
  }
  async function enter(snapshot = null) {
    if (active || disposed) return;
    active = true; ribbonVisible = ribbonPinned; saved = snapshot; const epoch = ++generation;
    sync(); onResize?.(true);
    // 別の機能が既に所有する全画面は引き継がない。CSS最大化だけを行う。
    if (doc.fullscreenElement) return;
    if (!doc.documentElement.requestFullscreen || doc.fullscreenEnabled === false) return;
    try {
      await doc.documentElement.requestFullscreen();
      if (!active || epoch !== generation) {
        if (doc.fullscreenElement === doc.documentElement) {
          // 過去の要求が遅れて完了しても、新しい拡大セッションを終了しない。
          // 新しいセッションがあれば自分たちの要求による全画面を引き継ぐ。
          if (active) nativeOwned = true;
          else await doc.exitFullscreen();
        }
        return;
      }
      nativeOwned = doc.fullscreenElement === doc.documentElement;
      if (nativeOwned) onResize?.(true);
    } catch {
      if (active && epoch === generation && doc.fullscreenElement !== doc.documentElement) onNotice?.(siteText('ブラウザ内の最大サイズで表示しています。'));
    }
  }
  function onFullscreenChange() {
    if (nativeOwned && doc.fullscreenElement !== doc.documentElement) void exit();
  }
  function onKeydown(event) {
    if (!active || event.isComposing) return;
    if (event.key === 'F6' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation();
      if (focusInCommands()) {
        doc.getElementById('preview-canvas')?.focus({ preventScroll: true });
        if (!ribbonPinned) hideRibbon();
      } else showRibbon({ focus: true });
      return;
    }
    if (event.key !== 'Escape') return;
    // DOMへ届く編集用Escは入力取消へ渡す。ネイティブ全画面のEsc終了は
    // ブラウザ側の操作なので、fullscreenchangeでも解除を同期する。
    if (event.target?.id === 'preview-editbox-overlay' || event.target?.closest?.('#studio-context-menu')) return;
    event.preventDefault(); event.stopPropagation(); void exit();
  }
  function onPointerMove(event) {
    if (!active || event.pointerType === 'touch' || event.buttons) return;
    pointerInCommands = commandTarget(event.target) || Number(event.clientY) <= 36;
    if (pointerInCommands) { if (!ribbonVisible) showRibbon(); }
    else if (!ribbonPinned && !focusInCommands() && ribbonVisible) hideRibbon();
  }
  function onPointerDown(event) {
    if (!active || commandTarget(event.target)) return;
    pointerInCommands = false;
    if (!ribbonPinned) hideRibbon();
  }
  function onFocusIn(event) {
    if (!active) return;
    if (commandTarget(event.target)) showRibbon();
    else if (!ribbonPinned && !pointerInCommands) hideRibbon();
  }
  doc.addEventListener('fullscreenchange', onFullscreenChange);
  doc.addEventListener('keydown', onKeydown, true);
  doc.addEventListener('pointermove', onPointerMove, { passive: true });
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('focusin', onFocusIn);
  return {
    get active() { return active; }, get generation() { return generation; }, enter, exit, sync,
    get ribbonVisible() { return ribbonVisible; }, get ribbonPinned() { return ribbonPinned; },
    showRibbon, hideRibbon, setRibbonPinned,
    toggle(snapshot) { return active ? exit() : enter(snapshot); },
    dispose() {
      disposed = true; void exit();
      doc.removeEventListener('fullscreenchange', onFullscreenChange); doc.removeEventListener('keydown', onKeydown, true);
      doc.removeEventListener('pointermove', onPointerMove); doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('focusin', onFocusIn);
    },
  };
}
