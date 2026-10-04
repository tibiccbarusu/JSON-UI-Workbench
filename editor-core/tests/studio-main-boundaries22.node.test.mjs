/** 新 VM 境界も実 main の禁止条件を保つ。ブラウザ・描画検査ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { installStudioMainBoundaries22 } from './helpers/studio-main-boundaries22.mjs';
import { setup } from './helpers/navigation-main-harness.mjs';
import { setupAudioMain } from './helpers/ui-audio-main-harness.mjs';
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function harness() {
  const events = [], elements = new Map([
    ['studio-context-menu', { remove: () => events.push('remove-menu') }],
    ['studio-context-scrim', { remove: () => events.push('remove-scrim') }],
    ['preview-canvas', { focus: options => events.push(['focus', options.preventScroll]) }],
  ]);
  const sandbox = vm.createContext({ safeRender: () => events.push('render'), document: { getElementById: id => elements.get(id) } });
  const frames = installStudioMainBoundaries22(sandbox, source);
  return { sandbox, events, frames };
}
const blockers = [
  ['反映中', state => state.busy = true],
  ['未反映操作', state => state.pendingOperations.push({ type: 'setProperty' })],
  ['commit 成否未確定', state => state.pendingCommitUncertain = true],
  ['未適用原文', state => state.drafts.set('source', { dirty: true })],
  ['無効原文', state => state.drafts.set('source', { invalid: true })],
];
for (const [name, apply] of blockers) test(`実 main の ${name} ガードを空実装へ変更していない`, async () => {
  const { sandbox: s } = harness();
  assert.equal(s.studioRuntimeChangesBlocked21(), false);
  apply(s.sourceWorkspace.state);
  assert.equal(s.studioRuntimeChangesBlocked21(), true);
  assert.throws(() => s.assertStudioExternalChange21('検査'), { code: 'WORKSPACE_EXTERNAL_CHANGE_BLOCKED' });
  assert.throws(() => s.assertStudioProjectionChange21(), { code: 'WORKSPACE_EXTERNAL_CHANGE_BLOCKED' });
  const navigation = setup(); apply(navigation.sandbox.sourceWorkspace.state);
  await assert.rejects(navigation.start(), { code: 'WORKSPACE_EXTERNAL_CHANGE_BLOCKED' });
  assert.equal(navigation.events.length, 0);
  assert.equal(navigation.listeners.size, 0);
  const audio = setupAudioMain(); apply(audio.sandbox.sourceWorkspace.state);
  assert.equal(audio.api.getInteractionPreviewContext(audio.file.id).enabled, false);
  audio.api.prepareCurrentPreviewAudio(audio.state, audio.file, audio.cs);
  assert.equal(audio.calls.filter(([kind]) => kind === 'prepare' || kind === 'request').length, 0);
});
test('内部更新の同一 Symbol だけが projection ガードを通過する', () => {
  const { sandbox: s } = harness(); s.sourceWorkspace.state.busy = true;
  assert.throws(() => s.assertStudioProjectionChange21({ workspaceRefreshToken: Symbol('test internal refresh') }), { code: 'WORKSPACE_EXTERNAL_CHANGE_BLOCKED' });
  assert.doesNotThrow(() => s.assertStudioProjectionChange21({ workspaceRefreshToken: s.STUDIO_INTERNAL_REFRESH21 }));
  const seen = []; s.store = { dispatch: action => seen.push(action) };
  const action = { type: 'files/openFile' };
  s.dispatchStudioProjection21(action, { workspaceRefreshToken: s.STUDIO_INTERNAL_REFRESH21 });
  assert.equal(action[s.STUDIO_INTERNAL_REFRESH21], true); assert.equal(seen[0], action);
});
test('実 close 関数が menu と scrim を除去し、要求時だけ canvas focus を戻す', () => {
  const { sandbox: s, events } = harness(); s.studioUi.contextMenu = { fileId: 'screen' };
  s.closeStudioContextMenu21(); assert.deepEqual(events, ['remove-menu', 'remove-scrim']);
  assert.equal(s.studioUi.contextMenu, null);
  s.closeStudioContextMenu21({ restoreFocus: true });
  assert.deepEqual(events.at(-1), ['focus', true]);
});
test('animation frame は即時実行せず、実 deferred flush は一度だけ render する', () => {
  const { sandbox: s, events, frames } = harness();
  s.workspaceRenderDeferred = true;
  s.requestAnimationFrame(s.flushDeferredWorkspaceRender); s.requestAnimationFrame(s.flushDeferredWorkspaceRender);
  const cancelled = s.requestAnimationFrame(() => { throw new Error('cancelled frame ran'); }); s.cancelAnimationFrame(cancelled);
  assert.equal(events.length, 0); assert.equal(frames.flushAnimationFrames(), 2);
  assert.deepEqual(events, ['render']); assert.equal(s.workspaceRenderDeferred, false);
  assert.equal(frames.flushAnimationFrames(), 0);
});
