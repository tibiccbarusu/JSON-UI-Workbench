import { siteText, translateSiteMessage } from '../i18n/site-messages.js';
import { DEBUG_SECRET_KEY, DEBUG_OMITTED_KEY, sanitizeDebugText } from '../diagnostics/debug-redaction.js';

// Browser wiring helpers; importing performs no DOM, timer or network work.
// Runtime state and animation sampling remain in the engine modules.
export function classifyPreviewStoreChange(next, previous, action, { detailed = false } = {}) {
  if (next === previous) return 'none';
  if (next?.ui?.route !== 'editor') return 'full';
  const type = String(action?.type || '');
  if ((type === 'editor/selectNode' || type === 'editor/clearSelection')
    && !detailed && !(Number(next?.ui?.panels?.rightPx) > 0)) return 'canvas';
  if (type === 'preview/setMockData' && !detailed && !(Number(next?.ui?.panels?.rightPx) > 0)) {
    const id = next?.files?.currentFileId;
    if (id && id === previous?.files?.currentFileId && next.files.byId?.[id]
      && next.files.byId[id] === previous.files.byId?.[id]) return 'data';
  }
  if (type === 'files/patchFiles' && Array.isArray(action.updates) && action.updates.length
    && action.updates.every(update => update?.patch && Object.keys(update.patch).every(key => key === 'validation'))
    && !detailed && !(Number(next?.ui?.panels?.rightPx) > 0)) return 'none';
  if (type === 'ui/toggleDebug') return detailed ? 'full' : 'none';
  return 'full';
}

/** One scheduled callback per frame, even when hundreds of state events arrive. */
export function createFrameCoalescer(requestFrame, cancelFrame, callback) {
  let pending = null;
  return {
    request() {
      if (pending !== null) return;
      pending = requestFrame(() => { pending = null; callback(); });
    },
    cancel() { if (pending !== null) cancelFrame(pending); pending = null; },
    get pending() { return pending !== null; },
  };
}

/** Constant-space timing collector; measurements are exported with debug logs. */
export function createPreviewPerformanceMetrics() {
  const rows = Object.create(null);
  return {
    record(name, elapsedMs) {
      if (!['dom', 'layout', 'draw', 'animation', 'longtask'].includes(name)) return;
      const elapsed = Number(elapsedMs);
      if (!Number.isFinite(elapsed) || elapsed < 0) return;
      const row = rows[name] || (rows[name] = { count: 0, totalMs: 0, maxMs: 0, over50ms: 0 });
      row.count += 1; row.totalMs += elapsed; row.maxMs = Math.max(row.maxMs, elapsed);
      if (elapsed >= 50) row.over50ms += 1;
    },
    snapshot() { return Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, { ...row, meanMs: row.totalMs / row.count }])); },
  };
}

/** Bound the browser snapshot before transport, including the fallback file. */
export function sanitizePreviewDebugPayload(input, { maxDepth = 10, onTruncate } = {}) {
  let remaining = 240000, nodes = 0;
  const depthLimit = Number.isInteger(maxDepth) ? Math.max(0, Math.min(10, maxDepth)) : 10;
  const truncated = (omitted = 1) => { onTruncate?.(omitted); };
  const seen = new WeakSet();
  function copy(value, depth = 0, key = '') {
    if (DEBUG_SECRET_KEY.test(key)) return '[REDACTED]';
    if (++nodes > 10000 || depth > depthLimit || remaining <= 0) { truncated(); return '[TRUNCATED]'; }
    if (typeof value === 'string') {
      const redacted = sanitizeDebugText(value.slice(0, 16384));
      let safe = redacted.slice(0, Math.min(4096, remaining));
      if (value.length > 16384 || safe.length < redacted.length) {
        truncated();
        if (safe.length && /[\uD800-\uDBFF]/u.test(safe.at(-1))) safe = safe.slice(0, -1);
      }
      remaining -= safe.length;
      return safe;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'object') return String(value ?? '').slice(0, 128);
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const out = Array.isArray(value) ? [] : Object.create(null);
    const allKeys = Object.keys(value), keys = allKeys.slice(0, 300);
    if (allKeys.length > keys.length) truncated(allKeys.length - keys.length);
    for (const field of keys) {
      if (['__proto__', 'constructor', 'prototype'].includes(field) || DEBUG_OMITTED_KEY.test(field)) continue;
      const redactedField = sanitizeDebugText(field), safeField = redactedField.slice(0, 256);
      if (safeField.length < redactedField.length) truncated();
      // 短縮・秘匿化で同じキーになった記録を、別の値で黙って上書きしない。
      if (Object.hasOwn(out, safeField)) { truncated(); continue; }
      remaining -= safeField.length;
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (remaining <= 0) {
        truncated();
        if (depth === 0) {
          const child = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
          out[safeField] = Array.isArray(child) ? [] : child && typeof child === 'object' ? { truncation: '[TRUNCATED]' } : '[TRUNCATED]';
          continue;
        }
        out.truncation = '[TRUNCATED]'; break;
      }
      out[safeField] = descriptor && Object.hasOwn(descriptor, 'value') ? copy(descriptor.value, depth + 1, field) : '[ACCESSOR]';
    }
    seen.delete(value); return out;
  }
  return copy(input);
}

/** Alpha/color/UV animation does not change geometric layout. Parent order is
 * independent of painter sorting. Never mutate the reusable base boxes. */
export function applyPreviewPaintAnimation(layout, nodesById, propsById) {
  const boxes = Array.isArray(layout?.boxes) ? layout.boxes : [];
  const byId = new Map(boxes.map((box) => [String(box.id), box]));
  const inherited = new Map();
  const active = new Set();
  const clamp = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 1;
  const enabled = value => typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0
    : typeof value === 'string' && ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  const props = (id) => ({ ...(nodesById?.[id]?.props || {}), ...(propsById?.[id] || {}) });
  function alphaFromParents(id, depth = 0) {
    if (inherited.has(id)) return inherited.get(id);
    if (depth > 200 || active.has(id)) return 1;
    active.add(id);
    const parentId = byId.get(id)?.parentId;
    let value = 1;
    if (parentId && byId.has(String(parentId))) {
      const parent = props(String(parentId));
      value = alphaFromParents(String(parentId), depth + 1);
      if (enabled(parent.propagate_alpha)) value *= clamp(parent.alpha ?? 1);
    }
    active.delete(id); inherited.set(id, value); return value;
  }
  return { ...layout, boxes: boxes.map((box) => ({ ...box, renderAlpha: alphaFromParents(String(box.id)) * clamp(props(String(box.id)).alpha ?? 1) })) };
}

/** Timestamp-based, bounded playback. Pausing cancels work and preserves time. */
export function createPreviewPlayback({ requestFrame, cancelFrame, onFrame, onChange, canPlay, maxSeconds = 60, fps = 30 }) {
  let frame = null, playing = false, seconds = 0, origin = null, lastDraw = null;
  let limit = Math.max(1, Math.min(3600, Number(maxSeconds) || 60));
  const interval = 1000 / Math.max(1, Math.min(60, Number(fps) || 30));
  function notify() { onChange?.({ playing, seconds, maxSeconds: limit }); }
  function pause() {
    playing = false; origin = null; lastDraw = null;
    if (frame !== null) cancelFrame(frame);
    frame = null; notify();
  }
  function tick(timestamp) {
    frame = null;
    if (!playing || !canPlay()) { pause(); return; }
    if (origin === null) origin = timestamp - seconds * 1000;
    if (lastDraw === null || timestamp - lastDraw >= interval - 0.1) {
      seconds = Math.min(limit, Math.max(0, (timestamp - origin) / 1000));
      lastDraw = timestamp;
      try { onFrame(seconds); } catch (error) { pause(); throw error; }
      notify();
      if (seconds >= limit) { pause(); return; }
    }
    if (playing) frame = requestFrame(tick);
  }
  return {
    play() { if (playing || !canPlay()) return; if (seconds >= limit) seconds = 0; playing = true; origin = null; frame = requestFrame(tick); notify(); },
    pause,
    seek(value) { const raw = Number(value); seconds = Math.max(0, Math.min(limit, Number.isFinite(raw) ? raw : 0)); origin = null; lastDraw = null; onFrame(seconds); notify(); },
    setLimit(value) { const raw = Number(value); if (!Number.isFinite(raw) || raw <= 0) return; limit = Math.max(1, Math.min(3600, raw)); seconds = Math.min(seconds, limit); },
    get state() { return { playing, seconds, maxSeconds: limit }; },
  };
}

// Retain ownership across DOM rebuilds so a detached file reader cannot replace
// newer text in the same draft object.
const previewStateInputOwners = new WeakMap();

/** A bounded editor that never dispatches state while the user types. */
export function renderPreviewStateControls(h, { state, presets, onApply, onPreset, onDownload, onCurrent, disabled, beforeChange = () => {}, onError = () => {} }) {
  const owner = { revision: 0 };
  previewStateInputOwners.set(state, owner);
  const currentRead = revision => previewStateInputOwners.get(state) === owner && owner.revision === revision;
  const supersedeRead = () => { owner.revision += 1; };
  const message = h('span', { id: 'preview-state-message', class: `hint${state.dirty ? ' is-dirty' : ''}`, role: 'status' }, [translateSiteMessage(state.message) || siteText('値を編集し「状態を適用」で反映します。')]);
  function report(text) { state.message = text; message.textContent = translateSiteMessage(text); }
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, disabled,
    'aria-label': siteText('保存した状態JSONを読み込む'),
    onChange: async (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file) return;
      input.value = '';
      const revision = ++owner.revision;
      try {
        beforeChange();
        if (file.size > 1048576) throw new Error(siteText('ファイルは1 MiB以下にしてください。'));
        const text = await file.text();
        if (!currentRead(revision)) return;
        beforeChange();
        if (text.length > 262144) throw new Error(siteText('状態JSONは256 Ki文字以下にしてください。'));
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(siteText('最上位はJSONオブジェクトにしてください。'));
        state.text = text; state.dirty = true; textarea.value = text;
        report(siteText('ファイルを読み込みました。「状態を適用」で反映します。'));
      } catch (error) {
        if (currentRead(revision)) { report(siteText`読込できません: ${translateSiteMessage(error.message || error)}`); onError(error); }
      }
    },
  });
  const textarea = h('textarea', { id: 'preview-state-json', class: 'code preview-state-json', spellcheck: false, maxlength: '262144', disabled,
    'aria-label': siteText('状態データ JSON'), 'aria-describedby': 'preview-state-message',
    onInput: (event) => { beforeChange(); supersedeRead(); state.text = String(event.currentTarget.value); state.dirty = true; report(siteText('未適用の変更があります。「状態を適用」で反映します。')); },
    onKeydown: (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); supersedeRead(); onApply(state.text); } },
  }, [state.text || '{\n  "mockData": {},\n  "collectionData": {}\n}']);
  return h('section', { class: 'preview-state-controls', 'aria-label': siteText('プレビューに渡すデータ') }, [
    h('div', { class: 'preview-state-header' }, [h('strong', {}, [siteText('状態データ')]),
      h('select', { id: 'preview-state-preset', 'aria-label': siteText('状態データの例'), value: state.preset || '', disabled,
        onChange: (event) => { supersedeRead(); onPreset(String(event.currentTarget.value)); } }, [
        h('option', { value: '' }, [siteText('例を選択')]), ...presets.map((row) => h('option', { value: row.id }, [row.label])),
      ]),
      fileInput,
      h('button', { type: 'button', class: 'btn', disabled, onClick: () => fileInput.click() }, [siteText('状態を読込')]),
      h('button', { type: 'button', class: 'btn', disabled, onClick: onDownload }, [siteText('状態を保存')]),
      onCurrent ? h('button', { type: 'button', class: 'btn', disabled, onClick: () => { supersedeRead(); onCurrent(); } }, [siteText('適用中の値を取得')]) : '',
    ]),
    textarea,
    h('div', { class: 'preview-state-footer' }, [
      h('button', { type: 'button', class: 'btn btn-primary', disabled, title: siteText('Ctrl+Enter / ⌘Enter でも適用できます'), onClick: () => { supersedeRead(); onApply(state.text); } }, [siteText('状態を適用')]), message,
    ]),
    h('p', { class: 'hint preview-state-description' }, [siteText('交易一覧・進行率・Formの項目数などを指定できます。例は確認用データです。Minecraftとは自動接続しません。')]),
  ]);
}
