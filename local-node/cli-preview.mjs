/** Diagnostic SVG only. This does not claim texture/font/native-model raster parity. */
import { consoleText } from './console-i18n.mjs';
import { cliError } from './cli-files.mjs';

const xml = value => String(value ?? '').replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '\ufffd')
  .replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const number = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(3)) : 0;

export function buildStructureSvg(frame, { width, height, qualifiedName, frameIndex, fps, logicalWidth = width, logicalHeight = height, language = 'ja' }) {
  if (!Array.isArray(frame?.layout?.boxes)) throw cliError('CLI_FRAME_INVALID', 'フレームのレイアウト情報が不正です。');
  const boxes = frame.layout.boxes;
  const shapes = [];
  for (const [index, box] of boxes.entries()) {
    const x = number(box.x), y = number(box.y), w = Math.max(0, number(box.w)), h = Math.max(0, number(box.h));
    if (!w || !h) continue;
    const color = box.type === 'label' ? '#a78bfa' : box.type === 'image' ? '#38bdf8' : box.type === 'button' ? '#34d399' : '#94a3b8';
    const alpha = Math.max(0.08, Math.min(1, number(box.renderAlpha ?? 1)));
    shapes.push(`<g opacity="${alpha}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" fill-opacity="0.04" stroke="${color}" stroke-width="0.6"><title>${xml(box.id)} (${xml(box.type)})</title></rect>`
      + (w > 24 && h > 8 ? `<text x="${x + 2}" y="${y + 7}" font-family="sans-serif" font-size="6" fill="${color}">${index}: ${xml(box.type)}</text>` : '') + '</g>');
  }
  const metadata = { schema: 'jsonui-cli-structure-svg-v1', image_kind: 'diagnostic_layout', product_raster: false,
    textures_rendered: false, localized_glyphs_rendered: false, native_3d_rendered: false,
    qualified_name: qualifiedName, frame_index: frameIndex, fps, time_seconds: frameIndex / fps, box_count: boxes.length };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 34}" viewBox="0 0 ${width} ${height + 34}">\n`
    + `<title>JSON UI ${xml(consoleText('構造診断', language))}: ${xml(qualifiedName)}</title><desc>${xml(consoleText('実 API の指定フレームから生成した境界図です。製品プレビュー画像ではありません。テクスチャ・文字描画・3D の一致検証には使用できません。', language))}</desc>`
    + `<metadata>${xml(JSON.stringify(metadata))}</metadata><rect width="100%" height="100%" fill="#111827"/>`
    + `<text x="8" y="12" font-family="sans-serif" font-size="9" fill="#f8fafc">${xml(consoleText('構造診断', language))} / ${xml(qualifiedName)} / frame ${frameIndex} @ ${fps} fps</text>`
    + `<text x="8" y="25" font-family="sans-serif" font-size="8" fill="#fbbf24">${xml(consoleText('境界図: テクスチャ・文字・3D の実機画像ではありません', language))}</text>`
    + `<svg x="0" y="34" width="${width}" height="${height}" viewBox="0 0 ${logicalWidth} ${logicalHeight}">${shapes.join('')}</svg></svg>\n`;
}
