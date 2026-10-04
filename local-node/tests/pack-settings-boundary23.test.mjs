/** ブラウザ設定→Node pack検査境界と、選択競合による停止を実データで検査する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolveObjectURL } from 'node:buffer';
import pngjs from '../vendor/pngjs/lib/png.js';
import { createPackExportSettings } from '../../editor-core/src/ui/pack-export-settings.js';
import { normalizePackOptions, normalizePackIcon, applyPackOptions } from '../pack-export-options.mjs';

const png = color => pngjs.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([...color, 255]) });
function pngFile(name = 'icon.png', color = [12, 34, 56]) { return new File([png(color)], name, { type: 'image/png' }); }
function deferredFile(name = 'slow.png') {
  const file = pngFile(name); let resolve, reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const original = file.arrayBuffer.bind(file); file.arrayBuffer = () => pending;
  return { file, resolve: async () => resolve(await original()), reject };
}
function h(tag, attrs, children = []) { return { tag, attrs, children: children.flat().filter(Boolean) }; }
function find(node, id) {
  if (node?.attrs?.id === id) return node;
  for (const child of node?.children || []) { const result = find(child, id); if (result) return result; }
  return null;
}

test('初期metadataと空白の任意項目は既存の説明・作者を維持しNode検査へ渡せる', () => {
  const settings = createPackExportSettings();
  const base = { format_version: 2, header: { name: 'JSON UI 選択エクスポート', description: '既定の説明', uuid: 'h', version: [1, 0, 0], min_engine_version: [1, 26, 40] }, modules: [{ type: 'resources', uuid: 'm', version: [1, 0, 0] }], metadata: { authors: ['元の作者'] } };
  assert.deepEqual(applyPackOptions(base, settings.options().packOptions), base);
  settings.state.description = ' \n '; settings.state.authors = ' ,、\n ';
  assert.equal('description' in settings.options().packOptions, false);
  assert.equal('authors' in settings.options().packOptions, false);
  assert.deepEqual(applyPackOptions(base, settings.options().packOptions), base);
});

test('明示metadataはNodeへそのまま渡し、空名/不正version/超過作者/制御文字は送信前に拒否', () => {
  const settings = createPackExportSettings();
  Object.assign(settings.state, { name: '新しいパック', description: '説明\n二行目', version: '2.3.4', authors: '作者A、作者B\n作者C' });
  assert.deepEqual(normalizePackOptions(settings.options().packOptions), { name: '新しいパック', description: '説明\n二行目', version: [2, 3, 4], authors: ['作者A', '作者B', '作者C'] });
  for (const [field, invalid] of [['name', ' '], ['name', 'a'.repeat(121)], ['name', 'a\u0000b'], ['version', '1.2'], ['version', '1.-1.0'], ['version', '65536.0.0'], ['authors', Array.from({ length: 17 }, (_, i) => `作者${i}`).join(',')], ['authors', 'a'.repeat(81)], ['description', 'a'.repeat(1025)], ['description', 'a\u0001b']]) {
    const before = settings.state[field]; settings.state[field] = invalid;
    assert.throws(() => settings.options(), { name: 'Error' }, field); settings.state[field] = before;
  }
});

test('読込A中に入口不正のBを選んでもloadingが残留せず、遅いAを採用しない', async () => {
  const settings = createPackExportSettings(), first = deferredFile();
  const pending = settings.selectIcon(first.file); assert.equal(settings.state.loading, true);
  await assert.rejects(settings.selectIcon(new File(['bad'], 'bad.txt')), /PNG/u);
  assert.equal(settings.state.loading, false); assert.doesNotThrow(() => settings.options());
  await first.resolve(); assert.equal(await pending, false);
  assert.equal(settings.state.iconUrl, ''); assert.equal(settings.state.iconPngBase64, undefined);
});

test('連続選択は最新成功だけを採用し、古い失敗とclear後の失敗を通知しない', async () => {
  const settings = createPackExportSettings(), first = deferredFile('first.png');
  const old = settings.selectIcon(first.file); await settings.selectIcon(pngFile('latest.png'));
  const url = settings.state.iconUrl;
  first.reject(new Error('古い読込失敗')); assert.equal(await old, false);
  assert.equal(settings.state.iconName, 'latest.png'); assert.equal(settings.state.iconError, '');
  assert.ok(resolveObjectURL(url));
  const late = deferredFile('cleared.png'), clearing = settings.selectIcon(late.file); settings.clearIcon();
  late.reject(new Error('クリア後の失敗')); assert.equal(await clearing, false);
  assert.equal(settings.state.iconError, ''); assert.equal(settings.state.loading, false);
  assert.equal(resolveObjectURL(url), undefined);
});

test('選択の取消は読込を失効させず、失敗した置換は最後の有効iconを維持する', async () => {
  const settings = createPackExportSettings(), slow = deferredFile();
  const pending = settings.selectIcon(slow.file); assert.equal(await settings.selectIcon(null), false);
  assert.equal(settings.state.loading, true); await slow.resolve(); assert.equal(await pending, true);
  const previous = settings.state.iconUrl, base64 = settings.state.iconPngBase64;
  await assert.rejects(settings.selectIcon(new File([new Uint8Array(40)], 'broken.png')), /PNG/u);
  assert.equal(settings.state.iconUrl, previous); assert.equal(settings.state.iconPngBase64, base64);
  assert.match(settings.state.iconError, /前のアイコン設定/u); assert.ok(resolveObjectURL(previous));
  settings.clearIcon(); assert.equal(resolveObjectURL(previous), undefined); assert.equal(settings.state.iconError, '');
});

test('過大なPNGはブラウザimg用URL発行前に拒否し、CRCはNodeの権威境界で拒否する', async () => {
  const settings = createPackExportSettings(); const oversized = png([1, 2, 3]); oversized.writeUInt32BE(100000, 16);
  await assert.rejects(settings.selectIcon(new File([oversized], 'huge.png')), /2048/u);
  assert.equal(settings.state.iconUrl, '');
  const broken = png([1, 2, 3]); broken[29] ^= 1;
  await settings.selectIcon(new File([broken], 'crc.png'));
  assert.throws(() => normalizePackIcon(settings.options().iconPngBase64), error => error.code === 'EXPORT_ICON_PNG_INVALID');
  settings.clearIcon();
});

test('実UIイベントは読込開始を通知し、読込中exportを拒否し、完了後に同一ファイル再選択を許す', async () => {
  const settings = createPackExportSettings(), slow = deferredFile(), notifications = [], errors = [];
  const dom = settings.render(h, { onChange: changed => notifications.push([changed, settings.state.loading]), onError: error => errors.push(error) });
  const input = { files: [slow.file], value: 'C:\\fakepath\\slow.png' };
  const change = find(dom, 'pack-export-icon-file').attrs.onChange({ currentTarget: input });
  assert.deepEqual(notifications, [[false, true]]); assert.throws(() => settings.options(), /読み込み中/u);
  await slow.resolve(); await change;
  assert.deepEqual(notifications, [[false, true], [true, false]]); assert.equal(input.value, ''); assert.deepEqual(errors, []);
  const normalized = normalizePackIcon(settings.options().iconPngBase64); assert.equal(normalized.width, 256);
  settings.clearIcon();
});

test('UIの選択失敗は必ず再描画通知と入力リセットを行い、loadingを解除する', async () => {
  const settings = createPackExportSettings(), notifications = [], errors = [];
  const dom = settings.render(h, { onChange: changed => notifications.push(changed), onError: error => errors.push(error) });
  const input = { files: [new File(['bad'], 'bad.txt')], value: 'invalid' };
  await find(dom, 'pack-export-icon-file').attrs.onChange({ currentTarget: input });
  assert.deepEqual(notifications, [false, true]); assert.equal(errors.length, 1); assert.equal(input.value, ''); assert.equal(settings.state.loading, false);
});

const main = await readFile(new URL('../../editor-core/src/main.js', import.meta.url), 'utf8');
function exportHarness(settings, wait) {
  const calls = [], selection = { filePath: 'ui/test.json', rawKey: 'screen' };
  const sandbox = vm.createContext({ packExportSettings: settings, store: { getState: () => ({ files: { currentFileId: 'f', byId: { f: { meta: { selectedDefinition: { recordId: 'r' } } } } } }) },
    uiCatalogState: { catalog: { recordsById: { r: selection } } }, siteText: value => value,
    ensureSourceWorkspace: async () => { calls.push(['ensure']); await wait; }, workspaceSources: () => [], workspaceRecordSourceId: () => 'pack',
    sourceWorkspace: { state: { selections: [selection] }, export: async (mode, options) => { calls.push(['export', mode, options]); return new Blob(['pack']); } },
    downloadBlobFile: () => calls.push(['download']), makeSafeFileTimestamp: () => 'test', setStatus: () => {},
  });
  const start = main.indexOf('async function exportCurrentSourceWorkspacePack()'), end = main.indexOf('\nfunction renderSourceWorkspaceToolbar(', start);
  vm.runInContext(main.slice(start, end), sandbox); return { calls, run: () => sandbox.exportCurrentSourceWorkspacePack() };
}

test('実main exportは読込中にworkspaceへ触れず、非同期初期化中のmetadata変更を混入させない', async () => {
  const settings = createPackExportSettings(), slow = deferredFile(), pending = settings.selectIcon(slow.file);
  const blocked = exportHarness(settings); await assert.rejects(blocked.run(), /読み込み中/u); assert.deepEqual(blocked.calls, []);
  await slow.resolve(); await pending;
  let resume; const wait = new Promise(resolve => resume = resolve), current = exportHarness(settings, wait);
  settings.state.name = '書出し開始時'; const exporting = current.run(); settings.state.name = 'その後の変更'; resume(); await exporting;
  assert.equal(current.calls.find(call => call[0] === 'export')[2].packOptions.name, '書出し開始時');
  assert.equal(current.calls.at(-1)[0], 'download'); settings.clearIcon();
});

test('実main書出しtoolbarはicon読込に合わせて検査/保存を無効化し、完了後に復元する', async () => {
  const settings = createPackExportSettings(), slow = deferredFile(), errors = [];
  const ws = { mode: 'preview', busy: false, workspaceId: 'w', selections: [{ filePath: 'ui/test.json' }], exportPlan: { previous: true } };
  const state = { files: { currentFileId: 'f', byId: { f: { meta: { previewProjection: true } } } } };
  let root;
  const all = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(all)] : [];
  const actions = () => all(root).filter(node => node.attrs?.['data-pack-export-action']);
  const sandbox = vm.createContext({
    h: (tag, attrs, children) => ({ ...h(tag, attrs, children), disabled: attrs.disabled }),
    sourceWorkspace: { state: ws }, packExportSettings: settings, siteText: value => value,
    importedPackRuntime: {}, vanillaReferenceRuntime: null, workspaceExportDetailsOpen: true,
    workspaceSources: () => [], renderWorkspaceExportReport: () => '', reportWorkspaceError: error => errors.push(error),
    document: { querySelectorAll: () => actions() }, safeRender: () => { root = sandbox.renderSourceWorkspaceToolbar(state); },
  });
  const start = main.indexOf('function renderSourceWorkspaceToolbar('), end = main.indexOf('\nfunction renderSourceWorkspaceInspector(', start);
  vm.runInContext(main.slice(start, end), sandbox); sandbox.safeRender();
  assert.equal(actions().length, 2); assert.ok(actions().every(button => button.disabled === false));
  const input = { files: [slow.file], value: 'pending' };
  const pending = find(root, 'pack-export-icon-file').attrs.onChange({ currentTarget: input });
  assert.ok(actions().every(button => button.disabled === true)); assert.equal(ws.exportPlan, null);
  await slow.resolve(); await pending;
  assert.ok(actions().every(button => button.disabled === false)); assert.deepEqual(errors, []);
  settings.clearIcon(); ws.selections = []; sandbox.safeRender(); assert.ok(actions().every(button => button.disabled === true));
});
