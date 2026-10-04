// Pure, bounded copies of text actually prepared for a committed canvas frame.
// No binding evaluation, DOM, Clipboard API, or hidden/source text recovery.
import { parseBedrockText } from './bitmap-font.js';

export const TEXT_COPY_LIMITS = Object.freeze({ codeUnits: 65536, nodes: 2000, depth: 64 });

export function sameClipboardScope(left, right) {
  if (!left || !right) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}

/** Check sensitivity before touching text; failed segments never retain a payload. */
export function createRenderedTextSegment(options = {}) {
  const base = { nodeId: String(options.nodeId || ''), provenance: options.provenance || 'displayed' };
  const fail = code => Object.freeze({ ...base, status: 'unavailable', code });
  if (options.visible === false) return Object.freeze({ nodeId: base.nodeId, status: 'excluded', code: 'COPY_NOT_VISIBLE' });
  if (options.secret === true) return fail('COPY_SECRET_TEXT');
  if (options.unresolved === true) return fail('COPY_TEXT_UNRESOLVED');
  if (options.ready !== true) return fail('COPY_TEXT_NOT_READY');
  if (typeof options.text !== 'string') return fail('COPY_TEXT_UNRESOLVED');
  if (options.text.length > TEXT_COPY_LIMITS.codeUnits) return fail('COPY_TEXT_LIMIT');
  if (/§k/iu.test(options.text)) return fail('COPY_OBFUSCATED_TEXT');
  try {
    const parsed = parseBedrockText(options.text);
    if (parsed.diagnostics.length) return fail('COPY_FORMAT_UNSUPPORTED');
    return Object.freeze({ ...base, status: 'ready', text: parsed.characters.map(item => item.character).join('') });
  } catch {
    return fail('COPY_TEXT_LIMIT');
  }
}

/** Store safe segments and topology only, never references to raw node props. */
export function buildRenderedTextSnapshot({ scope, renderRevision = 0, nodes = [], segments = [], pocket = false } = {}) {
  const nodesById = Object.create(null), segmentsById = Object.create(null);
  for (const node of nodes) {
    const id = String(node.id);
    nodesById[id] = Object.freeze({ id, parentId: node.parentId == null ? null : String(node.parentId),
      visible: node.visible !== false, secret: node.secret === true,
      children: Object.freeze((node.children || []).map(String)), unsupportedText: node.unsupportedText === true });
  }
  for (const segment of segments) if (segment && Object.hasOwn(nodesById, segment.nodeId)) segmentsById[segment.nodeId] = segment;
  return Object.freeze({ scope: Object.freeze({ ...scope }), renderRevision, pocket,
    nodesById: Object.freeze(nodesById), segmentsById: Object.freeze(segmentsById) });
}

/** Aggregate the selected element and visible descendants in display-tree order. */
export function describeSelectedTextCopy(snapshot, selectedNodeIds, { scope = snapshot?.scope } = {}) {
  const unavailable = code => ({ status: 'unavailable', code });
  if (!snapshot || !sameClipboardScope(snapshot.scope, scope)) return unavailable('COPY_SNAPSHOT_STALE');
  if (snapshot.pocket) return unavailable('COPY_POCKET_BLOCKED');
  const ids = Array.isArray(selectedNodeIds) ? selectedNodeIds : [selectedNodeIds];
  if (!ids.length || ids.some(id => !id || !Object.hasOwn(snapshot.nodesById, String(id)))) return unavailable('COPY_SELECTION_NOT_READY');
  const seen = new Set(), output = [], provenance = new Set();
  let codeUnits = 0;
  const pending = ids.slice().reverse().map(id => ({ id: String(id), depth: 0 }));
  while (pending.length) {
    const { id, depth } = pending.pop();
    if (seen.has(id)) continue;
    if (depth > TEXT_COPY_LIMITS.depth || seen.size >= TEXT_COPY_LIMITS.nodes) return unavailable('COPY_SELECTION_LIMIT');
    seen.add(id);
    const node = snapshot.nodesById[id];
    if (!node) continue;
    if (node.visible && node.secret) return unavailable('COPY_SECRET_TEXT');
    if (node.visible && node.unsupportedText) return unavailable('COPY_RENDERER_UNSUPPORTED');
    const segment = node.visible ? snapshot.segmentsById[id] : null;
    if (segment?.status === 'unavailable') return unavailable(segment.code);
    if (segment?.status === 'ready' && segment.text.length) {
      codeUnits += segment.text.length + (output.length ? 1 : 0);
      if (codeUnits > TEXT_COPY_LIMITS.codeUnits) return unavailable('COPY_TEXT_LIMIT');
      output.push(segment.text);
      provenance.add(segment.provenance);
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) pending.push({ id: node.children[index], depth: depth + 1 });
  }
  if (!output.length) return unavailable('COPY_NO_DISPLAYED_TEXT');
  return Object.freeze({ status: 'ready', code: 'COPY_TEXT_READY', text: output.join('\n'),
    count: output.length, codeUnits, provenance: Object.freeze([...provenance]),
    scope: snapshot.scope, renderRevision: snapshot.renderRevision });
}

export function clipboardStatusMessage(code) {
  return ({
    COPY_SNAPSHOT_STALE: '表示を更新しています。描画完了後にもう一度コピーしてください。',
    COPY_SELECTION_NOT_READY: 'プレビューで表示された要素を選択してください。',
    COPY_POCKET_BLOCKED: 'Pocketはプレビュー不可のため、表示文字コピーの対象外です。',
    COPY_SECRET_TEXT: 'パスワードなどの秘密文字を含むため、コピーできません。',
    COPY_OBFUSCATED_TEXT: '難読化された文字を含むため、元の文字はコピーしません。',
    COPY_TEXT_UNRESOLVED: '未解決の表示文字を含むため、コピーできません。',
    COPY_TEXT_NOT_READY: '文字の描画が未完了です。描画完了後にもう一度コピーしてください。',
    COPY_FORMAT_UNSUPPORTED: '表示と一致を確認できない書式を含むため、コピーできません。',
    COPY_RENDERER_UNSUPPORTED: '文字を取得できない描画要素を含むため、コピーできません。',
    COPY_SELECTION_LIMIT: '選択範囲が大きすぎます。小さい要素を選択してください。',
    COPY_TEXT_LIMIT: '文字数の上限を超えています。小さい要素を選択してください。',
    COPY_NO_DISPLAYED_TEXT: '選択範囲にコピーできる表示文字がありません。',
    COPY_BUSY: 'コピー処理中です。完了後にもう一度操作してください。',
    COPY_FEATURE_DISABLED: 'このコピー機能はOFFです。',
    COPY_WAITING: 'コピーの応答を待っています。送信済みの書き込みは取り消せません。',
    COPY_GESTURE_REQUIRED: 'コピーボタンを直接操作してください。',
    COPY_API_UNAVAILABLE: '自動コピーを利用できません。この文字を選択してコピーできます。',
    COPY_WRITE_DENIED: 'ブラウザがコピーを許可しませんでした。この文字を選択してコピーできます。',
    COPY_WRITE_FAILED: 'コピーに失敗しました。この文字を選択してコピーできます。',
    COPY_WRITING: 'コピー処理中です。',
    COPY_WRITTEN: 'コピーしました。',
  })[code] || 'この表示文字はコピーできません。';
}
