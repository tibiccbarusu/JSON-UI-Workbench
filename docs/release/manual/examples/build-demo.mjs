#!/usr/bin/env node
/** Original, font-free tutorial pack. Node built-ins only; writes a new file. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const destination = path.resolve(process.argv[2] || 'outputs/manual-demo.mcpack');
const pixel = whitePixelPng();
const ogg = await readFile(path.join(root, 'examples/revision12/pack/sounds/demo/click.ogg'));
const anchor = { anchor_from: 'top_left', anchor_to: 'top_left' };
const image = (size, offset, color) => ({ type: 'image', texture: 'textures/manual/panel', size, offset, color, keep_ratio: false, ...anchor });
const screen = {
  namespace: 'manual',
  screen: {
    type: 'screen', size: [320, 180], ...anchor,
    controls: [
      { background: image([320, 180], [0, 0], [0.04, 0.09, 0.14]) },
      { banner: image([272, 24], [24, 20], [0.2, 0.65, 0.75]) },
      { card: image([104, 64], [24, 56], [0.85, 0.63, 0.25]) },
      { switch: {
        type: 'toggle', size: [104, 24], offset: [24, 132], ...anchor,
        toggle_default_state: false, radio_toggle_group: false,
        sound_name: 'manual.demo', sound_volume: 0.8, sound_pitch: 1,
        button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: 'button.menu_select', mapping_type: 'pressed' }],
        controls: [{ face: image(['100%', '100%'], [0, 0], [0.2, 0.7, 0.65]) }],
      } },
      { detail: {
        type: 'panel', size: [144, 100], offset: [152, 56], ...anchor,
        bindings: [{ binding_type: 'view', source_control_name: 'switch', source_property_name: '#toggle_state', target_property_name: '#visible', resolve_sibling_scope: true }],
        controls: [{ fill: image(['100%', '100%'], [0, 0], [0.55, 0.42, 0.82]) }],
      } },
    ],
  },
};
const files = {
  'manifest.json': JSON.stringify({ format_version: 2, header: {
    name: 'JSON UI Workbench Manual Demo', description: 'Original font-free renderer tutorial; not a complete in-game add-on.',
    uuid: '642c15e0-9dd8-47cc-8ce8-8d752d66c45b', version: [1, 0, 0], min_engine_version: [1, 21, 0],
  }, modules: [{ type: 'resources', uuid: '5a154727-1977-4df8-a169-d7609f611e0e', version: [1, 0, 0] }] }, null, 2),
  'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/manual_demo.json'] }),
  'ui/manual_demo.json': JSON.stringify(screen, null, 2),
  'textures/manual/panel.png': pixel,
  'sounds/sound_definitions.json': JSON.stringify({ format_version: '1.20.20', sound_definitions: {
    'manual.demo': { category: 'ui', sounds: [{ name: 'sounds/manual/demo', stream: false, is3D: false }] },
  } }, null, 2),
  'sounds/manual/demo.ogg': ogg,
  'CREDITS.md': 'Original tutorial JSON and white pixel texture. OGG reused from the original revision12 fixture: 880 Hz, 0.12 seconds, Vorbis, 48 kHz, mono; see examples/revision12/pack/CREDITS-ja.md in JSON UI Workbench. No Minecraft font, texture, or recording is included.\nProject original content is offered under PolyForm Noncommercial License 1.0.0: https://polyformproject.org/licenses/noncommercial/1.0.0 .\nRequired Notice: JSON UI Workbench — PolyForm Noncommercial License 1.0.0; project license scope is described in LICENSE.md. Third-party components and imported assets retain their separate terms.\n',
};

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function whitePixelPng() {
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length); name.copy(result, 4); bytes.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([name, bytes])), bytes.length + 8);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
function storedZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(entries)) {
    const filename = Buffer.from(name), bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const crc = crc32(bytes), header = Buffer.alloc(30), index = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12); // 1980-01-01, fixed DOS date.
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    index.writeUInt32LE(0x02014b50);
    index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8);
    index.writeUInt16LE(0x21, 14);
    index.writeUInt32LE(crc, 16); index.writeUInt32LE(bytes.length, 20); index.writeUInt32LE(bytes.length, 24);
    index.writeUInt16LE(filename.length, 28); index.writeUInt32LE(offset, 42);
    local.push(header, filename, bytes); central.push(index, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const bytes = storedZip(files);
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, bytes, { flag: 'wx' });
console.log(JSON.stringify({ ok: true, pack: destination, size_bytes: bytes.length, checksum_sha256: createHash('sha256').update(bytes).digest('hex'), file: 'ui/manual_demo.json', definition: 'manual.screen' }));
