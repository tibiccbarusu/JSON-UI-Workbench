import test from 'node:test';
import assert from 'node:assert/strict';
import { pageWorkspaceEntries, PICKER_PAGE_SIZE, formatWorkspaceImportPhase } from '../src/ui/workspace-navigation.js';

const entries = Array.from({ length: 100_003 }, (_, index) => ({
  value: `ui/file_${index}.json`, label: `ui/file_${index}.json`,
}));

test('巨大カタログでもページ表示数と選択中項目は有限', () => {
  const result = pageWorkspaceEntries(entries, { page: 1, selectedValue: entries.at(-1).value });
  assert.equal(result.entries.length, PICKER_PAGE_SIZE);
  assert.equal(result.pinned.value, entries.at(-1).value);
  assert.equal(result.total, entries.length);
  assert.equal(result.start, 101);
  assert.equal(result.end, 200);
});

test('ページ移動で末尾まで到達でき、負数・無限・範囲外を正規化', () => {
  assert.equal(pageWorkspaceEntries(entries, { page: -5 }).page, 0);
  assert.equal(pageWorkspaceEntries(entries, { page: Infinity }).page, 0);
  const last = pageWorkspaceEntries(entries, { page: 10_000 });
  assert.equal(last.entries.length, 3);
  assert.equal(last.entries.at(-1).value, entries.at(-1).value);
  assert.equal(last.end, entries.length);
});

test('空の検索結果でもプレビュー対象を暗黙に変更しない', () => {
  const result = pageWorkspaceEntries(entries, { query: '存在しない定義', selectedValue: entries[350].value });
  assert.equal(result.total, 0);
  assert.equal(result.entries.length, 0);
  assert.equal(result.pinned.value, entries[350].value);
  assert.equal(result.start, 0);
});

test('検索は大小文字と複数語に対応し正規表現やHTMLとして扱わない', () => {
  const rows = [
    { value: 'book', label: 'Book', search: 'Enchanting 本 common.book' },
    { value: 'literal', label: '<img src=x onerror=alert(1)>.*[' },
  ];
  assert.deepEqual(pageWorkspaceEntries(rows, { query: '本 ENCHANTING' }).entries.map((row) => row.value), ['book']);
  assert.deepEqual(pageWorkspaceEntries(rows, { query: '.*[' }).entries.map((row) => row.value), ['literal']);
  assert.equal(rows[1].label, '<img src=x onerror=alert(1)>.*[');
});

test('選択中項目がページに存在するときは重複しない', () => {
  const result = pageWorkspaceEntries(entries, { selectedValue: entries[5].value });
  assert.equal(result.pinned, null);
  assert.equal(result.entries.filter((entry) => entry.value === entries[5].value).length, 1);
});

test('未知の処理段階を成功へ丸めない', () => {
  assert.equal(formatWorkspaceImportPhase('node-upload'), 'ローカル処理へ読み込み中');
  assert.equal(formatWorkspaceImportPhase('UNEXPECTED_STAGE'), 'UNEXPECTED_STAGE');
});
