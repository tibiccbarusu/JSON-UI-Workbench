/** Optional, resource-backed Node PNG output using the product Canvas renderer. */
import { createRequire } from 'node:module';
import { createBitmapGlyphTintCache } from '../editor-core/src/preview/bitmap-glyph-tint26.js';
import { createHash } from 'node:crypto';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { drawCanvasPreview, buildImageDrawMetadataFromProps, getBedrockLogicalFontPx, mergeExplicitTextureBaseSize } from '../editor-core/src/preview/canvas-preview.js';
import { layoutBitmapText, normalizeBitmapFontType, parseBedrockText, isPrivateUseSheet } from '../editor-core/src/preview/bitmap-font.js';
import { getNativeRendererPlaceholderKind, mergeNativeRendererProps, resolveNativeRendererTexture } from '../editor-core/src/preview/native-renderer-preview.js';
import { buildEnchantingBookPreviewScene } from '../editor-core/src/preview/native-model-preview.js';
import { resolveEnchantingBookPreviewScene } from '../editor-core/src/preview/native-book-preview.js';
import { sampleNativePreviewMotion } from '../editor-core/src/preview/native-motion.js';
import { selectPreviewText, resolvePreviewVerticalAlignment } from '../editor-core/src/preview/preview-text.js';
import { FrameRasterResources, RASTER_LIMITS, rasterError } from './frame-raster-assets13.mjs';
import { inspectFrameTextureValues } from './frame-texture-state37.mjs';
import { summarizeFinalFrame } from './cli-quality38.mjs';
import { buildFontCoverage38 } from './font-coverage38.mjs';
import { buildDrawEvidence } from './frame-draw-evidence39.mjs';
import { summarizeEvaluationQuality } from '../editor-core/src/engine/evaluation-quality.js';
import { summarizeCollectionQuality } from '../editor-core/src/engine/collection-quality39.js';
import { summarizeAnimationQuality } from '../editor-core/src/engine/animation-quality41.js';
import { summarizeBindingQuality } from '../editor-core/src/engine/binding-quality40.js';

const require = createRequire(import.meta.url), own = (object, key) => Object.hasOwn(object || {}, key);
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 1));
export function loadRasterBackend() {
  for (const [module, metadata, source] of [
    ['./vendor/canvas/index.js', './vendor/canvas/package.json', 'bundled'],
    ['@napi-rs/canvas', '@napi-rs/canvas/package.json', 'installed'],
  ]) {
    try {
      const loaded = require(module);
      return { createCanvas: loaded.createCanvas, loadImage: loaded.loadImage,
        name: '@napi-rs/canvas', version: require(metadata).version, source };
    } catch { /* Other platforms may provide their own compatible optional backend. */ }
  }
  return null;
}
function runtimeToken(value, props) {
  const seen = new Set();
  for (let depth = 0; depth < 8 && typeof value === 'string' && /^[#$][\w:@.\-]+$/u.test(value.trim()); depth++) {
    const token = value.trim(); if (seen.has(token)) break; seen.add(token);
    if (own(props, token.slice(1))) value = props[token.slice(1)];
    else if (own(props, token)) value = props[token]; else break;
  }
  return value;
}
const unresolved = value => typeof value === 'string' && (/^[#$@]/u.test(value.trim()) || /^\(.*\)$/u.test(value.trim()));
function colorCss(value) {
  if (typeof value === 'string' && /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba)\([\d\s,.%]+\)|[a-z]+)$/iu.test(value)) return value;
  if (Array.isArray(value) && [3, 4].includes(value.length) && value.every(Number.isFinite)) {
    return `rgba(${value.slice(0, 3).map(v => Math.round(clamp(v) * 255)).join(',')},${clamp(value[3] ?? 1)})`;
  }
  return '#dddddd';
}
function checkedFrame(frame, width, height) {
  if (frame?.schema !== 'jsonui-frame-v1' || !Array.isArray(frame.layout?.boxes)
    || frame.layout.boxes.length > RASTER_LIMITS.boxes || frame.layout.stats?.truncated
    || frame.layout.preset?.width !== width || frame.layout.preset?.height !== height) {
    throw rasterError('RASTER_FRAME_INVALID', '寸法が一致する完全なフレーム IR が必要です。');
  }
  const seen = new Set();
  for (const box of frame.layout.boxes) {
    if (typeof box.id !== 'string' || seen.has(box.id) || ![box.x, box.y, box.w, box.h].every(Number.isFinite)
      || [box.x, box.y, box.w, box.h].some(n => Math.abs(n) > 1e8)) throw rasterError('RASTER_BOX_INVALID', '描画矩形の識別子または数値が不正です。');
    seen.add(box.id);
  }
  return frame;
}
function visibleBox(box, width, height) {
  if (box.w <= 0 || box.h <= 0 || box.renderAlpha === 0 || box.x >= width || box.y >= height || box.x + box.w <= 0 || box.y + box.h <= 0) return false;
  const c = box.clipRect;
  return !c || (c.w > 0 && c.h > 0 && box.x < c.x + c.w && box.y < c.y + c.h && box.x + box.w > c.x && box.y + box.h > c.y);
}
// No await may run while browser names are installed. Restore exact descriptors,
// including absence, after both success and native draw failure.
function synchronousCanvas(backend, width, height, draw) {
  const changes = { window: { devicePixelRatio: 1 }, OffscreenCanvas: function (w, h) { return backend.createCanvas(w, h); },
    document: { documentElement: {}, createElement(name) { if (name !== 'canvas') throw rasterError('RASTER_DOM_UNSUPPORTED', 'Canvas 以外の DOM は使用できません。'); return backend.createCanvas(1, 1); } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }) };
  const descriptors = new Map();
  try {
    for (const [key, value] of Object.entries(changes)) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      if (descriptor && !descriptor.configurable) throw rasterError('RASTER_GLOBAL_CONFLICT', '描画互換環境を一時設定できません。');
      descriptors.set(key, descriptor); Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    }
    const canvas = backend.createCanvas(width, height);
    canvas.getBoundingClientRect = () => ({ width, height });
    draw(canvas);
    const png = canvas.toBuffer('image/png');
    if (!Buffer.isBuffer(png) || png.length > 96 * 1024 * 1024) throw rasterError('RASTER_OUTPUT_LIMIT', 'PNG 出力サイズが上限を超えました。');
    return png;
  } finally {
    for (const [key, descriptor] of [...descriptors].reverse()) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

/** No backend installation/network download is performed here.
 * complete describes supported resource resolution, never Minecraft pixel parity.
 * frameRequest preserves the caller's exact animation/runtime/scroll settings
 * when resource glyph measurements require a second worker layout pass. */
export async function renderFramePng({ client, sources, projection, frame, width, height, uiScale = 1, locale = 'en_US',
  backend = undefined, allowPartial = false, timeSeconds = 0, targetEngineVersion, frameRequest, onProgress, fontProfile = 'bitmap', includeDrawEvidence = false } = {}) {
  const started = Date.now(), diagnostics = [], counts = { textures: 0, labels: 0, nativeModels: 0 };
  let resources, finalFrameSummary, reflowPasses = 0, collectionQuality = summarizeCollectionQuality(frame?.bindings);
  let bindingQuality = summarizeBindingQuality(frame?.bindings);
  let evaluationQuality = summarizeEvaluationQuality({ projection, frame });
  const nativeEquivalence = { status: 'not_evaluated', reason_code: 'MINECRAFT_PIXEL_PARITY_NOT_VERIFIED' };
  const issue = (error, nodeId) => {
    if (diagnostics.length >= RASTER_LIMITS.diagnostics) throw rasterError('RASTER_DIAGNOSTIC_LIMIT', '描画診断の上限に達しました。');
    diagnostics.push({ code: /^[A-Z0-9_]{1,100}$/u.test(error?.code || '') ? error.code : 'RASTER_RESOURCE_FAILED',
      message: typeof error?.message === 'string' ? error.message.slice(0, 300) : '必要な描画情報を取得できません。', ...(nodeId ? { nodeId } : {}), ...(error?.details ? { details: error.details } : {}) });
  };
  try {
    if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= RASTER_LIMITS.dimension)
      || width * height > RASTER_LIMITS.pixels || !/^[a-z]{2}_[A-Z]{2}$/u.test(locale)
      || !Number.isInteger(uiScale) || uiScale < 1 || uiScale > 8
      || !['bitmap', 'observed-smooth'].includes(fontProfile)
      || typeof allowPartial !== 'boolean' || !Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > 3600) {
      throw rasterError('RASTER_OPTIONS_INVALID', 'PNG 出力の寸法・言語・時刻設定が不正です。');
    }
    if (!projection?.ok || !projection.document || typeof projection.selected?.filePath !== 'string'
      || projection.selected.profile === 'pocket' || /(?:^|\/)pocket(?:\/|_)/iu.test(projection.selected.filePath)) {
      throw rasterError('RASTER_PROJECTION_INVALID', 'Classic UI の検証済み投影が必要です。Pocket は描画できません。');
    }
    const logicalWidth = width / uiScale, logicalHeight = height / uiScale;
    checkedFrame(frame, logicalWidth, logicalHeight);
    if (!evaluationQuality.complete && !allowPartial) throw rasterError('RASTER_EVALUATION_INCOMPLETE', '展開または走査が打ち切られています。完全なシーンとして PNG を出力できません。');
    const renderer = backend === undefined ? loadRasterBackend() : backend;
    if (!renderer || typeof renderer.createCanvas !== 'function' || typeof renderer.loadImage !== 'function') throw rasterError('RASTER_BACKEND_UNAVAILABLE', '任意の PNG 描画バックエンド @napi-rs/canvas が利用できません。JSON または SVG の構造診断を利用できます。');
    resources = new FrameRasterResources({ client, sources, backend: renderer, locale, onProgress });
    await resources.initialize();
    const model = buildUiScreenModelFromJson(projection.document, { filePath: projection.selected.filePath });
    const file = buildTreeFromUiScreenModel(model);
    if (Object.keys(file.nodesById).length > 50000) throw rasterError('RASTER_NODE_LIMIT', '投影要素数が上限を超えました。');
    const sheets = new Map(), failedSheets = new Map(), labelInfo = new Map(), imageDrawById = Object.create(null), textDrawById = Object.create(null);
    const nativeSnapshots = new Map(), imageSizing = new Map(), prepared = new Map(), labelCharacters = new Map(); let characters = 0, bookBase;
    const propsFor = id => {
      const node = file.nodesById[id];
      if (!node) throw rasterError('RASTER_NODE_MISMATCH', 'フレームと投影の要素が一致しません。', { nodeId: id });
      return mergeNativeRendererProps(node.unknownProps, node.props, frame.propsById?.[id]);
    };
    let textureValues;
    async function sheetFor(name) {
      if (sheets.has(name)) return sheets.get(name);
      if (failedSheets.has(name)) throw failedSheets.get(name);
      const row = await resources.font(name), colors = new Map();
      if (row.metrics?.format === 'msdf') {
        // Smooth glyphs retain original distance-field pixels and use the
        // shared bounded cell cache. Whole-atlas tint copies are unnecessary.
        sheets.set(name, row); return row;
      }
      const reserve = row.width * row.height * 4 * 4;
      if (resources.decodedBytes + reserve > RASTER_LIMITS.decodedBytes) throw rasterError('RASTER_FONT_TINT_LIMIT', '文字色キャッシュが画像メモリ上限を超えました。');
      resources.decodedBytes += reserve;
      const glyphTints = createBitmapGlyphTintCache(row.image, (w, h) => renderer.createCanvas(w, h));
      row.tintedGlyph = isPrivateUseSheet(name) ? null : (color, glyph) => {
        if (colors.size >= 4) colors.delete(colors.keys().next().value);
        return glyphTints.get(color, glyph);
      };
      row.tinted = color => {
        if (isPrivateUseSheet(name)) return row.image;
        if (colors.has(color)) return colors.get(color);
        if (colors.size >= 4) colors.delete(colors.keys().next().value);
        if (colors.size === 3 && glyphTints.snapshot().entries) glyphTints.clear();
        const canvas = renderer.createCanvas(row.width, row.height), context = canvas.getContext('2d');
        context.drawImage(row.image, 0, 0); context.globalCompositeOperation = 'source-in'; context.fillStyle = color;
        context.fillRect(0, 0, row.width, row.height); colors.set(color, canvas); return canvas;
      };
      sheets.set(name, row); return row;
    }
    function textLayout(info, box, drawScale = 1) {
      const authored = info.node.props?.size;
      const wrap = info.type === 'label' && info.node.propsPresent?.size === true && Array.isArray(authored)
        && String(authored[0]).toLowerCase() !== 'default' && String(authored[1]).toLowerCase() === 'default' && info.props.text_wrap !== false;
      return layoutBitmapText(info.text, { fontType: info.fontType, fontPx: info.fontPx * drawScale, color: info.color, linePadding: info.linePadding * drawScale,
        remapping: info.remapping, roundingScale: drawScale,
        ...(wrap && box.w > 0 ? { maxWidth: box.w * drawScale } : {}), getSheet: name => sheets.get(name) || { status: 'missing' } });
    }
    async function prepareFrameResources() {
      textureValues = inspectFrameTextureValues({ model, frame, projection, propsFor, resolveToken: runtimeToken,
        visibilityMode: frameRequest ? frameRequest.visibilityMode ?? 'safe' : null });
      for (const box of frame.layout.boxes) {
      const props = propsFor(box.id);
      // An intrinsic-size correction can bring a previously offscreen sibling
      // into view. Prepare every positive-size frame box and auto-sized label
      // before reflow; loading only the old viewport could publish blank pixels.
      if (box.renderAlpha === 0 || box.w < 0 || box.h < 0) continue;
      if ((!box.w || !box.h) && box.type !== 'label') continue;
      // A bounded intrinsic-layout pass may expose nodes that were absent from
      // the first frame. Resource identity ignores our own geometry overrides,
      // but includes evaluated texture/text state, so changed references reload.
      if (box.type === 'image' && textureValues.plans.get(box.id)?.acquisition !== 'required') {
        delete imageDrawById[box.id]; imageSizing.delete(box.id); prepared.delete(box.id); continue;
      }
      const { size: ignoredSize, __jsonui_preview_text_intrinsic_size: ignoredMetric, ...resourceProps } = props;
      const signature = JSON.stringify([box.type, resourceProps]);
      if (prepared.get(box.id) === signature) continue;
      prepared.set(box.id, signature);
      // A changed reference must never retain pixels from an older frame.
      delete imageDrawById[box.id]; imageSizing.delete(box.id); labelInfo.delete(box.id);
      if (['label', 'button', 'dropdown', 'edit_box'].includes(box.type)) {
        try {
          let text = selectPreviewText(box.type, props, runtimeToken);
          if (unresolved(text)) throw rasterError('RASTER_TEXT_UNRESOLVED', '文字列の実行時値が未解決です。');
          if (typeof text !== 'string') throw rasterError('RASTER_TEXT_INVALID', '文字列型の表示内容が必要です。');
          if (!text.trim()) continue;
          if (props.localize !== false) {
            const key = text.trim();
            if (own(resources.lang, key)) text = resources.lang[key];
            else if (own(resources.fallbackLang, key)) text = resources.fallbackLang[key];
            else if (/^[\w-]+(?:\.[\w-]+)+$/u.test(key)) throw rasterError('RASTER_LOCALIZATION_MISSING', '翻訳キーを解決できません。', { key });
          }
          const characterCount = Array.from(text).length;
          characters += characterCount - (labelCharacters.get(box.id) || 0); labelCharacters.set(box.id, characterCount);
          if (characters > RASTER_LIMITS.textCharacters) throw rasterError('RASTER_TEXT_LIMIT', '表示文字数が上限を超えました。');
          let fontType = normalizeBitmapFontType(props.font_type || 'default');
          if (!fontType) throw rasterError('RASTER_FONT_TYPE_UNSUPPORTED', 'この出力はリソース字体 default・unicode・rune・smooth に対応します。', { fontType: props.font_type });
          if (fontProfile === 'observed-smooth' && fontType === 'default') fontType = 'smooth';
          const remapping = fontType === 'smooth' ? await resources.remapping() : undefined;
          const parsed = parseBedrockText(text);
          if (parsed.diagnostics.length) throw rasterError('RASTER_TEXT_FORMAT_UNSUPPORTED', '未対応の文字装飾が含まれています。', { codes: parsed.diagnostics });
          const coverage = buildFontCoverage38(parsed.characters, fontType, remapping);
          for (const [name, fontCoverage] of coverage) {
            if (!name) { issue(rasterError('RASTER_CODEPOINT_UNSUPPORTED', '字体シートで表せない文字があります。', { font_coverage: fontCoverage }), box.id); continue; }
            try { await sheetFor(name); } catch (error) {
              failedSheets.set(name, error);
              issue(rasterError(error.code || 'RASTER_RESOURCE_FAILED', error.message, { ...error.details, font_coverage: fontCoverage }), box.id);
            }
          }
          const scale = Number(props.font_scale_factor ?? 1), fontPx = getBedrockLogicalFontPx(props.font_size) * scale;
          if (!Number.isFinite(fontPx) || fontPx <= 0 || fontPx > 256) throw rasterError('RASTER_FONT_SIZE_INVALID', '文字サイズが許容範囲外です。');
          const linePadding = Math.min(4096, Math.max(0, Number(props.line_padding) || 0));
          const info = { text, fontType, fontPx, linePadding, remapping, color: colorCss(props.color), props, node: file.nodesById[box.id], type: box.type };
          const layout = textLayout(info, box);
          if (!layout.ready) issue(rasterError('RASTER_GLYPH_MISSING', '必要な文字の画素がリソースにありません。', { issues: layout.issues }), box.id);
          labelInfo.set(box.id, info);
        } catch (error) { issue(error, box.id); }
      }
      if (box.type === 'image' || box.type === 'custom') {
        try {
          if (props.texture_file_system && !['InUserPackage', 'InAppPackage'].includes(props.texture_file_system)) throw rasterError('RASTER_TEXTURE_FILESYSTEM_UNSUPPORTED', 'このテクスチャのファイルシステムには対応していません。');
          let scene, snapshot, refs, ref = runtimeToken(props.texture, props);
          const nativeKind = box.type === 'custom' ? getNativeRendererPlaceholderKind(props) : null;
          if (nativeKind === 'enchanting-book') {
            bookBase ||= buildEnchantingBookPreviewScene(); scene = resolveEnchantingBookPreviewScene(bookBase, props);
            if (!scene) throw rasterError('RASTER_NATIVE_STATE_INVALID', '本の開閉状態を解決できません。');
            resources.provenance.push({ kind: 'native-model', renderer: props.renderer, modelOrigin: 'product-bounded-book-model', minecraftPixelParityVerified: false });
            refs = ['textures/entity/enchanting_table_book'];
          } else if (nativeKind === 'horse-entity' || nativeKind === 'player-entity') {
            const action = nativeKind === 'horse-entity' ? 'horse' : 'player';
            if (!nativeSnapshots.has(action)) {
              nativeSnapshots.set(action, await resources.request(`/api/node/${action}`, { payload: { sources: resources.wireSources(), targetEngineVersion } }));
              resources.provenance.push({ kind: 'native-model', renderer: props.renderer, provenance: nativeSnapshots.get(action).provenance || null });
            }
            snapshot = nativeSnapshots.get(action);
            if (snapshot.status !== 'ready' || !snapshot.scene) throw rasterError(snapshot.issue || 'RASTER_NATIVE_UNAVAILABLE', '3D モデルを解決できません。');
            scene = snapshot.scene; refs = snapshot.textureRefs?.length ? snapshot.textureRefs : [snapshot.textureRef];
          } else if (box.type === 'custom') {
            const initial = resolveNativeRendererTexture(props);
            // An explicitly hidden native progress bar has no pixels. Keep
            // unknown/visible unsupported renderers as strict-mode failures.
            if (initial?.status === 'not-applicable' && initial.empty === true) continue;
            if (props.renderer === 'inventory_item_renderer' && initial?.status === 'not-applicable') continue;
            const resolved = props.renderer === 'inventory_item_renderer' && !(initial?.source === 'preview-state' && initial.previewOverride === true)
              ? resolveNativeRendererTexture(props, await resources.itemContext()) : initial;
            if (resolved?.status !== 'resolved') throw rasterError(resolved?.issue || 'RASTER_NATIVE_UNSUPPORTED', 'このネイティブ描画には未解決の実行時情報があります。', { renderer: props.renderer });
            refs = [resolved.textureRef];
          } else {
            const plan = textureValues.plans.get(box.id);
            if (plan?.acquisition !== 'required') continue;
            ref = plan.value;
            refs = [ref];
          }
          if (refs.some(value => typeof value !== 'string' || !value || unresolved(value))) throw rasterError('RASTER_TEXTURE_UNRESOLVED', 'テクスチャ参照が未解決です。');
          const layers = []; for (const value of refs) layers.push(await resources.texture(value, snapshot));
          let metadata = buildImageDrawMetadataFromProps(props);
          if (metadata.uvSizeState === 'invalid') throw rasterError('RASTER_UV_INVALID', 'テクスチャの切抜き範囲が不正です。');
          metadata = await resources.sidecar(layers[0].packPath, { ...metadata, tiledAuthored: own(props, 'tiled') });
          const textureSize = mergeExplicitTextureBaseSize(file.nodesById[box.id], props.size, metadata.baseSize);
          if (textureSize) imageSizing.set(box.id, textureSize);
          imageDrawById[box.id] = { ...metadata, ...layers[0], imageLayers: layers, alpha: clamp(box.renderAlpha),
            state: scene ? 'native-scene' : 'ready', ...(scene ? { nativeScene: sampleNativePreviewMotion(scene, { timeMs: timeSeconds * 1000, seed: projection.selected.qualifiedName || projection.selected.filePath }) } : {}) };
          counts.textures += layers.length; if (scene) counts.nativeModels++;
        } catch (error) { issue(error, box.id); }
      }
    }
    }
    // Exact resource advances must participate in auto-size geometry, not only
    // in glyph drawing. Reissue the original frame request with size overrides.
    const overrides = { ...(frameRequest?.propsByIdOverride || {}) };
    const sameDimensionPair = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 2 && b.length === 2
      && a.every((value, i) => value === b[i] || (typeof value === 'number' && typeof b[i] === 'number'
        && Number.isFinite(value) && Number.isFinite(b[i]) && Math.abs(value - b[i]) <= 0.01));
    for (let pass = 0; pass < 4; pass++) {
      // Initial frame plus at most three revised frames. Newly exposed rail
      // images and labels participate in both resource readiness and sizing.
      await prepareFrameResources();
      const sizes = {};
      for (const box of frame.layout.boxes) {
        const currentProps = propsFor(box.id);
        const textureSize = imageSizing.get(box.id);
        if (textureSize && !sameDimensionPair(currentProps.size, textureSize)
          && ![0, 1].every(i => typeof textureSize[i] !== 'number' || Math.abs(textureSize[i] - (i ? box.h : box.w)) <= 0.01)) sizes[box.id] = { size: textureSize };
        const info = labelInfo.get(box.id); if (!info || info.type !== 'label') continue;
        const size = info.props.size || ['default', 'default'], authored = info.node.propsPresent?.size === true;
        const auto = [0, 1].map(i => !authored || String(size[i]).trim().toLowerCase() === 'default');
        const contentMetricNeeded = [info.props.size, info.props.min_size, info.props.max_size].some(vector =>
          Array.isArray(vector) && vector.some(value => typeof value === 'string' && /%cm?\b/iu.test(value)));
        if (!auto.some(Boolean) && !contentMetricNeeded) continue;
        const measured = textLayout(info, box), next = [auto[0] ? measured.width : size[0], auto[1] ? measured.height : size[1]];
        // A real min/max constraint can keep a box smaller/larger than its
        // requested size. Repeating an already-applied request cannot fix it.
        // Unapplied requests and genuinely changing wrap measurements still
        // consume the bounded passes and retain the convergence diagnostic.
        if (!sameDimensionPair(currentProps.size, next)
          && ((auto[0] && Math.abs(measured.width - box.w) > 0.01) || (auto[1] && Math.abs(measured.height - box.h) > 0.01))) sizes[box.id] = { size: next };
        const metric = [measured.width, measured.height];
        if (contentMetricNeeded && !sameDimensionPair(currentProps.__jsonui_preview_text_intrinsic_size, metric)) {
          sizes[box.id] = { ...sizes[box.id], __jsonui_preview_text_intrinsic_size: metric };
        }
      }
      if (!Object.keys(sizes).length) break;
      if (!frameRequest) { issue(rasterError('RASTER_INTRINSIC_LAYOUT_UNVERIFIED', 'リソース寸法を反映するには元の frameRequest が必要です。')); break; }
      if (pass === 3) { issue(rasterError('RASTER_LAYOUT_DID_NOT_CONVERGE', '実フォント・画像寸法による配置補正が 3 回で確定しませんでした。')); break; }
      for (const [id, size] of Object.entries(sizes)) overrides[id] = { ...overrides[id], ...size };
      frame = checkedFrame(await resources.request('/api/node/frame', { payload: { ...frameRequest, propsByIdOverride: overrides, frameTransport: undefined, previousFrameId: undefined } }), logicalWidth, logicalHeight);
      reflowPasses++;
    }
    // Readiness/provenance describes the final layout, not the preliminary one.
    for (const diagnostic of textureValues.diagnostics) issue(rasterError(diagnostic.code, diagnostic.message, diagnostic.details), diagnostic.nodeId);
    resources.provenance.push(textureValues.summary, ...textureValues.evidence);
    for (const box of frame.layout.boxes) {
      if (!visibleBox(box, logicalWidth, logicalHeight)) continue;
      if (imageDrawById[box.id]) imageDrawById[box.id].alpha = clamp(box.renderAlpha);
      if (box.type === 'image' && textureValues.plans.get(box.id)?.acquisition === 'required' && !imageDrawById[box.id]) {
        if (!diagnostics.some(row => row.nodeId === box.id)) issue(rasterError('RASTER_TEXTURE_NOT_PREPARED', '再配置後の表示画像を準備できませんでした。'), box.id);
      }
      const info = labelInfo.get(box.id); if (!info) continue;
      const bitmapLayout = textLayout(info, box, uiScale);
      if (!bitmapLayout.ready && !diagnostics.some(row => row.nodeId === box.id && row.code === 'RASTER_GLYPH_MISSING')) {
        issue(rasterError('RASTER_GLYPH_MISSING', '再配置後の文字をリソースで描画できません。', { issues: bitmapLayout.issues }), box.id);
      }
      textDrawById[box.id] = { state: bitmapLayout.ready ? 'ready' : 'missing', fontBackend: 'resource-bitmap', bitmapLayout, text: info.text,
        fontPx: info.fontPx * uiScale, color: info.color, linePadding: info.linePadding * uiScale, alpha: clamp(box.renderAlpha), shadow: Boolean(info.props.shadow),
        align: ['left', 'right', 'center'].includes(info.props.text_alignment) ? info.props.text_alignment : ['button', 'dropdown'].includes(info.type) ? 'center' : 'left',
        verticalAlign: resolvePreviewVerticalAlignment(info.type, info.props) }; if (bitmapLayout.drawable || bitmapLayout.ready) counts.labels++;
    }
    for (const warning of frame.layout.warnings || []) issue(rasterError('RASTER_LAYOUT_WARNING', String(warning)));
    finalFrameSummary = summarizeFinalFrame({ frame, projection, frameRequest, timeSeconds, fontProfile,
      provenance: resources.provenance, reflowPasses });
    evaluationQuality = summarizeEvaluationQuality({ projection, frame, modelStats: model.stats });
    collectionQuality = summarizeCollectionQuality(frame?.bindings);
    bindingQuality = summarizeBindingQuality(frame?.bindings, { model, propsById: frame.propsById,
      visibilityMode: frameRequest ? frameRequest.visibilityMode ?? 'safe' : null });
    if (Date.now() - started > RASTER_LIMITS.durationMs) throw rasterError('RASTER_TIME_LIMIT', 'PNG 出力処理の制限時間を超えました。');
    if (diagnostics.length && !allowPartial) return { ok: false, code: 'RASTER_INCOMPLETE', complete: false, preview_complete: false,
      collection_quality: collectionQuality, binding_quality: bindingQuality, animation_quality: summarizeAnimationQuality(frame?.animation), final_animation: frame?.animation, native_equivalence: nativeEquivalence, draft: false, diagnostics, provenance: resources.provenance, final_frame_summary: finalFrameSummary };
    if (!evaluationQuality.complete && !allowPartial) return { ok: false, code: 'RASTER_EVALUATION_INCOMPLETE', complete: true, preview_complete: false, evaluation_quality: evaluationQuality, native_equivalence: nativeEquivalence, draft: false, diagnostics };
    if (collectionQuality.status !== 'passed' && !allowPartial) return { ok: false, code: 'RASTER_COLLECTION_INCOMPLETE',
      complete: true, preview_complete: false, collection_quality: collectionQuality, binding_quality: bindingQuality, animation_quality: summarizeAnimationQuality(frame?.animation), final_animation: frame?.animation, native_equivalence: nativeEquivalence, draft: false, diagnostics,
      provenance: resources.provenance, final_frame_summary: finalFrameSummary };
    if (bindingQuality.status !== 'passed' && !allowPartial) return { ok: false, code: 'RASTER_BINDING_INCOMPLETE',
      complete: true, preview_complete: false, collection_quality: collectionQuality, binding_quality: bindingQuality, animation_quality: summarizeAnimationQuality(frame?.animation), final_animation: frame?.animation,
      native_equivalence: nativeEquivalence, draft: false, diagnostics,
      provenance: resources.provenance, final_frame_summary: finalFrameSummary };
    const png = synchronousCanvas(renderer, width, height, canvas => drawCanvasPreview(canvas, frame.layout,
      { zoom: uiScale, viewX: 0, viewY: 0 }, { showGuides: false, showScreenBoundary: false, showResizeHandles: false, showMissingTexturePlaceholders: false,
        imageDrawById, textDrawById,
        onImageDrawIssue: error => issue(rasterError(error.code, '画像の描画または指定された画像効果を完了できません。'), error.nodeId),
        onNativeSceneIssue: error => issue(rasterError(error.code, error.code.startsWith('NATIVE_PREVIEW_SHADE_')
          ? '3D の陰影効果を適用できないため、元のテクスチャ色で表示しています。' : '3D 描画を完了できません。'), error.nodeId) }));
    if (diagnostics.length && !allowPartial) return { ok: false, code: 'RASTER_INCOMPLETE', complete: false, preview_complete: false,
      collection_quality: collectionQuality, binding_quality: bindingQuality, animation_quality: summarizeAnimationQuality(frame?.animation), final_animation: frame?.animation, native_equivalence: nativeEquivalence, draft: false, diagnostics, provenance: resources.provenance, final_frame_summary: finalFrameSummary };
    return { ok: true, png, complete: diagnostics.length === 0, diagnostics, provenance: resources.provenance, final_frame_summary: finalFrameSummary,
      ...(includeDrawEvidence ? { draw_evidence: buildDrawEvidence({ boxes: frame.layout.boxes, textDrawById, imageDrawById,
        provenance: resources.provenance, width: logicalWidth, height: logicalHeight, uiScale, locale, fontProfile, frameSummary: finalFrameSummary }) } : {}),
      evaluation_quality: evaluationQuality,
      preview_complete: evaluationQuality.complete && diagnostics.length === 0 && collectionQuality.status === 'passed' && bindingQuality.status === 'passed',
      collection_quality: collectionQuality, binding_quality: bindingQuality, animation_quality: summarizeAnimationQuality(frame?.animation), final_animation: frame?.animation, native_equivalence: nativeEquivalence,
      draft: !evaluationQuality.complete || diagnostics.length > 0 || collectionQuality.status !== 'passed' || bindingQuality.status !== 'passed',
      rendering: { backend: renderer.name || 'injected-canvas', backend_version: renderer.version || null, backend_source: renderer.source || 'injected', product_raster: true,
        minecraft_pixel_parity_verified: false, textures_rendered: counts.textures > 0, localized_glyphs_rendered: counts.labels > 0,
        native_lighting_profile: 'bounded-face-shade-source-atop-v1', text_tint_profile: 'bounded-resource-glyph-cell-v1',
        font_profile: fontProfile,
        native_3d_rendered: counts.nativeModels > 0, width, height, logical_width: logicalWidth, logical_height: logicalHeight, ui_scale: uiScale, shared_draw_function: 'drawCanvasPreview', target_engine_version: targetEngineVersion || null, time_seconds: timeSeconds,
        counts, sha256: createHash('sha256').update(png).digest('hex'), duration_ms: Date.now() - started } };
  } catch (error) {
    return { ok: false, code: error?.code || 'RASTER_FAILED', complete: false, preview_complete: false, collection_quality: collectionQuality, binding_quality: bindingQuality, animation_quality: summarizeAnimationQuality(frame?.animation), final_animation: frame?.animation, native_equivalence: nativeEquivalence, draft: false,
      diagnostics: [...diagnostics, { code: error?.code || 'RASTER_FAILED', message: String(error?.message || 'PNG 出力に失敗しました。').slice(0, 300) }].slice(0, RASTER_LIMITS.diagnostics),
      provenance: resources?.provenance || [], ...(finalFrameSummary ? { final_frame_summary: finalFrameSummary } : {}) };
  }
}
