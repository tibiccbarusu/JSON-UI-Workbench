import '../tests/suite-json.js';
import '../tests/suite-path.js';
import '../tests/suite-security.js';
import '../tests/suite-packsource.js';
import '../tests/suite-evaluator.js';
import '../tests/suite-regressions.js';
import '../tests/suite-export-contract.js';
import '../tests/suite-site-diagnostics.js';
import '../tests/suite-log-export.js';
import '../tests/suite-vanilla-reference-audit.js';
import '../tests/suite-official-release-verifier.js';
import '../tests/suite-font-face-cache.js';
import '../tests/suite-native-renderer-preview.js';
import '../tests/suite-effective-ui-regressions.js';
import '../tests/suite-ui-engine.js';
import { getRegisteredTests, runRegisteredTests } from '../tests/test-harness.js';

const result = await runRegisteredTests();
const summary = {
  status: result.stats.failed === 0 ? 'PASS' : 'FAIL',
  registered: getRegisteredTests().length,
  passed: result.stats.passed,
  failed: result.stats.failed,
  durationMs: result.stats.durationMs,
};

console.log(JSON.stringify(summary, null, 2));

for (const item of result.results) {
  if (!item.ok) console.error(JSON.stringify(item, null, 2));
}

if (result.stats.failed > 0) process.exitCode = 1;
