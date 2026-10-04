import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { downloadBlobSafely23 } from '../src/ui/blob-download.js';
import { createSiteDiagnosticSession } from '../src/diagnostics/site-diagnostic-session.js';

function fixture(failure = '') {
  const effects = [], timers = [], anchors = [];
  const inject = stage => { if (failure === stage) throw new Error('FAILED_' + stage); };
  const environment = { Blob,
    URL: { createObjectURL(blob) { inject('url'); effects.push(['url', blob]); return 'blob:test'; }, revokeObjectURL(url) { effects.push(['revoke', url]); } },
    document: { createElement(tag) {
      inject('element'); const anchor = { tag, style: {}, click() { inject('click'); effects.push(['click']); }, remove() { effects.push(['remove']); anchors.splice(anchors.indexOf(anchor), 1); } }; return anchor;
    }, body: { appendChild(anchor) { inject('append'); effects.push(['append']); anchors.push(anchor); } } },
    setTimeout(callback, ms) { inject('timer'); effects.push(['schedule', ms]); timers.push(callback); },
  };
  return { environment, effects, timers, anchors };
}

test('保存成功時はanchorを外し、URLは5秒の予約後に解放する', () => {
  const f = fixture(); downloadBlobSafely23({ filename: '日本語.json', blob: new Blob(['{}']) }, f.environment);
  assert.equal(f.anchors.length, 0); assert.equal(f.effects.filter(row => row[0] === 'revoke').length, 0);
  assert.deepEqual(f.effects.find(row => row[0] === 'schedule'), ['schedule', 5000]);
  f.timers[0](); assert.equal(f.effects.filter(row => row[0] === 'revoke').length, 1);
});

test('URL作成後のelement/append/click/timer失敗はanchorとURLを即時回収し元の例外を返す', () => {
  for (const failure of ['element', 'append', 'click', 'timer']) {
    const f = fixture(failure);
    assert.throws(() => downloadBlobSafely23({ filename: 'test.json', blob: new Blob(['{}']) }, f.environment), new RegExp('FAILED_' + failure));
    assert.equal(f.anchors.length, 0, failure); assert.equal(f.effects.filter(row => row[0] === 'revoke').length, 1, failure);
    assert.equal(f.timers.length, 0, failure);
  }
});

test('URL作成自体の失敗は未取得URLを解放しない', () => {
  const f = fixture('url'); assert.throws(() => downloadBlobSafely23({ filename: 'test', blob: new Blob() }, f.environment), /FAILED_url/u);
  assert.equal(f.effects.length, 0); assert.equal(f.anchors.length, 0);
});

test('実診断sessionは失敗コードを維持しappend/click/timer後のURLを残さない', async () => {
  for (const failure of ['append', 'click', 'timer']) {
    const f = fixture(failure), session = createSiteDiagnosticSession({ globalObject: f.environment, idFactory: () => 'cleanup-test' });
    session.start(); session.stop(); const result = await session.download();
    assert.equal(result.ok, false); assert.equal(result.code, 'SITE_DIAG_DOWNLOAD_FAILED');
    assert.equal(f.anchors.length, 0); assert.equal(f.effects.filter(row => row[0] === 'revoke').length, 1);
    session.dispose();
  }
});

test('実診断sessionの成功は遅延解放を保持し、明示downloadTextの失敗も従来コードで返す', async () => {
  const f = fixture(), session = createSiteDiagnosticSession({ globalObject: f.environment, idFactory: () => 'success-test' });
  session.start(); session.stop(); assert.equal((await session.download()).code, 'SITE_DIAG_DOWNLOADED');
  assert.equal(f.effects.some(row => row[0] === 'revoke'), false); f.timers[0](); assert.equal(f.anchors.length, 0); session.dispose();
  const custom = createSiteDiagnosticSession({ downloadText: () => Promise.reject(new Error('CUSTOM_FAILURE')) });
  custom.start(); custom.stop(); assert.equal((await custom.download()).code, 'SITE_DIAG_DOWNLOAD_FAILED'); custom.dispose();
});

test('実mainのテキスト/Blob保存も共通回収へ接続し、内容・MIME・filenameを維持する', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function downloadTextFile('), end = source.indexOf('\nfunction exportDiagnosticsLog()', start);
  assert(start >= 0 && end > start); const calls = [], f = fixture();
  const context = vm.createContext({ Blob, downloadBlobSafely23: options => { calls.push(options); return downloadBlobSafely23(options, f.environment); } });
  vm.runInContext(source.slice(start, end), context);
  context.downloadTextFile({ filename: 'sample.json', text: '日本語', mime: 'text/plain' });
  assert.equal(calls[0].filename, 'sample.json'); assert.equal(calls[0].blob.type, 'text/plain'); assert.equal(await calls[0].blob.text(), '日本語');
  const blob = new Blob(['MCPACK']); context.downloadBlobFile({ filename: 'test.mcpack', blob });
  assert.equal(calls[1].blob, blob); assert.equal(calls[1].filename, 'test.mcpack');
  assert.equal(f.anchors.length, 0); assert.equal(f.timers.length, 2); f.timers.forEach(callback => callback());
});
