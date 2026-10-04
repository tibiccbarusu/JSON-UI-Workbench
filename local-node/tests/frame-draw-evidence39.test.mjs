import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildDrawEvidence, DRAW_EVIDENCE_LIMITS } from '../frame-draw-evidence39.mjs';
const box = id => ({ id, type: 'label', x: 0, y: 0, w: 20, h: 20, renderAlpha: 1 });
const draw = text => ({ text, state: 'ready', fontBackend: 'resource-bitmap', fontPx: 8,
  align: 'left', verticalAlign: 'top', color: '#ffffff', bitmapLayout: { width: 12, height: 8 } });
const base = () => ({ boxes: [box('label')], textDrawById: { label: draw('実描画😀') }, imageDrawById: {},
  width: 100, height: 100, uiScale: 4, locale: 'ja_JP', fontProfile: 'observed-smooth',
  frameSummary: { frame_sha256: 'frame', request_sha256: 'request' } });
test('evidence preserves final painter text, placement and identity', () => {
  const result = buildDrawEvidence(base());
  assert.equal(result.complete, true); assert.equal(result.native_verified, false);
  assert.equal(result.nodes[0].text.value, '実描画😀');
  assert.equal(result.nodes[0].text.sha256, createHash('sha256').update('実描画😀').digest('hex'));
  assert.equal(result.nodes[0].text.vertical_alignment, 'top');
  assert.equal(result.frame_fingerprint_sha256, 'frame');
  assert.equal(result.request_sha256, 'request');
});
test('hidden/offscreen/fully clipped records are not published', () => {
  const input = base(); input.boxes = [{ ...box('label'), renderAlpha: 0 }, { ...box('other'), x: 101 },
    { ...box('third'), clipRect: { x: 80, y: 80, w: 10, h: 10 } }];
  input.textDrawById.other = draw('outside'); input.textDrawById.third = draw('clipped');
  assert.deepEqual(buildDrawEvidence(input).nodes, []);
});
test('text and node budgets truncate explicitly without splitting a surrogate pair', () => {
  const input = base(); input.boxes = []; input.textDrawById = {};
  for (let i = 0; i < 520; i++) { const id = String(i); input.boxes.push(box(id)); input.textDrawById[id] = draw('😀'.repeat(4096)); }
  const result = buildDrawEvidence(input);
  assert.equal(result.nodes.length, DRAW_EVIDENCE_LIMITS.nodes);
  assert.equal(result.omitted_nodes, 8); assert.equal(result.candidate_nodes, 520);
  assert.equal(result.complete, false);
  assert.ok(result.text_utf8_bytes <= DRAW_EVIDENCE_LIMITS.textUtf8Bytes);
  for (const row of result.nodes) { assert.ok(row.text.value.length <= 4096); assert.equal(row.text.value.length % 2, 0); }
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= DRAW_EVIDENCE_LIMITS.jsonBytes);
});
test('serialized budget is enforced independently of record count', () => {
  const input = base(); input.boxes = []; input.textDrawById = {};
  for (let i = 0; i < 500; i++) { const id = 'x'.repeat(4000) + i; input.boxes.push(box(id)); input.textDrawById[id] = draw('a'); }
  const result = buildDrawEvidence(input);
  assert.ok(result.omitted_nodes > 0); assert.ok(result.reasons.includes('DRAW_EVIDENCE_JSON_LIMIT'));
  assert.equal(result.nodes.length + result.omitted_nodes, 500);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= DRAW_EVIDENCE_LIMITS.jsonBytes);
  assert.equal(result.text_utf8_bytes, result.nodes.length);
});
test('texture evidence uses recorded actual resources and does not invent missing hashes', () => {
  const input = base(); input.imageDrawById.label = { state: 'ready', packPath: 'textures/a.png', width: 8, height: 8 };
  input.provenance = [{ kind: 'texture', packPath: 'textures/a.png', source: 'imported', sha256: 'actual-resource' }];
  const row = buildDrawEvidence(input).nodes[0].image.layers[0];
  assert.equal(row.source, 'imported'); assert.equal(row.sha256, 'actual-resource');
  input.provenance = []; assert.equal(buildDrawEvidence(input).nodes[0].image.layers[0].sha256, null);
});

test('ordinary one-layer raster metadata exposes its geometry; multiple native layers are not fabricated', () => {
  const input = base();
  const layer = { packPath: 'textures/p.png', width: 12, height: 24 };
  input.imageDrawById.label = { state: 'ready', ...layer, imageLayers: [layer] };
  let geometry = buildDrawEvidence(input).nodes[0].image.draw_geometry;
  assert.equal(geometry.mode, 'aspect-fit');
  assert.deepEqual(geometry.destination_rect, { x: 5, y: 0, w: 10, h: 20 });
  input.imageDrawById.label.imageLayers.push({ ...layer });
  geometry = buildDrawEvidence(input).nodes[0].image.draw_geometry;
  assert.equal(geometry.mode, 'unavailable');
});
