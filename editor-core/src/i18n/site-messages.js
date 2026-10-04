import { WORKSPACE_STUDIO_MESSAGES } from './workspace-studio-translations21.js';
import { CONSOLE_MESSAGES } from './console-message-table14.js';
import { SITE_UI_MESSAGES } from './site-ui-translations.js';
import { EXTRA_SITE_MESSAGES } from './site-message-translations.js';
import { WORKSPACE_INTENT_MESSAGES } from './workspace-intent-translations20.js';

// Site-owned messages only. Never pass pack text, JSON, paths or input values
// through this module merely because they contain Japanese. No DOM, I/O,
// timers, runtime code generation or automatic translation services are used.
export const SITE_MESSAGES = Object.freeze({ ...CONSOLE_MESSAGES, ...EXTRA_SITE_MESSAGES, ...SITE_UI_MESSAGES, ...WORKSPACE_INTENT_MESSAGES, ...WORKSPACE_STUDIO_MESSAGES,
  "追加・削除": "Add / delete",
  "このUIの通常配置だけ。追加先の親を選び、位置をクリック。生成枠は対象外。": "Only ordinary placements in this UI. Select the parent and click a location. Generated slots are not supported.",
  "構造変更の前に未確定の変更を確定してください。": "Commit pending edits before changing the structure.",
  "共有元を変更します。他のUIへの影響を確認してください。": "Edits the shared source. Review the effect on other UIs.",
  "追加ボタンには操作を自動設定しません。Minecraft側の割り当てを別途設定してください。": "New buttons have no automatic action. Configure their Minecraft input mapping separately.",
  "追加画像のテクスチャは、追加後に属性で指定してください。": "Set the new image texture in its properties after adding it.",
  "この表示部品を移動します。画面共通の入力パネルへの自動拡大は行いません。": "Move this visual component without automatically expanding to the shared screen input panel.",
  "直接選択した操作本体と、その配下を同じ単位で編集します。": "Edit the explicitly selected input owner and its descendants together.",
  "操作本体と通常・ホバー・押下などの子要素を同じ単位で編集します。": "Edit the input owner together with its default, hover and pressed-state elements.",
  "入力パネルの背景・アイテム・状態表示・操作を同じ単位で編集します。": "Edit the input panel background, item, state displays and interaction together.",
  "変更対象の配下（現在の解析条件）: {0}要素{1}": "Descendants of the editing target (current analysis): {0} elements{1}",
  "追加・削除や継承変更などの構造編集を「JSON UIに確定」してから、次の要素を編集してください。": "Commit structural changes, such as adding, deleting or changing inheritance, before editing another element.",
  "Minecraftへ反映する編集範囲": "Editing scope applied in Minecraft",
  "選択した表示部品を変更します。画像だけの編集ではMinecraftの操作位置は移動しません。親の操作要素を直接選択した場合は、その要素自身を変更します。": "Edit the selected component. Moving an image does not move its Minecraft input area. Selecting an input parent directly edits that parent itself.",
  "Minecraftのボタン・入力欄・スロットの操作本体を、表示と一緒に移動します。サイト内の動作確認ON/OFFとは別です。生成スロット1枠の独立移動は対象外です。": "Move the Minecraft button, input field or slot owner together with its visuals. This is independent of browser preview interaction. Individual generated inventory slots are not supported.",
  "このスロットは共通テンプレートから生成されています。現在の版では1枠だけの独立移動に未対応です。全体への適用に同意しても1枠だけの変更にはなりません。": "This slot is generated from a shared template. This version does not support moving a single generated slot independently. Consenting to a template-wide change does not isolate one slot.",
  "待機中に編集設定または原文が変わりました。変更は追加していません。対象と設定を確認して操作し直してください。": "Editing settings or source changed while waiting. No edit was added. Check the target and settings before trying again.",
  "実際に移動する要素を確認できません。要素を選び直してください。": "The actual move target could not be resolved. Select the element again.",
  "共有・生成テンプレートはまとめて移動できません。1要素を選択し、影響範囲を確認してください。": "Shared or generated templates cannot be moved as a group. Select one element and check its scope.",
  "Minecraft側の操作要素全体": "Minecraft input owner",
  "数値は実際に変更する操作本体の位置・サイズです。先に対象を確認してください。": "These values describe the position and size of the actual input owner. Resolve the target first.",
  "操作本体を確認": "Resolve input owner",
  "Minecraft用の操作本体を変更します。サイトの動作確認ON/OFFとは別の設定です。": "Editing the Minecraft input owner. This is separate from browser preview interaction.",
  "選択した部品自身の位置・サイズを変更します。画像だけを動かす場合は画像を選択してください。": "Edit this component's own position and size. Select an image for an image-only move.",
  '書き出しを中止しました。未解決の依存関係が {0} 件あります。下の一覧を確認してください。': 'Export stopped: {0} dependencies could not be resolved. Check the list below.',
  '書き出し結果を取得できませんでした。依存範囲を検査して詳細を確認してください。': 'The export result could not be retrieved. Check the dependency report for details.',
  '参照先を含むパックを読み込むか、原文の参照名を確認してください。': 'Load the pack containing this resource, or check the reference in the source.',
  '依存関係の検査上限に達しました。対象と診断コードを確認してください。': 'The dependency inspection limit was reached. Check the target and diagnostic code.',
  '同名定義またはパックの優先順位を確認してください。': 'Check duplicate definitions and pack priority.',
  'この参照を静的に確定できません。対象の原文と診断コードを確認してください。': 'This reference could not be resolved statically. Check the source and diagnostic code.',
  '参照: {0}': 'Reference: {0}',
  '依存範囲の検査が完了しました。{0} ファイルを書き出します。': 'Dependency inspection completed. The export contains {0} files.',
  '書き出しを止めている問題: {0} 件': 'Issues blocking export: {0}',
  '一覧は先頭100件です。残り {0} 件は省略されています。': 'The list shows the first 100 issues. {0} additional issues are omitted.',
  '詳細は診断を先に表示し、最大24,000文字に制限しています。': 'Details show diagnostics first and are limited to 24,000 characters.',
  '注意事項: {0} 件': 'Warnings: {0}',
  '書き出し検査の詳細': 'Export inspection details',
  '標準ダイアログの依存確認': 'Standard dialog dependency checks',
  '必要な変更と素材を確認し、ゲーム側の定義への参照を維持します。': 'Required changes and assets were checked. References to the game-provided definitions are preserved.',
  '変更や参照を確認できないため、この定義の依存関係を追加で検査しています。下の理由を確認してください。': 'Changes or references could not be verified, so this definition requires further dependency checks. See the reasons below.',
  '確認項目は各定義の先頭10件です。残り {0} 件は省略されています。': 'The first 10 checks for each definition are shown. {0} additional checks are omitted.',
  '描画された画素を読み取れないため、この位置を選択できません。原文一覧または構造表示から要素を選択してください。':
    'This position cannot be selected because the rendered pixels could not be read. Select an element from the source list or structure view.',
});
let siteLocale = 'ja_JP';
export function getSiteLocale() { return siteLocale; }
export function setSiteLocale(locale) { siteLocale = locale === 'en_US' || locale === 'en' ? 'en_US' : 'ja_JP'; }
function fill(template, values) {
  return template.replace(/\{(\d+)\}/gu, (token, index) => Number(index) < values.length ? String(values[Number(index)]) : token);
}
/** Explicit source-literal marker; template values are interpolated unchanged. */
export function siteText(input, ...values) {
  if (Array.isArray(input) && Object.hasOwn(input, 'raw')) {
    const key = input.map((part, index) => part + (index < values.length ? `{${index}}` : '')).join('');
    return fill(siteLocale === 'en_US' && Object.hasOwn(SITE_MESSAGES, key) ? SITE_MESSAGES[key] : key, values);
  }
  if (typeof input !== 'string') return input;
  return siteLocale === 'en_US' && Object.hasOwn(SITE_MESSAGES, input) ? SITE_MESSAGES[input] : input;
}

const reverseMessages = new Map();
for (const [ja, en] of Object.entries(SITE_MESSAGES)) if (!reverseMessages.has(en)) reverseMessages.set(en, ja);
function patternOf(template, result) {
  const parts = template.split(/(\{\d+\})/u);
  return { prefix: parts[0], parts, result };
}
// Only templates with nonempty fixed text are eligible. Unanchored global
// replacement is deliberately excluded so embedded user text remains intact.
const templatePairs = Object.entries(SITE_MESSAGES).filter(([ja]) => /\{\d+\}/u.test(ja));
const patterns = {
  en_US: templatePairs.map(([ja, en]) => patternOf(ja, en)),
  ja_JP: templatePairs.map(([ja, en]) => patternOf(en, ja)),
};
/** Render an already-stored application diagnostic in the selected language.
 * Keep the raw diagnostic record and its code unchanged for exports. */
export function translateSiteMessage(message, locale = siteLocale) {
  if (typeof message !== 'string' || message.length > 16384) return message;
  const language = locale === 'en_US' || locale === 'en' ? 'en_US' : 'ja_JP';
  if (language === 'en_US' && Object.hasOwn(SITE_MESSAGES, message)) return SITE_MESSAGES[message];
  if (language === 'ja_JP' && reverseMessages.has(message)) return reverseMessages.get(message);
  for (const pattern of patterns[language]) {
    if (pattern.prefix && !message.startsWith(pattern.prefix)) continue;
    const values = [];
    let cursor = pattern.prefix.length, consistent = true;
    for (let part = 1; part < pattern.parts.length; part += 2) {
      const index = Number(pattern.parts[part].slice(1, -1));
      const suffix = pattern.parts[part + 1];
      // Adjacent parameters cannot be split reliably after interpolation.
      if (!suffix && part + 2 < pattern.parts.length) { consistent = false; break; }
      const end = suffix ? message.indexOf(suffix, cursor) : message.length;
      if (end < 0) { consistent = false; break; }
      const value = message.slice(cursor, end);
      if (values[index] !== undefined && values[index] !== value) { consistent = false; break; }
      values[index] = value;
      cursor = end + suffix.length;
    }
    if (consistent && cursor === message.length) return fill(pattern.result, values);
  }
  return message;
}

const TOPIC_LABELS = Object.freeze({
  'encyclopedia.anvil_section': '金床',
  'encyclopedia.brewing_stand_section': '醸造台',
  'encyclopedia.enchanting_table_section': 'エンチャント',
  'encyclopedia.furnace_section': 'かまど',
  'encyclopedia.book_and_quill_section': '本と羽根ペン',
  'encyclopedia.mounts_section': '乗り物と動物',
});
/** Only built-in help candidates have site-owned labels. Custom labels and
 * pack node names remain unchanged even if they equal a translation key. */
export function navigationChoiceLabel(choice) {
  if (choice?.fileId === 'screen:ui/how_to_play_screen.json'
    && choice.definition === 'how_to_play.how_to_play_screen' && choice.label === '遊び方') return siteText('遊び方');
  const topic = choice?.previewTopic === true && choice?.fileId === 'screen:ui/encyclopedia_screen.json'
    && Object.hasOwn(TOPIC_LABELS, choice.definition) ? TOPIC_LABELS[choice.definition] : null;
  if (topic && choice.label === `関連する説明: ${topic}（プレビュー用）`) return siteText`関連する説明: ${siteText(topic)}（プレビュー用）`;
  return choice?.label;
}
/** Translate only labels generated by a verified clipboard adapter, or the
 * broker's default. Preserve arbitrary caller labels and copied text. */
export function clipboardSourceLabel(label, intent) {
  if (typeof intent?.sourceLabel !== 'string' && label === '表示文字') return siteText('表示文字');
  if (intent?.mode === 'adapter' && intent?.evidence === 'preview-simulated'
    && intent?.dataSourceContract === 'realms-invite-link-mock-v1' && label === 'Realms招待URL（プレビュー用）') return siteText(label);
  return label;
}

/** Search both the original and displayed diagnostic, returning the original
 * records so exporting filtered results cannot rewrite recorded evidence. */
export function filterLocalizedDiagnostics(entries, options, filter) {
  const source = Array.isArray(entries) ? entries : [];
  if (!String(options?.query || '').trim()) return filter(source, options);
  return source.filter(entry => filter([entry], options).length || filter([{
    ...entry,
    message: translateSiteMessage(entry?.message),
    ...(entry?.error ? { error: { ...entry.error, message: translateSiteMessage(entry.error.message) } } : {}),
  }], options).length);
}
