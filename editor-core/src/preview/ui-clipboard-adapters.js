// Exact local-original UI adapters. Browser permission and native parity are separate.
const SOURCE = 'realms-invite-link-mock-v1';
const REALMS_DEFINITIONS = new Set(['realms_invite_link_settings.link_panel',
  'realms_invite_link_settings.general_content', 'realms_invite_link_settings.section_content_panels']);
const own = (object, key) => Object.hasOwn(object || {}, key) ? object[key] : undefined;

/** Explicit raw state only: no representative data, nearby label, TTS, or account lookup. */
export function buildClipboardDataSources(rawMockData = {}) {
  const text = own(rawMockData, '#realm_invite_link_url');
  if (typeof text !== 'string' || text.length > 8192 || /[\u0000-\u0020\u007f]/u.test(text)) return Object.freeze({});
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return Object.freeze({});
  } catch { return Object.freeze({}); }
  return Object.freeze({ [SOURCE]: Object.freeze({ text, evidence: 'preview-simulated', contract: SOURCE }) });
}

/** null = not registered; otherwise an engine-shaped result, never an OS write. */
export function resolveClipboardAdapter(options = {}) {
  const { screenDefinition, action, clipboardDataSources = {}, scope } = options;
  const path = options.screenPath || options.file?.path || '';
  const realms = path === 'ui/realms_invite_link_settings_screen.json' && REALMS_DEFINITIONS.has(screenDefinition)
    && action === 'button.realms_copy_invite_link';
  const unknownPayload = path === 'ui/chat_screen.json' && screenDefinition === 'chat.chat_screen' && action === 'copy_coordinates_button'
    || path === 'ui/content_log_history_screen.json' && screenDefinition === 'content_log_history.content_log_history_screen' && action === 'button.copy_to_clipboard';
  if (!realms && !unknownPayload) return null;
  const fail = (code, message, status = 'unsupported') => ({ status, effects: [], diagnostics: [{ code, message }] });
  if (options.pocket === true) return fail('INTERACTION_POCKET_BLOCKED', 'Pocket版のコピー操作には対応していません。', 'blocked');
  if (options.enabled !== true) return fail('INTERACTION_MODE_OFF', 'プレビュー操作はOFFです。', 'blocked');
  if (unknownPayload) return fail('COPY_ADAPTER_PAYLOAD_UNVERIFIED', 'この画面の正確なコピー内容は未確認です。表示文字の編集支援コピーを利用できます。');
  const source = own(clipboardDataSources, SOURCE);
  if (source?.contract !== SOURCE || source?.evidence !== 'preview-simulated'
    || !own(buildClipboardDataSources({ '#realm_invite_link_url': source?.text }), SOURCE)) {
    return fail('COPY_ADAPTER_DATA_UNAVAILABLE', '明示したプレビュー用の招待URLがありません。状態JSONの #realm_invite_link_url にHTTPSの文字列を指定してください。');
  }
  return { status: 'applied', effects: [{ type: 'clipboardWriteText', intent: Object.freeze({
    kind: 'clipboardWriteText', mode: 'adapter', text: source.text, sourceLabel: 'Realms招待URL（プレビュー用）',
    scope, evidence: 'preview-simulated', dataSourceContract: SOURCE,
  }) }], diagnostics: [{ code: 'COPY_ADAPTER_PREVIEW_ONLY', message: '明示したプレビュー用URLをコピーします。実機との一致は未確認です。' }] };
}
