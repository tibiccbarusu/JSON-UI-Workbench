import { inspectPackage } from './preflight28.cjs';
import net from 'node:net';
import { consoleText, normalizeLanguage, localizeConsoleResult } from './console-i18n.mjs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, realpath, rename, stat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalServer } from './server.mjs';
import { sanitizeDiagnostic } from './debug-bundle.mjs';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const messageLimit = 4096;
const readinessLimit = 64 * 1024;

function error(code, message) { return Object.assign(new Error(message), { code }); }

/** Keep a startup filesystem failure actionable before the log exists. */
export async function prepareLauncherState(stateDir) {
  try { await mkdir(stateDir, { recursive: true, mode: 0o700 }); }
  catch (cause) {
    throw Object.assign(error('LAUNCH_STATE_UNAVAILABLE',
      '起動記録フォルダー .jsonui を用意できません。ZIP一式を短い書き込み可能なフォルダーへ展開し直し、start.bat を実行してください。'), { cause });
  }
}

/** Diagnostic output has one stable severity and never includes the API token. */
export function launcherLogRecord(code, detail = {}, language = normalizeLanguage(process.env.JSONUI_LANGUAGE)) {
  const safe = sanitizeDiagnostic(detail).data;
  const context = Object.fromEntries(Object.entries(safe).map(([key, value]) =>
    [key.replace(/[A-Z]/gu, character => '_' + character.toLowerCase()), value]));
  const severity = /(?:FAILED|INVALID|CONFLICT|LONG|REQUIRED|TIMEOUT|BUSY|UNAVAILABLE|NOT_READY|INCOMPLETE)$/u.test(code)
    ? 'ERROR' : /MANUAL|FALLBACK/u.test(code) ? 'WARN' : 'INFO';
  const localizedContext = localizeConsoleResult({ ...context, code: context.reason_code || code }, language, true);
  delete localizedContext.code;
  return { timestamp: new Date().toISOString(), severity, event: code,
    message: code, logger: 'jsonui.launcher',
    ...(context.launch_run_id ? { run_id: context.launch_run_id, correlation_id: context.launch_run_id } : {}),
    ...(context.stage ? { stage_ref: context.stage } : {}),
    ...(Number.isFinite(context.duration_ms) ? { duration_ms: context.duration_ms } : {}),
    outcome: severity === 'ERROR' ? /TIMEOUT/u.test(code + ' ' + (context.reason_code || '')) ? 'timeout' : 'failure'
      : severity === 'WARN' ? 'partial' : 'success', context: localizedContext };
}

/** Validate a user-specified port; 0 explicitly requests an OS-assigned port. */
export function parsePort(value = '3210') {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})$/u.test(value)) {
    throw error('LAUNCH_PORT_INVALID', 'JSONUI_PORT は 0〜65535 の整数で指定してください。');
  }
  const port = Number(value);
  if (port > 65535) throw error('LAUNCH_PORT_INVALID', 'JSONUI_PORT は 0〜65535 の整数で指定してください。');
  return port;
}

function validURL(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/$/u);
  return Boolean(match && Number(match[1]) <= 65535);
}

function validateWait(value) {
  if (!Number.isInteger(value) || value < 1 || value > 120000) {
    throw error('LAUNCH_WAIT_INVALID', '起動の待機時間は 1〜120000 ミリ秒の整数で指定してください。');
  }
}

/** Readiness is a bounded live check, including when reusing an IPC owner. */
async function assertSiteReady(url, waitMs) {
  if (!validURL(url)) throw error('LAUNCH_URL_INVALID', '起動先 URL が不正です。');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), waitMs);
  let reader;
  try {
    const response = await fetch(new URL('api/node/capabilities', url), {
      signal: controller.signal, redirect: 'error',
    });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > readinessLimit) {
      throw error('LAUNCH_NOT_READY', 'ローカルサイトの準備完了応答を確認できません。');
    }
    reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > readinessLimit) throw error('LAUNCH_NOT_READY', 'ローカルサイトの準備完了応答が上限を超えました。');
      chunks.push(Buffer.from(value));
    }
    const capability = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    if (capability?.protocol !== 'jsonui-node/v1') {
      throw error('LAUNCH_NOT_READY', 'ローカルサイトの準備完了を確認できません。');
    }
    // The capability token and response body are neither retained nor logged.
  } catch (cause) {
    if (controller.signal.aborted) throw error('LAUNCH_HEALTH_TIMEOUT', 'ローカルサイトの準備完了応答が制限時間内に完了しませんでした。');
    if (cause.code === 'LAUNCH_NOT_READY') throw cause;
    throw Object.assign(error('LAUNCH_NOT_READY', 'ローカルサイトの準備完了を確認できません。'), { cause });
  } finally {
    clearTimeout(timeout);
    controller.abort();
    reader?.releaseLock();
  }
}

/** Shell-free browser launch. Its only argument is a validated loopback URL. */
export async function openLocalBrowser(url) {
  if (!validURL(url)) throw error('LAUNCH_URL_INVALID', '起動先 URL が不正です。');
  let executable;
  let args;
  if (process.platform === 'win32') {
    if (!process.env.SystemRoot || !path.win32.isAbsolute(process.env.SystemRoot)) {
      throw error('LAUNCH_SYSTEM_ROOT', 'Windows の SystemRoot を確認できません。');
    }
    executable = path.join(process.env.SystemRoot, 'System32', 'rundll32.exe');
    args = [path.join(process.env.SystemRoot, 'System32', 'url.dll') + ',FileProtocolHandler', url];
  } else if (process.platform === 'darwin') {
    executable = '/usr/bin/open'; args = [url];
  } else {
    executable = 'xdg-open'; args = [url];
  }
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill(); reject(error('LAUNCH_BROWSER_TIMEOUT', 'ブラウザ起動が時間内に完了しませんでした。'));
    }, 10000);
    child.once('error', cause => { clearTimeout(timer); reject(cause); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(error('LAUNCH_BROWSER_FAILED', '既定のブラウザを開けませんでした。'));
    });
  });
}

async function probeInstance(pipePath, waitMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipePath);
    let message = '';
    const timer = setTimeout(() => socket.destroy(error('LAUNCH_PROBE_TIMEOUT', '起動中のインスタンスの応答待ちが終了しました。')), waitMs);
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      message += chunk;
      if (message.length > messageLimit) socket.destroy(error('LAUNCH_PROBE_SIZE', 'インスタンスの応答が大きすぎます。'));
    });
    socket.once('error', cause => { clearTimeout(timer); reject(cause); });
    socket.once('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(message)); } catch { reject(error('LAUNCH_PROBE_INVALID', 'インスタンスの応答を確認できません。')); }
    });
  });
}

async function closeIPC(server) {
  if (!server.listening) return;
  await new Promise(resolve => server.close(resolve));
}

/** A stalled cleanup must not turn a bounded startup failure into an endless wait. */
async function closeWithDeadline(operation, waitMs) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(error('LAUNCH_CLOSE_TIMEOUT',
          'ローカルサイトの終了処理が制限時間内に完了しませんでした。起動ウィンドウを終了してから再実行してください。')), waitMs);
      }),
    ]);
  } finally { clearTimeout(timeout); }
}

/**
 * Acquire a project/user-specific OS IPC endpoint before starting the HTTP app.
 * A Windows named pipe is released by the OS even after an interrupted process.
 * No unrelated process is stopped and no occupied HTTP port is taken over.
 */
export async function launchLocal({
  projectRoot = projectDirectory,
  stateDirectory,
  preferredPort = 3210,
  openBrowser = true,
  browser = openLocalBrowser,
  startupWaitMs = 15000,
  readinessWaitMs = 5000,
  shutdownWaitMs = 10000,
  progressIntervalMs = 5000,
  createServer = createLocalServer,
  log = () => {},
} = {}) {
  validateWait(startupWaitMs);
  validateWait(readinessWaitMs);
  validateWait(shutdownWaitMs);
  validateWait(progressIntervalMs);
  if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65535) {
    throw error('LAUNCH_PORT_INVALID', '起動ポートは 0〜65535 の整数で指定してください。');
  }
  const canonicalRoot = await realpath(projectRoot);
  const identity = createHash('sha256').update((process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot)
    + '\0' + userInfo().username).digest('hex').slice(0, 24);
  const stateDir = stateDirectory || path.join(canonicalRoot, '.jsonui');
  if (process.platform === 'win32' && path.join(stateDir, 'launcher.log.1').length + 1 > 240) {
    throw error('LAUNCH_PATH_LONG', '展開先が長すぎます。短いフォルダーへ一式を展開してください。');
  }
  await prepareLauncherState(stateDir);
  // This reports the current operation and its remaining allowance, never a
  // guessed percentage. A timer belongs only to its stage and is always cleared.
  const progressLanguage = normalizeLanguage(process.env.JSONUI_LANGUAGE) === 'en' ? 1 : 0;
  const stageMessages = {
    waiting_instance: ['先に開始したローカルサイトの準備を確認しています。', 'Waiting for the existing local site to become ready.'],
    initializing_server: ['ローカルサイトを初期化しています。', 'Initializing the local site.'],
    checking_site: ['ローカルサイトの応答を確認しています。', 'Checking the local site response.'],
    opening_browser: ['既定のブラウザを開いています。', 'Opening the default browser.'],
    stopping: ['ローカルサイトを終了しています。', 'Stopping the local site.'],
  };
  const withProgress = async (stage, waitMs, operation) => {
    const started = performance.now();
    const report = () => {
      const elapsedMs = Math.max(0, Math.floor(performance.now() - started));
      // Optional observation must not strand a live server or crash a timer.
      try { log('LAUNCH_PROGRESS', { stage, message: stageMessages[stage][progressLanguage], elapsedMs,
        remainingMs: Math.max(0, waitMs - elapsedMs), waitMs }); } catch {}
    };
    report();
    const heartbeat = setInterval(report, progressIntervalMs);
    heartbeat.unref();
    try {
      const result = await operation();
      try { log('LAUNCH_STAGE_COMPLETED', { stage, durationMs: Math.max(0, Math.floor(performance.now() - started)), waitMs }); } catch {}
      return result;
    } catch (cause) {
      try { log('LAUNCH_STAGE_FAILED', { stage, durationMs: Math.max(0, Math.floor(performance.now() - started)), waitMs,
        reasonCode: typeof cause?.code === 'string' ? cause.code : 'LAUNCH_STAGE_ERROR' }); } catch {}
      throw cause;
    } finally { clearInterval(heartbeat); }
  };
  // Windows uses an OS-owned named pipe. The optional POSIX launcher uses a
  // loopback-only coordination port; identity mismatches fail closed.
  const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\jsonui-${identity}`
    : { host: '127.0.0.1', port: 32768 + (parseInt(identity.slice(0, 8), 16) % 28232) };
  let status = { protocol: 'jsonui-launcher/v1', identity, state: 'starting' };
  const ipcSockets = new Set();
  const ipc = net.createServer(socket => {
    ipcSockets.add(socket);
    socket.once('close', () => ipcSockets.delete(socket));
    socket.setTimeout(2000, () => socket.destroy());
    socket.end(JSON.stringify(status));
  });
  ipc.maxConnections = 8;
  const occupied = await new Promise((resolve, reject) => {
    const onError = cause => cause.code === 'EADDRINUSE' ? resolve(true) : reject(cause);
    ipc.once('error', onError);
    ipc.listen(pipePath, () => { ipc.off('error', onError); resolve(false); });
  });
  const showBrowser = async url => {
    if (!openBrowser) return;
    try { await withProgress('opening_browser', 10000, () => browser(url)); }
    catch (cause) { log('LAUNCH_BROWSER_MANUAL', { message: cause.message, url }); }
  };
  if (occupied) {
    const deadline = performance.now() + startupWaitMs;
    const remaining = () => Math.max(0, Math.ceil(deadline - performance.now()));
    const pause = async () => { const waitMs = remaining(); if (waitMs > 0) await delay(Math.min(150, waitMs)); };
    const result = await withProgress('waiting_instance', startupWaitMs, async () => {
      while (remaining() > 0) {
        let response;
        try { response = await probeInstance(pipePath, Math.min(1000, Math.max(1, remaining()))); }
        catch { await pause(); continue; }
        if (response?.protocol !== 'jsonui-launcher/v1' || response.identity !== identity) {
          throw error('LAUNCH_INSTANCE_CONFLICT', '同名の起動管理口に別のプログラムが応答しました。');
        }
        if (response.state === 'ready' && validURL(response.url)) return response;
        await pause();
      }
      throw error('LAUNCH_INSTANCE_BUSY', '別の起動処理が応答しません。既存の JSON UI 起動ウィンドウを確認してください。');
    });
    const healthWaitMs = Math.min(readinessWaitMs, Math.max(1, remaining()));
    try { await withProgress('checking_site', healthWaitMs, () => assertSiteReady(result.url, healthWaitMs)); }
    catch (cause) {
      throw Object.assign(error('LAUNCH_INSTANCE_UNAVAILABLE',
        '既存の起動管理口は応答しましたが、サイトを確認できません。先に開いた JSON UI の起動ウィンドウを確認し、終了してから同じ BAT で再実行してください。'), { cause });
    }
    await showBrowser(result.url);
    log('LAUNCH_REUSED', { url: result.url });
    return { reused: true, url: result.url, close: async () => {} };
  }
  let app;
  let closing;
  const startServer = options => withProgress('initializing_server', startupWaitMs, () => new Promise((resolve, reject) => {
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      reject(error('LAUNCH_START_TIMEOUT', 'サイトの初期化が制限時間内に完了しませんでした。同じ BAT で再試行できます。'));
    }, startupWaitMs);
    Promise.resolve().then(() => createServer(options)).then(created => {
      clearTimeout(timeout);
      // A late server must not survive after its launcher already reported
      // timeout and released ownership. Close only the server created here.
      if (expired) { void closeWithDeadline(() => created.close(), shutdownWaitMs).catch(cause =>
        log('LAUNCH_LATE_CLOSE_FAILED', { message: cause.message, reasonCode: cause.code })); return; }
      resolve(created);
    }, cause => { clearTimeout(timeout); if (!expired) reject(cause); });
  }));
  async function close() {
    if (closing) return closing;
    closing = withProgress('stopping', shutdownWaitMs, async () => {
      status = { ...status, state: 'stopping' };
      for (const socket of ipcSockets) socket.destroy();
      const results = await Promise.allSettled([
        closeWithDeadline(() => closeIPC(ipc), shutdownWaitMs),
        closeWithDeadline(() => app?.close(), shutdownWaitMs),
      ]);
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw Object.assign(new AggregateError(failures,
        'ローカルサイトと起動管理口の終了処理を完了できませんでした。'), { code: 'LAUNCH_CLOSE_FAILED' });
    });
    return closing;
  }
  try {
    try { app = await startServer({ host: '127.0.0.1', port: preferredPort, logDirectory:stateDir }); }
    catch (cause) {
      if (cause.code !== 'EADDRINUSE' || preferredPort === 0) throw cause;
      log('LAUNCH_PORT_FALLBACK', { requestedPort: preferredPort });
      app = await startServer({ host: '127.0.0.1', port: 0, logDirectory:stateDir });
    }
    const url = `http://127.0.0.1:${app.port}/`;
    await withProgress('checking_site', readinessWaitMs, () => assertSiteReady(url, readinessWaitMs));
    status = { ...status, state: 'ready', url };
    log('LAUNCH_READY', { url, node: process.versions.node });
    await showBrowser(url);
    return { app, url, reused: false, close };
  } catch (cause) {
    await close().catch(cleanupCause => log('LAUNCH_CLEANUP_FAILED', {
      message: cleanupCause.message, reasonCode: cleanupCause.code,
    }));
    throw cause;
  }
}

async function main() {
  if (process.env.JSONUI_LANGUAGE && !['ja', 'en'].includes(process.env.JSONUI_LANGUAGE)) {
    throw error('LAUNCH_LANGUAGE_INVALID', '起動言語は JSONUI_LANGUAGE=ja または en を指定してください。');
  }
  const stateDir = path.join(projectDirectory, '.jsonui');
  if (process.platform === 'win32' && path.join(stateDir, 'launcher.log.1').length + 1 > 240) {
    console.error('LAUNCH_PATH_LONG: ' + consoleText('展開先が長すぎます。短いフォルダーへ一式を展開してください。', normalizeLanguage(process.env.JSONUI_LANGUAGE)));
    process.exitCode = 1;
    return;
  }
  await prepareLauncherState(stateDir);
  const logPath = path.join(stateDir, 'launcher.log');
  if (await stat(logPath).then(info => info.size > 1024 * 1024).catch(() => false)) {
    await rename(logPath, logPath + '.1').catch(() => {});
  }
  let logQueue = Promise.resolve();
  let logUnavailableReported = false;
  const launchRunId = randomUUID();
  const launchStarted = performance.now();
  let logSequence = 0;
  const log = (code, detail) => {
    const record = launcherLogRecord(code, { ...detail, launchRunId, sequence: ++logSequence,
      elapsedMs: Math.max(0, Math.floor(performance.now() - launchStarted)), processId: process.pid });
    const line = JSON.stringify(record);
    if (record.severity === 'INFO') console.log(line); else console.error(line);
    logQueue = logQueue.then(() => appendFile(logPath, line + '\n', { mode: 0o600 })).catch(() => {
      if (logUnavailableReported) return;
      logUnavailableReported = true;
      console.error(JSON.stringify(launcherLogRecord('LAUNCH_LOG_UNAVAILABLE', {
        message: '起動ログに書き込めません。起動ウィンドウの表示を保存してください。サイトが開いている場合はそのまま使用できます。',
      })));
    });
  };
  let instance;
  try {
    if (process.env.JSONUI_HOST && process.env.JSONUI_HOST !== '127.0.0.1') {
      throw error('LAUNCH_LOOPBACK_REQUIRED', 'start.bat の公開先は 127.0.0.1 のみです。');
    }
    const preferredPort = parsePort(process.env.JSONUI_PORT);
    log('LAUNCH_RUNTIME', { nodeVersion: process.version, platform: process.platform,
      architecture: process.arch, browserRequested: process.env.JSONUI_NO_BROWSER !== '1',
      runtimeSource: ['path','private-cache','download','concurrent-cache','powershell'].includes(process.env.JSONUI_BOOT_SOURCE)
        ? process.env.JSONUI_BOOT_SOURCE : 'direct',
      dependencySetup: 'bundled-no-npm' });
    const preflight = inspectPackage();
    log('LAUNCH_PACKAGE_CHECKED', { requiredCount: preflight.required_count, failureCount: preflight.failure_count, failures: preflight.failures });
    if (!preflight.ok) throw error('LAUNCH_PACKAGE_INCOMPLETE', '配布ファイルが欠落しています。ZIP一式を新しい空のフォルダーへ展開し直してください。');
    instance = await launchLocal({ preferredPort,
      openBrowser: process.env.JSONUI_NO_BROWSER !== '1', stateDirectory: stateDir, log });
    // Only a successful explicit GUI launch emits human-facing guidance.
    // Importing launchLocal or reporting a startup failure remains silent here.
    console.log(normalizeLanguage(process.env.JSONUI_LANGUAGE) === 'en'
      ? 'JSON UI Workbench: Experimental GUI (unfinished). Review visual edits before exporting.'
      : 'JSON UI Workbench: GUI 実験版（未完成）です。書き出す前に編集結果を確認してください。');
    console.log(`${'JSON UI Workbench 0.15.0 · Experimental GUI'}: ${instance.url}`);
    if (!instance.reused) console.log(consoleText('このウィンドウを開いたまま使用してください。終了は Ctrl+C です。', normalizeLanguage(process.env.JSONUI_LANGUAGE)));
  } catch (cause) {
    const code = typeof cause.code === 'string' && cause.code.startsWith('LAUNCH_') ? cause.code : 'LAUNCH_FAILED';
    log(code, { message: cause.message, reasonCode: cause.code });
    process.exitCode = 1;
    await logQueue;
    return;
  }
  const stop = () => {
    const deadline = setTimeout(() => process.exit(1), 10000);
    instance.close().then(() => { clearTimeout(deadline); log('LAUNCH_STOPPED', {}); }, cause => {
      log('LAUNCH_CLOSE_FAILED', { message: cause.message }); process.exitCode = 1;
    });
  };
  if (!instance.reused) { process.once('SIGINT', stop); process.once('SIGTERM', stop); }
  await logQueue;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main().catch(cause => {
    // Includes directory preparation before file logging is available.
    const code = typeof cause.code === 'string' && cause.code.startsWith('LAUNCH_') ? cause.code : 'LAUNCH_FAILED';
    console.error(JSON.stringify(launcherLogRecord(code, {
      message: cause.message, reasonCode: cause.code,
    })));
    process.exitCode = 1;
  });
}
