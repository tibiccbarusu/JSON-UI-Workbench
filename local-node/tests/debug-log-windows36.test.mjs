import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readServerLogs, readLauncherLog, readBootstrapLog } from '../debug-bundle.mjs';

const highVolumeBits = 0x9abc123400000000n;
const low32 = value => BigInt.asUintN(32, value);
const clone = (info, values) => Object.assign(Object.create(Object.getPrototypeOf(info)), info, values);

async function logs(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'jui-log-win36-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const file of ['launcher.log', 'bootstrap.log', 'server.log', 'server.log.1']) {
    await fs.writeFile(path.join(root, file), JSON.stringify({ event: 'WINDOWS_LOG', token: 'SECRET_TEST_VALUE' }) + '\n');
  }
  return root;
}

// Windows を起動したと見なす試験ではなく、公式 libuv で確認した
// path stat=64bit / handle stat=32bit の返値差を実ファイル I/O に挿入する。
async function withStatFixture({ platform = 'win32', mapPath, mapHandle }, callback) {
  const platformProperty = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalLstat = fs.lstat, originalOpen = fs.open, pathCalls = new Map();
  Object.defineProperty(process, 'platform', { ...platformProperty, value: platform });
  fs.lstat = async (file, options) => {
    const info = await originalLstat(file, options), call = (pathCalls.get(file) || 0) + 1;
    pathCalls.set(file, call);
    return mapPath ? mapPath(info, call) : clone(info, { dev: highVolumeBits | low32(info.dev) });
  };
  fs.open = async (...args) => {
    const handle = await originalOpen(...args); let calls = 0;
    return {
      stat: async options => {
        const info = await handle.stat(options);
        return mapHandle ? mapHandle(info, ++calls) : clone(info, { dev: low32(info.dev) });
      },
      read: (...values) => handle.read(...values),
      close: () => handle.close(),
    };
  };
  syncBuiltinESMExports();
  try { return await callback(); }
  finally {
    fs.lstat = originalLstat; fs.open = originalOpen;
    Object.defineProperty(process, 'platform', platformProperty);
    syncBuiltinESMExports();
  }
}

test('Windows の 64bit path dev / 32bit FD dev で四種類の正規ログを伏字付き収録できる', async t => {
  const root = await logs(t);
  await withStatFixture({}, async () => {
    const server = await readServerLogs(root);
    for (const result of [await readLauncherLog(root), await readBootstrapLog(root), server.current, server.previous]) {
      assert.equal(result.status, 'available');
      assert.equal(result.data[0].event, 'WINDOWS_LOG');
      assert.equal(result.data[0].token, '[REDACTED]');
      assert.doesNotMatch(JSON.stringify(result), /SECRET_TEST_VALUE/u);
    }
  });
});

test('Windows 以外の device 上位bit不一致は許可しない', async t => {
  const root = await logs(t);
  await withStatFixture({ platform: 'linux' }, async () => {
    assert.equal((await readLauncherLog(root)).reason, 'LOG_PATH_CHANGED');
  });
});

test('Windows でも低32bit device または inode の不一致は許可しない', async t => {
  const root = await logs(t);
  for (const field of ['dev', 'ino']) {
    await withStatFixture({ mapPath: info => clone(info, {
      dev: highVolumeBits | low32(info.dev), [field]: info[field] + 1n,
    }) }, async () => {
      const result = await readLauncherLog(root);
      assert.equal(result.reason, 'LOG_PATH_CHANGED', field);
      assert.equal(result.data, undefined);
    });
  }
});

test('64bit 値どうしの device 不一致を Windows の幅互換として扱わない', async t => {
  const root = await logs(t);
  await withStatFixture({ mapHandle: info => clone(info, { dev: 0x1234567800000000n | low32(info.dev) }) }, async () => {
    assert.equal((await readLauncherLog(root)).reason, 'LOG_PATH_CHANGED');
  });
});

test('読取途中の path device 上位bitだけの変更も完全比較で拒否する', async t => {
  const root = await logs(t);
  await withStatFixture({ mapPath: (info, call) => clone(info, {
    dev: (highVolumeBits + (call > 1 ? 0x100000000n : 0n)) | low32(info.dev),
  }) }, async () => {
    const result = await readLauncherLog(root);
    assert.equal(result.reason, 'LOG_PATH_CHANGED');
    assert.equal(result.data, undefined);
  });
});

test('読取途中の FD identity 変更を拒否し、読み込んだ本文を返さない', async t => {
  const root = await logs(t);
  await withStatFixture({ mapHandle: (info, call) => clone(info, {
    dev: low32(info.dev), ino: info.ino + (call > 1 ? 1n : 0n),
  }) }, async () => {
    const result = await readLauncherLog(root);
    assert.equal(result.reason, 'LOG_PATH_CHANGED');
    assert.equal(result.data, undefined);
  });
});
