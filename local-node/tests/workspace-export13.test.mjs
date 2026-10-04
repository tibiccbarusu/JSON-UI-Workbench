import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkspaceExport, planWorkspaceExport } from '../workspace-export.mjs';
import { DiskZipReader } from '../disk-zip.mjs';
import { importResourcePackZip } from '../../editor-core/src/pack-io/pack-importer.js';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { parseLangFile } from '../../editor-core/src/assets/lang-table.js';
import { manifest } from './fixtures.mjs';

function source(files, options = {}) {
  const data = Object.fromEntries(Object.entries({ 'manifest.json': manifest, ...files }).map(([key, value]) => [key,
    Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))]));
  const reads = [];
  return { id: 'custom', kind: 'imported', paths: Object.keys(data), ...options, reads,
    async readText(path, maxBytes) { reads.push(path); assert(data[path], path); assert(data[path].length <= maxBytes); return data[path].toString('utf8'); },
    async readBytes(path, maxBytes) { reads.push(path); assert(data[path], path); assert(data[path].length <= maxBytes); return data[path]; },
  };
}
function options(files, rawKey = 'root', extra = {}) {
  return { sources: [source(files)], selections: [{ filePath: 'ui/main.json', rawKey }], ...extra };
}
async function withImported(result, callback) {
  assert.equal(result.ok, true, JSON.stringify(result.plan.unresolved));
  const dir = await mkdtemp(join(tmpdir(), 'jsonui-export13-')), path = join(dir, 'pack.mcpack');
  await writeFile(path, result.bytes);
  let pack;
  try {
    pack = await importResourcePackZip({ diskPath: path, name: 'pack.mcpack', size: result.bytes.length }, { zipReader: new DiskZipReader() });
    assert.equal(pack.ok, true, pack.error?.message);
    const read = path => pack.zipReader.readText(path, { maxBytes: 8 * 1024 * 1024 });
    await callback(pack, read);
  } finally { if (pack?.ok) await pack.zipReader.close(); await rm(dir, { recursive: true, force: true }); }
}
async function catalog(sources) {
  return buildUiCatalog({ parseJsonc, sources: sources.map(item => ({ ...item,
    precedence: item.kind === 'imported' ? 1 : 0, filePaths: item.paths,
    readText: (path, { maxBytes }) => item.overrides?.[path] ?? item.readText(path, maxBytes),
  })) });
}
const projection = (cat, name) => resolveEffectiveUi({ catalog: cat, recordId: cat.symbols[name].winnerId });

test('選択定義だけを登録し継承・変数texture・animationをZIP再import後も維持', async () => {
  const request = options({
    'ui/_ui_defs.json': { ui_defs: ['ui/main.json', 'ui/base.json', 'ui/unused.json'] },
    'ui/main.json': { namespace: 'screen', 'root@shared.panel': { '$image': 'textures/demo/chosen', size: [80, 60],
      controls: [{ 'caption@shared.label': { '$caption': 'demo.hello' } }] }, unused: { type: 'image', texture: 'textures/demo/unused' } },
    'ui/base.json': { namespace: 'shared', panel: { type: 'image', texture: '$image', alpha: '@fade' },
      label: { type: 'label', text: '$caption' }, fade: { anim_type: 'alpha', from: 0, to: 1, duration: 2 }, unused: { type: 'panel' } },
    'ui/unused.json': { namespace: 'unused', screen: { type: 'panel' } },
    'textures/demo/chosen.png': Buffer.from([1, 2, 3]), 'textures/demo/unused.png': Buffer.from([9]),
    'texts/en_US.lang': 'demo.hello=Hello\nunused.key=Unused\n', 'texts/ja_JP.lang': 'demo.hello=こんにちは\n',
    'font/glyph_00.png': Buffer.from([1]), 'font/glyph_30.png': Buffer.from([2]), 'font/glyph_70.png': Buffer.from([3]),
  }, 'root@shared.panel');
  const original = projection(await catalog(request.sources), 'screen.root');
  assert(original.ok);
  const result = await buildWorkspaceExport(request);
  await withImported(result, async (pack, read) => {
    const main = JSON.parse(await read('ui/main.json')), base = JSON.parse(await read('ui/base.json'));
    assert.deepEqual(Object.keys(main).sort(), ['namespace', 'root@shared.panel']);
    assert.deepEqual(Object.keys(base).sort(), ['fade', 'label', 'namespace', 'panel']);
    assert(!pack.packPaths.includes('ui/unused.json'));
    assert(!pack.packPaths.includes('textures/demo/unused.png'));
    assert(!pack.packPaths.includes('font/glyph_70.png'));
    assert.equal(await read('texts/en_US.lang'), 'demo.hello=Hello\n');
    const restored = await buildUiCatalog({ parseJsonc, sources: [{ id: 'restored', kind: 'imported', filePaths: pack.packPaths,
      readText: (path, { maxBytes }) => pack.zipReader.readText(path, { maxBytes }) }] });
    assert.deepEqual(projection(restored, 'screen.root').document, original.document);
  });
  const repeated = await buildWorkspaceExport(request);
  assert.deepEqual(result.bytes, repeated.bytes);
});

test('バニラ単体でも定義選択で書き出せる', async () => {
  const input = source({ 'ui/main.json': { namespace: 'v', root: { type: 'panel' }, second: { type: 'panel' } } }, { id: 'vanilla', kind: 'vanilla' });
  const result = await buildWorkspaceExport({ sources: [input], selections: [{ filePath: 'ui/main.json', rawKey: 'second' }] });
  await withImported(result, async (_pack, read) => assert.deepEqual(Object.keys(JSON.parse(await read('ui/main.json'))), ['namespace', 'second']));
});

test('編集overridesを出力し元sourceは変更しない', async () => {
  const input = source({ 'ui/main.json': { namespace: 'n', root: { type: 'panel', size: [10, 10] } } },
    { overrides: { 'ui/main.json': '{"namespace":"n","root":{"type":"panel","size":[30,20]}}' } });
  const before = input.overrides['ui/main.json'];
  await withImported(await buildWorkspaceExport({ sources: [input], selections: [{ filePath: 'ui/main.json', rawKey: 'root' }] }),
    async (_pack, read) => assert.deepEqual(JSON.parse(await read('ui/main.json')).root.size, [30, 20]));
  assert.equal(input.overrides['ui/main.json'], before);
});

test('上位UIが参照する下位packの継承と上位textureを一つに閉じる', async () => {
  const vanilla = source({ 'ui/base.json': { namespace: 'v', base: { type: 'image', texture: 'textures/panel' } }, 'textures/panel.png': Buffer.from([1]) }, { id: 'v', kind: 'vanilla' });
  const imported = source({ 'ui/main.json': { namespace: 'n', 'root@v.base': { size: [20, 10] } }, 'textures/panel.png': Buffer.from([2]) });
  const request = { sources: [vanilla, imported], selections: [{ filePath: 'ui/main.json', rawKey: 'root@v.base' }] };
  const result = await buildWorkspaceExport(request);
  await withImported(result, async (pack) => assert.deepEqual(await pack.zipReader.bytes('textures/panel.png'), Buffer.from([2])));
});

test('sound_name変数から候補全件・event参照閉包を残し無関係音声を除く', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'button', '$click': 'click.main', sound_name: '$click' } },
    'sounds/sound_definitions.json': { format_version: '1.14.0', sound_definitions: {
      'click.main': { category: 'ui', sounds: ['sounds/a', { name: 'sounds/b', weight: 2 }, { name: 'click.nested', type: 'event' }] },
      'click.nested': { sounds: ['sounds/c'] }, unused: { sounds: ['sounds/unused'] },
    } },
    'sounds/a.ogg': Buffer.from([1]), 'sounds/b.ogg': Buffer.from([2]), 'sounds/c.ogg': Buffer.from([3]), 'sounds/unused.ogg': Buffer.from([4]),
  }));
  await withImported(result, async (pack, read) => {
    assert.deepEqual(Object.keys(JSON.parse(await read('sounds/sound_definitions.json')).sound_definitions), ['click.main', 'click.nested']);
    assert(pack.packPaths.includes('sounds/b.ogg')); assert(pack.packPaths.includes('sounds/c.ogg')); assert(!pack.packPaths.includes('sounds/unused.ogg'));
  });
});

test('texture sidecar内のPBR素材まで含める', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'image', texture: 'textures/panel' } },
    'textures/panel.png': Buffer.from([1]), 'textures/panel.json': { nineslice_size: 2 },
    'textures/panel.texture_set.json': { 'minecraft:texture_set': { color: 'panel', normal: 'panel_normal' } },
    'textures/panel_normal.png': Buffer.from([2]), 'textures/unused.png': Buffer.from([3]),
  }));
  assert.equal(result.ok, true, JSON.stringify(result.plan.unresolved));
  assert(result.plan.files.some(file => file.path === 'textures/panel_normal.png'));
  assert(result.plan.files.some(file => file.path === 'textures/panel.json'));
});

test('global変数は選択UIから使用される連鎖だけ残す', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'image', texture: '$alias' } },
    'ui/_global_variables.json': { '$alias': '$image', '$image': 'textures/panel', '$unused': 'textures/unused' },
    'textures/panel.png': Buffer.from([1]),
  }));
  await withImported(result, async (_pack, read) => assert.deepEqual(JSON.parse(await read('ui/_global_variables.json')), { '$alias': '$image', '$image': 'textures/panel' }));
});

test('動的な必須texture・文字列は未解決にしてZIPを作らない', async () => {
  for (const value of [{ type: 'image', texture: '#runtime_texture' }, { type: 'label', text: '#runtime_text' }]) {
    const result = await buildWorkspaceExport(options({ 'ui/main.json': { namespace: 'n', root: value } }));
    assert.equal(result.ok, false); assert.equal(result.bytes, undefined); assert(result.plan.unresolved.some(item => item.code.includes('DYNAMIC')));
  }
});

test('欠落sound候補が1件あっても部分ZIPを返さない', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'button', sound_name: 'click' } },
    'sounds/sound_definitions.json': { click: { sounds: ['sounds/good', 'sounds/missing'] } }, 'sounds/good.ogg': Buffer.from([1]),
  }));
  assert(!result.ok); assert.equal(result.bytes, undefined); assert(result.plan.unresolved.some(item => item.code === 'EXPORT_SOUND_FILE_MISSING'));
});

test('複数UIで選択省略は曖昧として停止', async () => {
  const request = options({ 'ui/main.json': { namespace: 'n', root: { type: 'panel' }, second: { type: 'panel' } } });
  delete request.selections[0].rawKey;
  const result = await planWorkspaceExport(request);
  assert(!result.ok); assert(result.plan.unresolved.some(item => item.code === 'EXPORT_SELECTION_AMBIGUOUS'));
});

test('unsafe pathとcase衝突を入力境界で拒否する', async () => {
  for (const path of ['../escape.json', 'ui/../../escape', 'C:/secret', 'ui/con.json', 'ui/file.']) {
    const request = options({ 'ui/main.json': { namespace: 'n', root: { type: 'panel' } } }); request.sources[0].paths.push(path);
    await assert.rejects(buildWorkspaceExport(request), /EXPORT_PATH_UNSAFE/);
  }
  const request = options({ 'ui/main.json': { namespace: 'n', root: { type: 'panel' } } }); request.sources[0].paths.push('UI/Main.json');
  await assert.rejects(buildWorkspaceExport(request), /EXPORT_PATH_COLLISION/);
});

test('manifestの外部pack/script依存を消して完全な単独packと装わない', async () => {
  const base = JSON.parse(manifest); base.dependencies = [{ module_name: '@minecraft/server', version: '1.0.0' }];
  base.modules.push({ type: 'script', entry: 'scripts/main.js', uuid: 'a4a776e1-9e54-4c09-b12e-f9c1ad896218', version: [1, 0, 0] });
  const result = await buildWorkspaceExport(options({ 'manifest.json': base, 'ui/main.json': { namespace: 'n', root: { type: 'panel' } } }));
  assert(!result.ok); assert.equal(result.bytes, undefined);
  assert(result.plan.unresolved.some(item => item.code === 'EXPORT_EXTERNAL_PACK_DEPENDENCY'));
  assert(result.plan.unresolved.some(item => item.code === 'EXPORT_EXTERNAL_MODULE_DEPENDENCY'));
});

test('無関係な数MB素材を読み取らず、ZIP総量上限で停止する', async () => {
  const request = options({ 'ui/main.json': { namespace: 'n', root: { type: 'panel' } }, 'textures/unused.png': Buffer.alloc(2 * 1024 * 1024) });
  const result = await buildWorkspaceExport(request);
  assert(result.ok); assert(!request.sources[0].reads.includes('textures/unused.png'));
  const limited = await buildWorkspaceExport({ ...request, limits: { zipBytes: 100 } });
  assert(!limited.ok); assert.equal(limited.bytes, undefined); assert(limited.plan.unresolved.some(item => item.code === 'EXPORT_ZIP_LIMIT'));
});

test('ネイティブ描画の暗黙依存を完全同梱と偽らない', async () => {
  const result = await buildWorkspaceExport(options({ 'ui/main.json': { namespace: 'n', root: { type: 'custom', renderer: 'horse_renderer' } } }));
  assert(!result.ok); assert(result.plan.unresolved.some(item => item.code === 'EXPORT_NATIVE_RUNTIME_DEPENDENCY_UNRESOLVED'));
});

test('不正編集JSONとabortはZIPを返さない', async () => {
  const invalid = await buildWorkspaceExport(options({ 'ui/main.json': '{ invalid }' }));
  assert(!invalid.ok); assert.equal(invalid.bytes, undefined);
  const controller = new AbortController(); controller.abort();
  const aborted = await buildWorkspaceExport(options({ 'ui/main.json': { namespace: 'n', root: { type: 'panel' } } }, 'root', { signal: controller.signal }));
  assert(!aborted.ok); assert.equal(aborted.bytes, undefined);
});

test('条件付き変数のtexture・sound候補を欠かさず収集する', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'button', '$image': 'textures/a', '$sound': 'a', texture: '$image', sound_name: '$sound',
      variables: [{ requires: '$condition', '$image': 'textures/b', '$sound': 'b' }] } },
    'textures/a.png': Buffer.from([1]), 'textures/b.png': Buffer.from([2]),
    'sounds/sound_definitions.json': { a: { sounds: ['sounds/a'] }, b: { sounds: ['sounds/b'] } },
    'sounds/a.ogg': Buffer.from([3]), 'sounds/b.ogg': Buffer.from([4]),
  }));
  assert(result.ok, JSON.stringify(result.plan.unresolved));
  for (const path of ['textures/a.png', 'textures/b.png', 'sounds/a.ogg', 'sounds/b.ogg']) assert(result.plan.files.some(file => file.path === path));
});

test('UI継承循環と音声event循環は途中まで閉じても成功にしない', async () => {
  const ui = await buildWorkspaceExport(options({ 'ui/main.json': { namespace: 'n', 'root@n.base': {}, 'base@n.root': {} } }, 'root@n.base'));
  assert(!ui.ok); assert(ui.plan.unresolved.some(item => item.code === 'EXPORT_UI_INHERITANCE_CYCLE'));
  const sound = await buildWorkspaceExport(options({ 'ui/main.json': { namespace: 'n', root: { type: 'button', sound_name: 'a' } },
    'sounds/sound_definitions.json': { a: { sounds: [{ name: 'b', type: 'event' }] }, b: { sounds: [{ name: 'a', type: 'event' }] } } }));
  assert(!sound.ok); assert(sound.plan.unresolved.some(item => item.code === 'EXPORT_SOUND_EVENT_CYCLE'));
});

test('定義selection複数とfactory・gridの別ファイルtemplateを閉じる', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'factory', control_name: 'base.item' },
      second: { type: 'grid', grid_item_template: 'base.cell' }, unused: { type: 'panel' } },
    'ui/base.json': { namespace: 'base', item: { type: 'panel' }, cell: { type: 'panel' }, unused: { type: 'panel' } },
  }, 'root', { selections: [{ filePath: 'ui/main.json', rawKey: 'root' }, { filePath: 'ui/main.json', rawKey: 'second' }] }));
  await withImported(result, async (_pack, read) => {
    assert.deepEqual(Object.keys(JSON.parse(await read('ui/main.json'))), ['namespace', 'root', 'second']);
    assert.deepEqual(Object.keys(JSON.parse(await read('ui/base.json'))), ['namespace', 'cell', 'item']);
  });
});

test('継承したfactory型のcontrol_nameから別ファイル定義とtextureを閉じる', async () => {
  for (const hostKey of ['host@n.factory_alias', 'host@$factory_base']) {
    const request = options({
      'ui/main.json': { namespace: 'n', root: { type: 'panel', controls: [
        { [hostKey]: { '$factory_base': 'n.factory_alias', control_name: '@items.template' } },
      ] }, 'factory_alias@n.factory_base': {}, factory_base: { type: 'factory' } },
      'ui/items.json': { namespace: 'items', template: { type: 'image', texture: 'textures/needed' }, unused: { type: 'panel' } },
      'textures/needed.png': Buffer.from([1]), 'textures/unused.png': Buffer.from([2]),
    });
    const original = projection(await catalog(request.sources), 'n.root');
    assert.equal(original.ok, true, JSON.stringify(original.diagnostics));
    await withImported(await buildWorkspaceExport(request), async (pack, read) => {
      assert.equal(JSON.parse(await read('ui/items.json')).template.texture, 'textures/needed');
      assert.deepEqual(Object.keys(JSON.parse(await read('ui/items.json'))).sort(), ['namespace', 'template']);
      assert(pack.packPaths.includes('textures/needed.png'));
      assert(!pack.packPaths.includes('textures/unused.png'));
      const restored = await buildUiCatalog({ parseJsonc, sources: [{ id: 'restored', kind: 'imported', filePaths: pack.packPaths,
        readText: (path, { maxBytes }) => pack.zipReader.readText(path, { maxBytes }) }] });
      assert.deepEqual(projection(restored, 'n.root').document, original.document);
    });
  }
});

test('factory型の明示上書きを尊重し、動的な型のcontrol_nameを黙って落とさない', async () => {
  const overridden = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', 'root@n.factory': { type: 'panel', control_name: '@absent.template' }, factory: { type: 'factory' } },
  }, 'root@n.factory'));
  assert.equal(overridden.ok, true, JSON.stringify(overridden.plan.unresolved));
  const dynamic = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: '$kind', '$kind': 'factory', control_name: '@n.template' }, template: { type: 'panel' } },
  }));
  assert.equal(dynamic.ok, false);
  assert(dynamic.plan.unresolved.some(item => item.code === 'EXPORT_FACTORY_TYPE_UNRESOLVED'));
  assert.equal(dynamic.bytes, undefined);
});

test('実体が提供されるMinecraftTenはTTFを同梱し任意の別フォントは含めない', async () => {
  const result = await buildWorkspaceExport(options({ 'ui/main.json': { namespace: 'n', root: { type: 'label', text: 'Hello', font_type: 'MinecraftTen' } },
    'font/minecraft-ten.ttf': Buffer.from([1, 2]), 'font/unused.ttf': Buffer.from([3]) }));
  assert(result.ok, JSON.stringify(result.plan.unresolved));
  assert(result.plan.files.some(file => file.path === 'font/minecraft-ten.ttf'));
  assert(!result.plan.files.some(file => file.path === 'font/unused.ttf'));
});

test('edit_boxの両placeholder属性は継承先変数の翻訳・必要字体だけを保持する', async () => {
  for (const property of ['place_holder_text', 'placeholder_text']) {
    const request = options({
      'ui/main.json': { namespace: 'n', 'root@n.input': { '$caption': 'test.placeholder' },
        input: { type: 'edit_box', font_type: 'unicode', [property]: '$caption' } },
      'texts/ja_JP.lang': 'test.placeholder=カナ\nunused.key=不要\n',
      'font/glyph_30.png': Buffer.from([1]), 'font/glyph_70.png': Buffer.from([2]),
    }, 'root@n.input');
    await withImported(await buildWorkspaceExport(request), async (pack, read) => {
      assert.equal(await read('texts/ja_JP.lang'), 'test.placeholder=カナ\n');
      assert(pack.packPaths.includes('font/glyph_30.png'));
      assert(!pack.packPaths.includes('font/glyph_70.png'));
      assert.equal(JSON.parse(await read('ui/main.json')).input[property], '$caption');
    });
    request.sources[0].overrides = { 'texts/ja_JP.lang': 'unused.key=不要\n' };
    const missing = await buildWorkspaceExport(request);
    assert.equal(missing.ok, false);
    assert(missing.plan.unresolved.some(item => item.code === 'EXPORT_LOCALIZATION_KEY_MISSING' && item.reference === 'test.placeholder'));
    assert.equal(missing.bytes, undefined);
  }
});

test('localize:falseのplaceholderは翻訳不要でもリテラル文字の字体を保持する', async () => {
  for (const property of ['place_holder_text', 'placeholder_text']) {
    const result = await buildWorkspaceExport(options({
      'ui/main.json': { namespace: 'n', root: { type: 'edit_box', [property]: 'カナ', localize: false, font_type: 'unicode' } },
      'font/glyph_30.png': Buffer.from([1]), 'font/glyph_70.png': Buffer.from([2]),
    }));
    assert.equal(result.ok, true, JSON.stringify(result.plan.unresolved));
    assert(result.plan.files.some(file => file.path === 'font/glyph_30.png'));
    assert(!result.plan.files.some(file => file.path === 'font/glyph_70.png'));
  }
});

test('翻訳の有無とは独立にliteral文字のlocale字体を閉じ登録を安定生成する', async () => {
  for (const hasTranslation of [false, true]) {
    const request = options({
      'ui/main.json': { namespace: 'n', root: { type: 'panel', controls: [
        { literal: { type: 'label', text: 'カナ', localize: false, font_type: 'unicode' } },
        ...(hasTranslation ? [{ caption: { type: 'label', text: 'test.caption' } }] : []),
      ] } },
      'texts/en_US.lang': 'test.caption=A\nunused.key=Unused\n',
      'texts/ja_JP.lang': 'unused.key=不要\n',
      'texts/ja_JP/font/glyph_30.png': Buffer.from([1]),
      'texts/fr_FR/font/glyph_30.png': Buffer.from([2]),
      'texts/ja_JP/font/glyph_70.png': Buffer.from([3]),
      'texts/zh_CN/font/glyph_70.png': Buffer.from([4]),
    });
    await withImported(await buildWorkspaceExport(request), async (pack, read) => {
      assert(pack.packPaths.includes('texts/ja_JP/font/glyph_30.png'));
      assert(pack.packPaths.includes('texts/fr_FR/font/glyph_30.png'));
      assert(!pack.packPaths.includes('texts/ja_JP/font/glyph_70.png'));
      assert(!pack.packPaths.includes('texts/zh_CN/font/glyph_70.png'));
      assert.equal(parseLangFile(await read('texts/ja_JP.lang')).stats.entries, 0);
      assert.equal(parseLangFile(await read('texts/fr_FR.lang')).stats.entries, 0);
      assert.deepEqual(JSON.parse(await read('texts/languages.json')), ['en_US', 'fr_FR', 'ja_JP']);
      if (hasTranslation) assert.equal(await read('texts/en_US.lang'), 'test.caption=A\n');
      else {
        assert.equal(parseLangFile(await read('texts/en_US.lang')).stats.entries, 0);
        assert(!request.sources[0].reads.some(path => path.endsWith('.lang')));
      }
    });
  }
});

test('localize:falseが翻訳キーと同名でも実際のlocalized利用がなければ訳とその字体を含めない', async () => {
  for (const alsoLocalized of [false, true]) {
    const request = options({
      'ui/main.json': { namespace: 'n', root: { type: 'panel', controls: [
        { literal: { type: 'label', text: 'test.literal', localize: false, font_type: 'unicode' } },
        ...(alsoLocalized ? [{ localized: { type: 'label', text: 'test.literal', font_type: 'unicode' } }] : []),
      ] } },
      'texts/ja_JP.lang': 'test.literal=カナ\nunused.key=Unused\n',
      'font/glyph_00.png': Buffer.from([1]), 'font/glyph_30.png': Buffer.from([2]),
    });
    await withImported(await buildWorkspaceExport(request), async (pack, read) => {
      assert(pack.packPaths.includes('font/glyph_00.png'));
      assert.equal(pack.packPaths.includes('font/glyph_30.png'), alsoLocalized);
      assert.equal(pack.packPaths.includes('texts/ja_JP.lang'), alsoLocalized);
      assert.equal(pack.packPaths.includes('texts/languages.json'), alsoLocalized);
      if (alsoLocalized) assert.equal(await read('texts/ja_JP.lang'), 'test.literal=カナ\n');
      else assert(!request.sources[0].reads.includes('texts/ja_JP.lang'));
    });
  }
});

test('生成言語登録へen_USと不足空langだけを補い選択済み翻訳本文を保持する', async () => {
  for (const englishTranslation of [false, true]) {
    const result = await buildWorkspaceExport(options({
      'ui/main.json': { namespace: 'n', root: { type: 'label', text: 'test.caption' } },
      'texts/ja_JP.lang': 'test.caption=カナ\nunused.key=不要\n',
      'texts/en_US.lang': `${englishTranslation ? 'test.caption=Caption\n' : ''}unused.key=Unused\n`,
    }));
    await withImported(result, async (_pack, read) => {
      assert.deepEqual(JSON.parse(await read('texts/languages.json')), ['en_US', 'ja_JP']);
      assert.equal(await read('texts/ja_JP.lang'), 'test.caption=カナ\n');
      const english = await read('texts/en_US.lang');
      if (englishTranslation) assert.equal(english, 'test.caption=Caption\n');
      else assert.equal(parseLangFile(english).stats.entries, 0);
      const englishFile = result.plan.files.find(file => file.path === 'texts/en_US.lang');
      assert(englishFile.reasons.includes(englishTranslation ? 'reachable-localization-keys' : 'generated-empty-localization-metadata'));
      assert(!result.plan.files.find(file => file.path === 'texts/ja_JP.lang').reasons.includes('generated-empty-localization-metadata'));
    });
  }
});

test('字体だけのlocaleへ空langを補ってもlocalize:falseの同名翻訳を混入させない', async () => {
  const request = options({
    'ui/main.json': { namespace: 'n', root: { type: 'label', text: 'test.literal', localize: false, font_type: 'unicode' } },
    'texts/ja_JP.lang': 'test.literal=カナ\n',
    'texts/ja_JP/font/glyph_00.png': Buffer.from([1]), 'texts/ja_JP/font/glyph_30.png': Buffer.from([2]),
  });
  const result = await buildWorkspaceExport(request);
  await withImported(result, async (pack, read) => {
    assert.deepEqual(JSON.parse(await read('texts/languages.json')), ['en_US', 'ja_JP']);
    for (const locale of ['en_US', 'ja_JP']) {
      const path = `texts/${locale}.lang`;
      assert.equal(parseLangFile(await read(path)).stats.entries, 0);
      assert(result.plan.files.find(file => file.path === path).reasons.includes('generated-empty-localization-metadata'));
    }
    assert(pack.packPaths.includes('texts/ja_JP/font/glyph_00.png'));
    assert(!pack.packPaths.includes('texts/ja_JP/font/glyph_30.png'));
    assert(!request.sources[0].reads.includes('texts/ja_JP.lang'));
  });
});

test('固定modelファイルはtexture依存を同梱し別3D symbolは未解決を明記', async () => {
  const request = options({ 'ui/main.json': { namespace: 'n', root: { type: 'panel', model_file: 'models/example.geo.json' } },
    'models/example.geo.json': { 'minecraft:geometry': [{ description: { identifier: 'geometry.example' }, bones: [] }], texture: 'textures/entity/example' },
    'textures/entity/example.png': Buffer.from([1]) });
  const result = await buildWorkspaceExport(request);
  assert(result.ok, JSON.stringify(result.plan.unresolved));
  assert(result.plan.files.some(file => file.path === 'models/example.geo.json'));
  assert(result.plan.files.some(file => file.path === 'textures/entity/example.png'));
  request.sources[0].overrides = { 'models/example.geo.json': '{"geometry":"Geometry.default"}' };
  const unresolved = await buildWorkspaceExport(request);
  assert(!unresolved.ok); assert(unresolved.plan.unresolved.some(item => item.code === 'EXPORT_3D_SYMBOL_UNRESOLVED'));
});

test('固定native itemは継承元rendererとinstanceのidを対応付け、atlas全variationを同梱', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'panel', controls: [{ 'coin@n.item': { property_bag: { '#item_id_aux': 40894464 } } }] },
      item: { type: 'custom', renderer: 'inventory_item_renderer' }, unused: { type: 'panel' } },
    'textures/item_texture.json': { resource_pack_name: 'test', texture_name: 'atlas.items', texture_data: {
      netherite_ingot: { textures: ['textures/items/a', 'textures/items/b'] }, unused: { textures: 'textures/items/unused' } } },
    'textures/items/a.png': Buffer.from([1]), 'textures/items/b.png': Buffer.from([2]), 'textures/items/unused.png': Buffer.from([3]),
  }));
  await withImported(result, async (pack, read) => {
    assert.deepEqual(Object.keys(JSON.parse(await read('textures/item_texture.json')).texture_data), ['netherite_ingot']);
    assert(pack.packPaths.includes('textures/items/b.png')); assert(!pack.packPaths.includes('textures/items/unused.png'));
  });
  assert.equal(result.plan.nativeEvidence[0].atlasKey, 'netherite_ingot');
});

test('固定itemと無指定itemが混在しても無指定のruntime依存は解消したことにしない', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'panel', controls: [
      { fixed: { type: 'custom', renderer: 'inventory_item_renderer', property_bag: { '#item_id_aux': 40894464 } } },
      { dynamic: { type: 'custom', renderer: 'inventory_item_renderer' } },
    ] } }, 'textures/items/netherite_ingot.png': Buffer.from([1]),
  }));
  assert(!result.ok); assert(result.plan.unresolved.some(item => item.code === 'EXPORT_NATIVE_ITEM_UNRESOLVED'));
});

test('native itemの変数idは解決し、親パネルのidを子rendererへ漏らさない', async () => {
  const files = { 'ui/main.json': { namespace: 'n', root: { type: 'custom', renderer: 'inventory_item_renderer', '$item': 40894464,
    property_bag: { '#item_id_aux': '$item' } } }, 'textures/items/netherite_ingot.png': Buffer.from([1]) };
  const fixed = await buildWorkspaceExport(options(files));
  assert(fixed.ok, JSON.stringify(fixed.plan.unresolved));
  files['ui/main.json'].root = { type: 'panel', property_bag: { '#item_id_aux': 40894464 },
    controls: [{ child: { type: 'custom', renderer: 'inventory_item_renderer' } }] };
  const dynamic = await buildWorkspaceExport(options(files));
  assert(!dynamic.ok); assert(dynamic.plan.unresolved.some(item => item.code === 'EXPORT_NATIVE_ITEM_UNRESOLVED'));
});

test('本は実機内蔵形状を明記してtexture/shadow/新MERS/BOM sidecarを閉じる', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'custom', renderer: 'enchanting_book_renderer' } },
    'textures/entity/enchanting_table_book.png': Buffer.from([1]),
    'textures/entity/enchanting_table_book.texture_set.json': '\uFEFF{"minecraft:texture_set":{"color":"enchanting_table_book","metalness_emissive_roughness_subsurface":"enchanting_table_book_mers"}}',
    'textures/entity/enchanting_table_book_mers.tga': Buffer.from([2]),
    'textures/entity/enchanting_table_book_shadow.png': Buffer.from([3]),
  }));
  await withImported(result, async (pack) => {
    assert(pack.packPaths.includes('textures/entity/enchanting_table_book_mers.tga'));
    assert(pack.packPaths.includes('textures/entity/enchanting_table_book_shadow.png'));
  });
  assert(result.plan.warnings.some(item => item.code === 'EXPORT_NATIVE_BOOK_ENGINE_GEOMETRY'));
});

test('既知馬のcontroller/geometry/animation/全texture候補をpruneし他動物runtimeは未解決で保持', async () => {
  const result = await buildWorkspaceExport(options({
    'ui/main.json': { namespace: 'n', root: { type: 'custom', renderer: 'live_horse_renderer' } },
    'entity/custom.json': { format_version: '1.10.0', 'minecraft:client_entity': { description: {
      identifier: 'minecraft:horse', textures: { dark: 'textures/entity/horse_dark', light: 'textures/entity/horse_light' },
      geometry: { default: 'geometry.horse' }, materials: { default: 'entity_alphatest' },
      animations: { walk: 'animation.horse.walk' }, scripts: { animate: ['walk'] }, render_controllers: ['controller.render.horse'], spawn_egg: { texture: 'unused_egg' },
    } } },
    'models/all.geo.json': { format_version: '1.12.0', 'minecraft:geometry': [
      { description: { identifier: 'geometry.horse' }, bones: [] }, { description: { identifier: 'geometry.unused' }, bones: [] } ] },
    'render_controllers/all.json': { render_controllers: {
      'controller.render.horse': { geometry: 'Geometry.default', textures: ['query.variant ? Texture.light : Texture.dark'], materials: [{ '*': 'Material.default' }] },
      'controller.render.unused': { geometry: 'Geometry.unused' },
    } },
    'animations/all.json': { animations: { 'animation.horse.walk': { bones: {} }, 'animation.unused': { bones: {} } } },
    'textures/entity/horse_dark.png': Buffer.from([1]), 'textures/entity/horse_light.png': Buffer.from([2]), 'textures/entity/unused.png': Buffer.from([3]),
  }));
  assert(!result.ok); assert.deepEqual(result.plan.unresolved.map(item => item.code), ['EXPORT_NATIVE_ENTITY_SELECTION_DYNAMIC']);
  assert(result.plan.files.some(file => file.path === 'models/all.geo.json'));
  assert(result.plan.files.some(file => file.path === 'animations/all.json'));
  assert(result.plan.files.some(file => file.path === 'textures/entity/horse_light.png'));
  assert(!result.plan.files.some(file => file.path === 'textures/entity/unused.png'));
  const evidence = result.plan.nativeEvidence.find(item => item.renderer === 'live_horse_renderer');
  assert.deepEqual(evidence.dependencies.geometry.map(item => item.identifier), ['geometry.horse']);
  assert.deepEqual(evidence.dependencies.animations.map(item => item.identifier), ['animation.horse.walk']);
});
