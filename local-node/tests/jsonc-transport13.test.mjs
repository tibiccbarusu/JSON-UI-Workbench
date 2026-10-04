import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResourceZipReader } from '../resource-zip.mjs';
import { makeZip } from './fixtures.mjs';

test('公式素材形式: 先頭BOMを受理し、文字列内のBOMと日本語を保つ', () => {
  const original = '\uFEFF{\r\n // 素材\r\n "minecraft:texture_set":{"color":"horse_white",},"label":"\uFEFF日本語"\r\n}';
  const parsed = parseJsonc(original);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value['minecraft:texture_set'].color, 'horse_white');
  assert.equal(parsed.value.label, '\uFEFF日本語');
  assert(original.startsWith('\uFEFF'));
});

test('BOMのみ・途中のBOM・破損JSONは有効なUIへ化けない', () => {
  assert.equal(parseJsonc('\uFEFF').ok, false);
  assert.equal(parseJsonc('\uFEFF', { allowEmptyContent: true }).ok, true);
  assert.equal(parseJsonc('{"a":1,\uFEFF"b":2}').ok, false);
  assert.equal(parseJsonc('\uFEFF{"a":').ok, false);
  assert.equal(parseJsonc('\uFEFF{"a":1}/*').ok, false);
  assert.equal(parseJsonc('\uFEFF{"a":1,}', { allowTrailingComma: false }).ok, false);
});

test('CR、LF、CRLFの行コメントを同じ規則で終端し、文字列内の//は維持', () => {
  for (const end of ['\r', '\n', '\r\n']) {
    const parsed = parseJsonc('// start' + end + '{"a":"http://host/*data*/", // field' + end + '"b":2}');
    assert.equal(parsed.ok, true, JSON.stringify(end));
    assert.deepEqual(parsed.value, { a: 'http://host/*data*/', b: 2 });
  }
});

test('UMD実装へ渡すBOM置換は長さを保ち、元CR/CRLF座標で診断する', () => {
  const previous = globalThis.jsoncParser;
  try {
    for (const end of ['\r', '\n', '\r\n']) {
      const original = '\uFEFF{' + end + ' "a": bad}';
      const offset = original.indexOf('bad');
      globalThis.jsoncParser = {
        parse(text, errors) {
          assert.equal(text.length, original.length);
          assert.equal(text[0], ' ');
          assert.equal(text.slice(1), original.slice(1));
          errors.push({ error: 1, offset, length: 3 });
          return null;
        },
        printParseErrorCode: () => 'InvalidSymbol',
      };
      const parsed = parseJsonc(original, { fileName: 'ui/sample.json' });
      assert.equal(parsed.ok, false);
      assert.equal(parsed.errors[0].offset, offset);
      assert.equal(parsed.errors[0].line, 2);
      assert.equal(parsed.errors[0].column, 7);
      assert.match(parsed.errors[0].message, /ui\/sample\.json:2:7/u);
    }
  } finally {
    if (previous === undefined) delete globalThis.jsoncParser;
    else globalThis.jsoncParser = previous;
  }
});

test('実ZIP原文はBOM・CRLFを保持し、不正UTF-8を代替文字で修復しない', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-bom13-'));
  const source = path.join(directory, 'input.zip');
  const text = '\uFEFF// 原文\r\n{"namespace":"test","title":{"type":"label","text":"\uFEFF日本語"}}\r\n';
  const zip = makeZip({ 'ui/test.json': text, 'ui/invalid.json': Buffer.from([0xc3, 0x28]) });
  const reader = new ResourceZipReader();
  try {
    await writeFile(source, zip);
    await reader.openFromFile({ diskPath: source, name: 'input.zip' });
    await reader.listEntries();
    const decoded = await reader.readText('ui/test.json');
    assert.equal(decoded, text);
    assert.equal(parseJsonc(decoded).ok, true);
    assert.deepEqual(Buffer.from(decoded, 'utf8'), await reader.bytes('ui/test.json'));
    await assert.rejects(reader.readText('ui/invalid.json'), { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' });
    assert.deepEqual(await readFile(source), zip);
  } finally {
    await reader.close();
    await rm(directory, { recursive: true, force: true });
  }
});
