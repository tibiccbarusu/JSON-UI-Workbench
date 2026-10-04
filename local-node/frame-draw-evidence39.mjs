/** Bounded opt-in evidence from the exact dictionaries passed to the painter.
 * It records prepared draw inputs, not a native rendering or click certificate. */
import { createHash } from 'node:crypto';
import { computeImageDrawGeometry41 } from '../editor-core/src/preview/canvas-preview.js';
import { createInputImageGeometryAudit } from './input-image-geometry.mjs';

export const DRAW_EVIDENCE_LIMITS = Object.freeze({ nodes: 512, textCodeUnits: 4096,
  textUtf8Bytes: 64 * 1024, jsonBytes: 1024 * 1024 });
const digest = value => createHash('sha256').update(value).digest('hex');

/** @param {{boxes: object[], textDrawById: object, imageDrawById: object,
 * provenance?: object[], width: number, height: number, uiScale: number,
 * locale: string, fontProfile: string, frameSummary?: object}} input */
export function buildDrawEvidence(input) {
  const { boxes, textDrawById, imageDrawById, provenance = [], width, height, uiScale, locale, fontProfile, frameSummary } = input;
  const result = { schema: 'jsonui-draw-evidence-v1', scope: 'final-painter-inputs',
    native_verified: false, complete: true, limits: DRAW_EVIDENCE_LIMITS,
    locale, font_profile: fontProfile, ui_scale: uiScale,
    frame_fingerprint_sha256: frameSummary?.frame_sha256 || null,
    request_sha256: frameSummary?.request_sha256 || null,
    candidate_nodes: 0, omitted_nodes: 0, text_utf8_bytes: 0, truncated_text_nodes: 0, reasons: [], nodes: [] };
  const idMap = Object.create(null);
  const identify = id => {
    const original = String(id);
    if (original.length <= 4096 && !original.startsWith('sha256:')) return original;
    const key = `sha256:${digest(original)}`;
    idMap[key] = original;
    return key;
  };
  const pruneIdMap = () => {
    const retained = new Set(result.nodes.flatMap(row => [row.node_id, row.input_geometry?.input_node_id]));
    for (const key of Object.keys(idMap)) if (!retained.has(key)) delete idMap[key];
    if (Object.keys(idMap).length) result.node_id_map = idMap;
    else delete result.node_id_map;
  };
  const auditInput = createInputImageGeometryAudit(boxes, { x: 0, y: 0, w: width, h: height });
  const reason = code => { result.complete = false; if (!result.reasons.includes(code)) result.reasons.push(code); };
  for (const box of boxes) {
    if (box.w <= 0 || box.h <= 0 || box.renderAlpha === 0 || box.x >= width || box.y >= height || box.x + box.w <= 0 || box.y + box.h <= 0) continue;
    const clip = box.clipRect;
    if (clip && (clip.w <= 0 || clip.h <= 0 || box.x >= clip.x + clip.w || box.y >= clip.y + clip.h || box.x + box.w <= clip.x || box.y + box.h <= clip.y)) continue;
    const text = textDrawById[box.id], image = imageDrawById[box.id];
    if (!text && !image) continue;
    result.candidate_nodes++;
    if (result.nodes.length >= DRAW_EVIDENCE_LIMITS.nodes) { result.omitted_nodes++; reason('DRAW_EVIDENCE_NODE_LIMIT'); continue; }
    const row = { node_id: identify(box.id), type: box.type,
      box: { x: box.x, y: box.y, w: box.w, h: box.h }, clip: clip || null,
      alpha: box.renderAlpha ?? 1 };
    if (text) {
      const original = String(text.text ?? ''); let sample = '', bytes = 0;
      for (const char of original) {
        const nextBytes = Buffer.byteLength(char, 'utf8');
        if (sample.length + char.length > DRAW_EVIDENCE_LIMITS.textCodeUnits
          || result.text_utf8_bytes + bytes + nextBytes > DRAW_EVIDENCE_LIMITS.textUtf8Bytes) break;
        sample += char; bytes += nextBytes;
      }
      result.text_utf8_bytes += bytes;
      const truncated = sample.length !== original.length;
      if (truncated) { result.truncated_text_nodes++; reason('DRAW_EVIDENCE_TEXT_LIMIT'); }
      row.text = { value: sample, sha256: digest(original), code_units: original.length, truncated,
        state: text.state, backend: text.fontBackend, font_px: text.fontPx,
        color: text.color, alignment: text.align, vertical_alignment: text.verticalAlign,
        layout_width: text.bitmapLayout?.width ?? null, layout_height: text.bitmapLayout?.height ?? null };
    }
    if (image) {
      const layers = image.imageLayers || [image];
      row.image = { state: image.state, draw_geometry: computeImageDrawGeometry41(box, image, { x: 0, y: 0, w: width, h: height }), layer_count: layers.length, layers: layers.slice(0, 8).map(layer => {
        const matches = provenance.filter(p => p.kind === 'texture' && p.packPath === layer.packPath);
        const source = matches.length === 1 ? matches[0] : null;
        return { path: layer.packPath || null, width: layer.width ?? null, height: layer.height ?? null,
          source: source?.source ?? null, sha256: source?.sha256 ?? null, provenance_matches: matches.length };
      }) };
      if (layers.length > 8) reason('DRAW_EVIDENCE_LAYER_LIMIT');
      const inputGeometry = auditInput(box, row.image.draw_geometry);
      if (inputGeometry) {
        if (inputGeometry.input_node_id !== undefined) inputGeometry.input_node_id = identify(inputGeometry.input_node_id);
        row.input_geometry = inputGeometry;
        if (!inputGeometry.complete) reason(inputGeometry.reason);
      }
    }
    result.nodes.push(row);
  }
  // Enforce the serialized budget as well as count/text limits. Accounting is
  // recomputed from retained nodes so omitted tail records cannot inflate it.
  pruneIdMap();
  while (Buffer.byteLength(JSON.stringify(result)) > DRAW_EVIDENCE_LIMITS.jsonBytes && result.nodes.length) {
    result.nodes.pop(); result.omitted_nodes++; reason('DRAW_EVIDENCE_JSON_LIMIT');
    pruneIdMap();
  }
  result.text_utf8_bytes = result.nodes.reduce((sum, n) => sum + (n.text ? Buffer.byteLength(n.text.value) : 0), 0);
  result.truncated_text_nodes = result.nodes.filter(n => n.text?.truncated).length;
  return result;
}
