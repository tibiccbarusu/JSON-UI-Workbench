/*
  Minimal command system (S038)

  Goals:
  - Central registry of commands (id, i18n keys, shortcuts)
  - Deterministic chord normalization from KeyboardEvent
  - Safe execution (no crashes; errors can be routed to diagnostics)
  - Default behavior: do not hijack keystrokes inside text inputs

  Notes:
  - This is intentionally small and framework-free.
  - It is not a full-fledged keybinding customization system.
*/

/**
 * @typedef {{
 *  id: string,
 *  titleKey: string,
 *  descriptionKey?: string,
 *  shortcuts: string[],
 *  allowRepeat?: boolean,
 *  allowInTextInput?: boolean,
 *  consumeRepeat?: boolean,
 *  acceptsEvent?: (ev: KeyboardEvent, ctx: any) => boolean,
 *  onDisabled?: (ctx: any) => void,
 *  isEnabled?: (ctx: any) => boolean,
 *  run: (ctx: any) => void,
 * }} CommandDef
 */

/**
 * @typedef {{
 *  ok: boolean,
 *  commandId?: string,
 *  chord?: string,
 *  reason?: string,
 * }} CommandDispatchResult
 */

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

const SPECIAL_KEY_IDS = new Set([
  'Backspace',
  'Delete',
  'Escape',
  'Enter',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * @param {KeyboardEvent} ev
 * @returns {string|null}
 */
function normalizeKeyIdFromEvent(ev) {
  if (!ev) return null;

  const key = typeof ev.key === 'string' ? ev.key : '';
  if (MODIFIER_KEYS.has(key)) return null;

  // Special named keys.
  if (SPECIAL_KEY_IDS.has(key)) return key;

  // Prefer code-based normalization for letters/digits and common symbol keys,
  // so the chord is stable across shift/keyboard layouts.
  const code = typeof ev.code === 'string' ? ev.code : '';
  if (code) {
    if (code.startsWith('Key') && code.length === 4) {
      // KeyA ... KeyZ
      return code.slice(3).toUpperCase();
    }

    if (code.startsWith('Digit') && code.length === 6) {
      // Digit0 ... Digit9
      return code.slice(5);
    }

    // Common symbol keys.
    if (code === 'Equal') return '=';
    if (code === 'Minus') return '-';

    // Numpad.
    if (code === 'NumpadAdd') return 'NumpadAdd';
    if (code === 'NumpadSubtract') return 'NumpadSubtract';
  }

  // Space.
  if (key === ' ') return 'Space';

  // Single character keys.
  if (key && key.length === 1) {
    // Map '+' to '=' for display stability when the physical key is Equal.
    // (The separator in chord strings is '+'.)
    if (key === '+') return '=';

    // Letters.
    if (/[a-z]/i.test(key)) return key.toUpperCase();

    // Digits.
    if (/[0-9]/.test(key)) return key;

    // Other symbols.
    return key;
  }

  // Final fallback: use key name if it is usable.
  if (key) return key;

  return null;
}

/**
 * Normalize a KeyboardEvent into a stable chord string.
 *
 * Examples:
 * - Ctrl/Cmd+F -> "Mod+F"
 * - Ctrl/Cmd+Alt+1 -> "Mod+Alt+1"
 * - Delete -> "Delete"
 *
 * @param {KeyboardEvent} ev
 * @returns {string|null}
 */
export function normalizeChordFromEvent(ev) {
  const keyId = normalizeKeyIdFromEvent(ev);
  if (!keyId) return null;

  const parts = [];

  // "Mod" means Ctrl on Windows/Linux and Cmd on macOS.
  if (ev.metaKey || ev.ctrlKey) parts.push('Mod');
  if (ev.altKey) parts.push('Alt');
  if (ev.shiftKey) parts.push('Shift');

  parts.push(keyId);

  return parts.join('+');
}

/**
 * @param {string} keyId
 * @returns {string}
 */
function formatKeyIdForDisplay(keyId) {
  const k = String(keyId || '');
  if (k === 'NumpadAdd') return 'Numpad+';
  if (k === 'NumpadSubtract') return 'Numpad-';
  return k;
}

/**
 * Format a chord for display in the Help UI.
 *
 * @param {string} chord
 * @param {{ style?: 'generic'|'platform', isMac?: boolean }} [opts]
 * @returns {string}
 */
export function formatChordForDisplay(chord, opts = {}) {
  const style = opts.style === 'platform' ? 'platform' : 'generic';
  const isMac = Boolean(opts.isMac);

  const raw = String(chord || '');
  if (!raw) return '';

  const parts = raw.split('+').filter(Boolean);
  const out = [];

  for (const p of parts) {
    if (p === 'Mod') {
      out.push(style === 'platform' ? (isMac ? '⌘' : 'Ctrl') : 'Ctrl/Cmd');
      continue;
    }
    if (p === 'Alt') {
      out.push('Alt');
      continue;
    }
    if (p === 'Shift') {
      out.push('Shift');
      continue;
    }
    out.push(formatKeyIdForDisplay(p));
  }

  return out.join('+');
}

/**
 * Determine whether the target should be treated as a text input.
 *
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
export function isTextInputLikeTarget(target) {
  const el = /** @type {HTMLElement|null} */ (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement ? target : null);
  if (!el) return false;

  // contenteditable or rich text areas.
  try {
    if (el.isContentEditable) return true;
  } catch {
    // ignore
  }

  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;

  if (tag === 'input') {
    const type = String(el.getAttribute('type') || 'text').toLowerCase();
    // Treat most input types as text-like to avoid destructive shortcuts.
    // Exclude obvious non-text controls.
    if (['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type)) return false;
    return true;
  }

  // ARIA roles.
  const role = String(el.getAttribute('role') || '').toLowerCase();
  if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;

  return false;
}

/**
 * Create a minimal command registry + dispatcher.
 *
 * @param {{
 *  onError?: (err: unknown, info: { commandId: string, chord: string }) => void,
 *  onWarning?: (msg: string, info?: any) => void,
 * }} [opts]
 */
export function createCommandSystem(opts = {}) {
  /** @type {Record<string, CommandDef>} */
  const commandsById = {};

  /** @type {Map<string, string>} chordToCommandId */
  const chordToCommandId = new Map();

  /**
   * @param {CommandDef} cmd
   */
  function register(cmd) {
    if (!cmd || typeof cmd !== 'object') throw new Error('CMD_INVALID');

    const id = String(cmd.id || '').trim();
    if (!id) throw new Error('CMD_ID_REQUIRED');

    if (commandsById[id]) throw new Error(`CMD_ID_DUPLICATE:${id}`);

    const shortcuts = Array.isArray(cmd.shortcuts)
      ? cmd.shortcuts.map((s) => String(s || '').trim()).filter(Boolean)
      : [];

    const normalized = {
      id,
      titleKey: String(cmd.titleKey || ''),
      descriptionKey: cmd.descriptionKey ? String(cmd.descriptionKey) : undefined,
      shortcuts,
      allowRepeat: Boolean(cmd.allowRepeat),
      consumeRepeat: Boolean(cmd.consumeRepeat),
      acceptsEvent: typeof cmd.acceptsEvent === 'function' ? cmd.acceptsEvent : undefined,
      onDisabled: typeof cmd.onDisabled === 'function' ? cmd.onDisabled : undefined,
      allowInTextInput: Boolean(cmd.allowInTextInput),
      isEnabled: typeof cmd.isEnabled === 'function' ? cmd.isEnabled : undefined,
      run: cmd.run,
    };

    if (!normalized.titleKey) throw new Error(`CMD_TITLEKEY_REQUIRED:${id}`);
    if (typeof normalized.run !== 'function') throw new Error(`CMD_RUN_REQUIRED:${id}`);

    commandsById[id] = normalized;

    for (const chord of shortcuts) {
      if (!chord) continue;
      const existing = chordToCommandId.get(chord);
      if (existing) {
        if (opts.onWarning) {
          opts.onWarning('Chord already registered; keeping the first binding.', {
            chord,
            keptCommandId: existing,
            ignoredCommandId: id,
          });
        }
        continue;
      }
      chordToCommandId.set(chord, id);
    }
  }

  /**
   * @param {string} commandId
   */
  function getCommand(commandId) {
    const id = String(commandId || '').trim();
    return id && commandsById[id] ? commandsById[id] : null;
  }

  function listCommands() {
    return Object.values(commandsById);
  }

  /**
   * Dispatch a command by id.
   *
   * @param {string} commandId
   * @param {any} ctx
   * @param {string} chord
   * @returns {CommandDispatchResult}
   */
  function dispatch(commandId, ctx, chord) {
    const cmd = getCommand(commandId);
    if (!cmd) return { ok: false, reason: 'CMD_NOT_FOUND' };

    try {
      if (cmd.isEnabled && !cmd.isEnabled(ctx)) { cmd.onDisabled?.(ctx); return { ok: false, reason: 'CMD_DISABLED', commandId: cmd.id }; }

      cmd.run(ctx);
      return { ok: true, commandId: cmd.id, chord };
    } catch (err) {
      try {
        if (opts.onError) opts.onError(err, { commandId: cmd.id, chord });
      } catch {
        // ignore
      }
      return { ok: false, reason: 'CMD_ERROR', commandId: cmd.id, chord };
    }
  }

  /**
   * Handle a KeyboardEvent by resolving and dispatching a registered command.
   * Returns true if a command was executed.
   *
   * @param {KeyboardEvent} ev
   * @param {any} ctx
   */
  function handleKeydown(ev, ctx) {
    if (!ev || ev.defaultPrevented || ev.isComposing || ev.keyCode === 229 || ev.getModifierState?.('AltGraph')) return false;
    const chord = normalizeChordFromEvent(ev);
    if (!chord) return false;

    const commandId = chordToCommandId.get(chord);
    if (!commandId) return false;

    const cmd = getCommand(commandId);
    if (!cmd) return false;

    // 文脈判定は既定動作を抑止する前に行う。
    if (cmd.acceptsEvent && !cmd.acceptsEvent(ev, ctx)) return false;
    // 一回単位コマンドは受理した領域だけrepeatを消費し、再実行しない。
    if (ev.repeat && !cmd.allowRepeat) {
      if (cmd.consumeRepeat && (!isTextInputLikeTarget(ev.target) || cmd.allowInTextInput)) { ev.preventDefault(); ev.stopPropagation(); }
      return false;
    }

    // Do not hijack keys when typing, unless allowed.
    if (isTextInputLikeTarget(ev.target) && !cmd.allowInTextInput) return false;

    // Prevent default browser action and stop bubbling.
    try {
      ev.preventDefault();
      ev.stopPropagation();
    } catch {
      // ignore
    }

    const res = dispatch(commandId, ctx, chord);
    return Boolean(res && res.ok);
  }

  return {
    register,
    execute: (id, ctx) => dispatch(id, ctx, ''),
    listCommands,
    getCommand,
    handleKeydown,
  };
}
