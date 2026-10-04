/*
  test-runner.js (S059)

  Browser entrypoint for the unit tests page.

  How it works:
  - Imports all test suites (they register tests via test()).
  - Executes the registered tests and renders results into the DOM.
*/

import { getRegisteredTests, runRegisteredTests } from './test-harness.js';

// Test suites (register tests).
import './suite-json.js';
import './suite-path.js';
import './suite-security.js';
import './suite-packsource.js';
import './suite-evaluator.js';
import './suite-regressions.js';
import './suite-export-contract.js';
import './suite-site-diagnostics.js';
import './suite-log-export.js';
import './suite-vanilla-reference-audit.js';
import './suite-official-release-verifier.js';
import './suite-font-face-cache.js';
import './suite-ui-engine.js';
import './suite-native-renderer-preview.js';

const summaryEl = /** @type {HTMLElement|null} */ (document.getElementById('summary'));
const resultsEl = /** @type {HTMLElement|null} */ (document.getElementById('results'));
const startedAtIso = new Date().toISOString();

function setSummary(text) {
  if (!summaryEl) return;
  summaryEl.textContent = String(text || '');
}

function appendResultRow(res) {
  if (!resultsEl) return;

  const li = document.createElement('li');
  li.className = res.ok ? 'pass' : 'fail';

  const name = document.createElement('div');
  name.className = 'test-name';
  name.textContent = `${res.ok ? 'PASS' : 'FAIL'}: ${res.name}`;

  const meta = document.createElement('div');
  meta.className = 'test-meta';
  meta.textContent = `${res.durationMs.toFixed(1)}ms`;

  li.appendChild(name);
  li.appendChild(meta);

  if (!res.ok && res.error) {
    const pre = document.createElement('pre');
    pre.className = 'test-error';
    const lines = [];
    lines.push(`${res.error.name}: ${res.error.message}`);
    if (res.error.stack) lines.push(res.error.stack);
    pre.textContent = lines.join('\n');
    li.appendChild(pre);
  }

  resultsEl.appendChild(li);
}

async function main() {
  const testCount = getRegisteredTests().length;

  setSummary(`Starting tests...\nregisteredTests=${testCount}\nstartedAtIso=${startedAtIso}`);

  const result = await runRegisteredTests();

  for (const r of result.results) appendResultRow(r);

  const summaryLines = [];
  summaryLines.push(`status=${result.stats.failed === 0 ? 'PASS' : 'FAIL'}`);
  summaryLines.push(`registeredTests=${testCount}`);
  summaryLines.push(`passed=${result.stats.passed}`);
  summaryLines.push(`failed=${result.stats.failed}`);
  summaryLines.push(`durationMs=${result.stats.durationMs.toFixed(1)}`);
  summaryLines.push(`startedAtIso=${startedAtIso}`);
  summaryLines.push(`finishedAtIso=${new Date().toISOString()}`);

  // Expose for debugging.
  globalThis.__JSONUI_TEST_RESULTS__ = result;

  setSummary(summaryLines.join('\n'));
  document.title = `JSONUI Tests - ${result.stats.failed === 0 ? 'PASS' : 'FAIL'} (${result.stats.passed}/${testCount})`;
}

main().catch((err) => {
  const anyErr = /** @type {any} */ (err);
  setSummary(`FATAL: ${String(anyErr && anyErr.message ? anyErr.message : err)}\nSee console for details.`);
  // Re-throw so it shows in devtools.
  throw err;
});
