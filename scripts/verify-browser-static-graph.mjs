import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createLocalServer } from '../local-node/server.mjs';

// This verifies delivery, parsing, linking and declared static URLs. It never
// evaluates browser modules and does not claim that the DOM application starts.
if (typeof vm.SourceTextModule !== 'function') {
  throw new Error('Run with: node --experimental-vm-modules scripts/verify-browser-static-graph.mjs');
}
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const editorRoot = path.join(projectRoot, 'editor-core');
const evidencePath = path.resolve(projectRoot, process.argv[2] || 'docs/upgrade-20260906/evidence/browser-static-http.json');
const startedAt = new Date().toISOString();
const resources = new Map();
const modules = new Map();
const edges = [];
const selectorChecks = [];
const urlChecks = [];
const errors = [];
const context = vm.createContext({});
const deadline = AbortSignal.timeout(120_000);
let app;
let origin;
let rootRedirect;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/\b([a-zA-Z][\w-]*)\s*=\s*(["'])(.*?)\2/gu)].map((match) => [match[1].toLowerCase(), match[3]]));
}

async function loadResource(url, expectedTypes, role) {
  const normalized = new URL(url);
  normalized.hash = '';
  assert.equal(normalized.origin, origin, '静的依存は同一originである');
  assert.equal(/^\/(?:src|app|vendor|assets|data|docs)\//u.test(normalized.pathname), true, '本番静的経路のみ走査');
  assert.equal(/(?:^|\/)tests?(?:\/|\.)/iu.test(normalized.pathname), false, 'testは本番依存に含めない');
  const key = normalized.href;
  if (resources.has(key)) {
    const existing = resources.get(key);
    assert.equal(expectedTypes.includes(existing.mime), true, `MIME ${normalized.pathname}`);
    return existing;
  }
  const response = await fetch(key, { redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)]) });
  assert.equal(response.status, 200, `HTTP ${normalized.pathname}`);
  const mime = String(response.headers.get('content-type') || '').split(';')[0].trim();
  assert.equal(expectedTypes.includes(mime), true, `MIME ${normalized.pathname}: ${mime}`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const bytes = Buffer.from(await response.arrayBuffer());
  const localPath = path.join(editorRoot, decodeURIComponent(normalized.pathname));
  const local = await readFile(localPath);
  assert.equal(digest(bytes), digest(local), `配信内容とファイルのhash ${normalized.pathname}`);
  const record = { url: normalized.pathname, role, status: response.status, mime, bytes: bytes.length, sha256: digest(bytes), text: bytes.toString('utf8') };
  resources.set(key, record);
  return record;
}

async function loadModule(url) {
  const key = new URL(url).href;
  if (modules.has(key)) return modules.get(key);
  const source = await loadResource(key, ['text/javascript', 'application/javascript'], 'ES module');
  const module = new vm.SourceTextModule(source.text, { context, identifier: key });
  modules.set(key, module);
  for (const specifier of module.dependencySpecifiers) {
    assert.equal(specifier.startsWith('node:'), false, `ブラウザへのNode builtin混入: ${specifier}`);
    assert.equal(/^(?:\.\.?\/|\/)/u.test(specifier), true, `import mapのない裸specifier: ${specifier}`);
    const target = new URL(specifier, key);
    edges.push({ from: new URL(key).pathname, specifier, to: target.pathname });
    await loadModule(target);
  }
  return module;
}

async function inspectStylesheet(url) {
  const css = await loadResource(url, ['text/css'], 'CSS');
  const text = css.text.replace(/\/\*[\s\S]*?\*\//gu, '');
  const references = new Set();
  for (const match of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gu)) references.add(match[2].trim());
  for (const match of text.matchAll(/@import\s+(["'])(.*?)\1/gu)) references.add(match[2]);
  for (const reference of references) {
    if (/^(?:data:|#)/u.test(reference)) continue;
    const target = new URL(reference, url);
    if (target.pathname.endsWith('.css')) await inspectStylesheet(target);
    else await loadResource(target, ['image/png', 'image/svg+xml', 'image/jpeg', 'font/woff2', 'font/ttf', 'application/octet-stream'], 'CSS asset');
  }
}

try {
  app = await createLocalServer({ port: 0 });
  origin = `http://127.0.0.1:${app.port}`;
  const rootResponse = await fetch(`${origin}/`, { redirect: 'manual', signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)]) });
  rootRedirect = { status: rootResponse.status, location: rootResponse.headers.get('location') };
  assert.equal(rootRedirect.status, 302);
  assert.equal(rootRedirect.location, '/app/index.html');
  const documentUrl = new URL(rootRedirect.location, origin);
  const html = await loadResource(documentUrl, ['text/html'], 'document');
  const htmlText = html.text.replace(/<!--[\s\S]*?-->/gu, '');
  const htmlIds = [...htmlText.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gu)].map((match) => match[2]);
  assert.equal(new Set(htmlIds).size, htmlIds.length, 'HTML内のID重複なし');
  const entryModules = [];
  for (const match of htmlText.matchAll(/<script\b[^>]*>/giu)) {
    const attrs = attributes(match[0]);
    assert.ok(attrs.src, 'inline scriptは存在しない');
    const scriptUrl = new URL(attrs.src, documentUrl);
    if (attrs.type === 'module') entryModules.push(await loadModule(scriptUrl));
    else {
      const classic = await loadResource(scriptUrl, ['text/javascript', 'application/javascript'], 'classic vendor script');
      new vm.Script(classic.text, { filename: scriptUrl.pathname });
    }
  }
  assert.ok(entryModules.length > 0, 'HTMLにmodule entrypointがある');
  for (const match of htmlText.matchAll(/<link\b[^>]*>/giu)) {
    const attrs = attributes(match[0]);
    if (attrs.rel === 'stylesheet') await inspectStylesheet(new URL(attrs.href, documentUrl));
  }
  for (const module of entryModules) {
    await module.link((specifier, referencingModule) => {
      const target = new URL(specifier, referencingModule.identifier).href;
      const found = modules.get(target);
      assert.ok(found, `未走査の依存: ${target}`);
      return found;
    });
    assert.equal(module.status, 'linked', 'ESM名前付きexportも含むlink検査');
  }

  const mainUrl = new URL('/src/main.js', origin);
  const main = resources.get(mainUrl.href).text;
  // These are bounded, literal application resource declarations, checked
  // separately from the compiler-discovered ESM graph.
  const localeMatch = main.match(/localeBaseUrl:\s*new URL\(\s*(["'])(.*?)\1\s*,\s*import\.meta\.url\)/u);
  assert.ok(localeMatch, 'mainのlocaleBaseUrl宣言');
  const supportedMatch = main.match(/supportedLocales:\s*\[([^\]]+)\]/u);
  assert.ok(supportedMatch, 'supportedLocales宣言');
  const locales = [...supportedMatch[1].matchAll(/(["'])(.*?)\1/gu)].map((match) => match[2]);
  for (const locale of locales) {
    const url = new URL(`${locale}.json`, new URL(localeMatch[2], mainUrl));
    const resource = await loadResource(url, ['application/json'], 'locale');
    const table = JSON.parse(resource.text);
    assert.equal(Object.values(table).every((value) => typeof value === 'string'), true, `locale形式 ${locale}`);
    urlChecks.push({ kind: 'locale', reference: locale, url: url.pathname, status: 'PASS' });
  }
  const ownedResources = new Set([...main.matchAll(/editorResourceUrl\(\s*(["'])(.*?)\1\s*\)/gu)].map((match) => match[2]));
  // The only conditional editorResourceUrl argument has two literal help paths.
  for (const match of main.matchAll(/(["'])(\.\.\/docs\/user_guide_(?:ja|en)\.md)\1/gu)) ownedResources.add(match[2]);
  for (const reference of ownedResources) {
    const url = new URL(reference, mainUrl);
    await loadResource(url, ['application/octet-stream', 'application/zip', 'text/markdown', 'text/plain'], 'explicit application asset');
    urlChecks.push({ kind: 'editorResourceUrl', reference, url: url.pathname, status: 'PASS' });
  }

  for (const id of ['route-root', 'status-text', 'btn-lang']) {
    assert.equal(htmlIds.includes(id), true, `HTML selector ${id}`);
    assert.equal(main.includes(`getElementById('${id}')`) || main.includes(`getElementById("${id}")`), true, `main参照 ${id}`);
    selectorChecks.push({ id, source: 'index.html', consumer: 'main.js', status: 'PASS', kind: 'literal static reference' });
  }
  for (const id of ['workspace-open-preview', 'resource-pack-file-button', 'resource-pack-file-input', 'vanilla-base-file-input', 'workspace-diagnostic-summary']) {
    assert.equal(main.includes(`id: '${id}'`), true, `main生成 ${id}`);
    assert.equal(main.includes(`getElementById('${id}')`), true, `main参照 ${id}`);
    selectorChecks.push({ id, source: 'main.js', consumer: 'main.js', status: 'PASS', kind: 'literal static reference' });
  }
  const picker = resources.get(new URL('/src/ui/workspace-navigation.js', origin).href).text;
  for (const base of ['workspace-file-picker', 'workspace-definition-picker']) {
    assert.equal(main.includes(`id: '${base}'`), true, `picker引数 ${base}`);
    assert.equal(picker.includes('id: `${id}-search`'), true, 'pickerのsearch ID組立');
    assert.equal(picker.includes("id, class: 'screen-open-select'"), true, 'pickerのselect ID組立');
    selectorChecks.push({ id: `${base} / ${base}-search`, source: 'main.js → workspace-navigation.js', consumer: 'picker callbacks', status: 'PASS', kind: 'declared ID composition' });
  }
  assert.equal(main.includes("getElementById('workspace-file-picker-search')"), true, 'Ctrl+Kの検索target');
  const native = resources.get(new URL('/src/ui/native-model-settings.js', origin).href).text;
  assert.equal(main.includes('renderNativeModelSettings(h,'), true, 'Canvasと3D設定moduleの接続');
  assert.equal(native.includes("id: 'native-model-load-status'"), true);
  assert.equal(main.includes("getElementById('native-model-load-status')"), true);
  selectorChecks.push({ id: 'native-model-load-status', source: 'native-model-settings.js', consumer: 'main.js', status: 'PASS', kind: 'literal static reference' });

  // Missing routes must remain missing; an SPA HTML fallback would mask a
  // broken module URL and fail later with a JavaScript MIME error.
  for (const route of ['/src/does-not-exist-static-probe.js', '/tests/index.html', '/local-node/server.mjs']) {
    const response = await fetch(new URL(route, origin), { signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)]) });
    await response.arrayBuffer();
    assert.equal(response.status, 404, `404の維持 ${route}`);
    urlChecks.push({ kind: 'negative route control', url: route, expectedStatus: 404, status: 'PASS' });
  }
} catch (error) {
  errors.push({ name: error.name, message: error.message, stack: String(error.stack || '').split('\n').slice(0, 8) });
} finally {
  if (app) await app.close();
  const result = {
    startedAt, finishedAt: new Date().toISOString(), status: errors.length ? 'FAIL' : 'PASS_STATIC_HTTP_ONLY',
    runtime: { node: process.version, platform: process.platform, parser: 'vm.SourceTextModule (parse/link only; never evaluate)' },
    rootRedirect,
    summary: { moduleCount: modules.size, importEdgeCount: edges.length, resourceCount: resources.size, selectorChecks: selectorChecks.length, urlChecks: urlChecks.length, failures: errors.length },
    boundaries: {
      browserDomExecution: 'NOT_RUN', browserVisual: 'NOT_RUN', minecraftDeviceComparison: 'NOT_RUN',
      modules: 'Only statically reachable production ES modules from index.html; test and Node backend graphs are not crawled. A builtin imported by production browser code is rejected.',
      assets: 'HTML scripts/styles; CSS literal URL/import references; declared locales; literal editorResourceUrl assets. User packs, conditional API requests, arbitrary dynamic import/worker payloads and external URLs are not simulated.',
      selectors: 'Literal declaration/reference and known ID composition checks. This does not execute DOM creation or event handlers.',
    },
    resources: [...resources.values()].map(({ text, ...record }) => record), edges, selectorChecks, urlChecks, errors,
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, ...result.summary, evidencePath }));
  if (errors.length) { console.error(errors[0].message); process.exitCode = 1; }
}
