import { test, assert, assertDeepEqual, assertEqual } from './test-harness.js';
import { parseJsonc } from '../src/json/jsonc.js';
import { stableStringify } from '../src/json/stable-stringify.js';
import { looksLikeLangKey } from '../src/assets/lang-table.js';

test('parseJsonc parses comments and trailing commas', () => {
  const input = `// comment\n{\n  "a": 1, /* mid */\n  "b": 2,\n}\n`;
  const res = parseJsonc(input, { fileName: 'sample_screen.json' });
  assert(res && res.ok === true, 'Expected ok=true');
  assertDeepEqual(res.value, { a: 1, b: 2 });
});

test('parseJsonc reports syntax errors with file context', () => {
  const input = `{\n  "a": 1,\n  "b": ,\n}\n`;
  const res = parseJsonc(input, { fileName: 'broken.json' });
  assert(res && res.ok === false, 'Expected ok=false');
  assert(Array.isArray(res.errors) && res.errors.length > 0, 'Expected at least one error');
  const e = res.errors[0];
  assert(typeof e.message === 'string' && e.message.includes('broken.json'), 'Expected error message to include fileName');
  const line = Number(e.line);
  const column = Number(e.column);
  assert(Number.isFinite(line) && line >= 1, 'Expected line >= 1');
  assert(Number.isFinite(column) && column >= 1, 'Expected column >= 1');
});

test('stableStringify produces deterministic JSON and final newline', () => {
  const obj = { b: 1, a: 2 };
  const out = stableStringify(obj, { sortKeys: true, indent: 2, finalNewline: true });
  const expected = '{\n  "a": 2,\n  "b": 1\n}\n';
  assertEqual(out, expected);
});

test('stableStringify keeps array order', () => {
  const obj = { a: [3, 2, 1] };
  const out = stableStringify(obj, { sortKeys: true, indent: 0, finalNewline: false });
  assertEqual(out, '{"a":[3,2,1]}');
});

test('language-key detection does not misclassify plain UI labels', () => {
  assertEqual(looksLikeLangKey('AUTO'), false);
  assertEqual(looksLikeLangKey('Play'), false);
  assertEqual(looksLikeLangKey('menu.title'), true);
  assertEqual(looksLikeLangKey('accessibility:button.name'), true);
});
