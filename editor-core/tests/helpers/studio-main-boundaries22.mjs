/** 実 main の編集ガードを VM へ供給する。ガードを空実装に置換しない。 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { siteText, translateSiteMessage } from '../../src/i18n/site-messages.js';
export function installStudioMainBoundaries22(sandbox, source) {
  const section = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert(a >= 0 && b > a, `main 境界を抽出できません: ${start}`);
    assert.equal(source.indexOf(start, a + start.length), -1, `main 境界が重複しています: ${start}`);
    return source.slice(a, b);
  };
  sandbox.siteText = siteText;
  sandbox.translateSiteMessage = translateSiteMessage;
  sandbox.STUDIO_INTERNAL_REFRESH21 ??= Symbol('test internal refresh');
  sandbox.sourceWorkspace ??= { state: { mode: 'preview', busy: false, pendingOperations: [], pendingCommitUncertain: false, drafts: new Map() } };
  sandbox.studioUi ??= { contextMenu: null };
  const animationFrames = new Map();
  let animationFrameId = 0;
  sandbox.requestAnimationFrame ??= callback => { const id = ++animationFrameId; animationFrames.set(id, callback); return id; };
  sandbox.cancelAnimationFrame ??= id => animationFrames.delete(id);
  sandbox.workspaceRenderDeferred ??= false;
  vm.runInContext(section('function assertStudioExternalChange21(', 'function workspaceSources(')
    + section('function closeStudioContextMenu21(', 'function openStudioContextMenu21(')
    + section('function studioRuntimeChangesBlocked21(', 'function studioRuntimeControlsH21(')
    + section('function flushDeferredWorkspaceRender(', 'const previewPerformance ='), sandbox);
  return { animationFrames, flushAnimationFrames() {
    // One browser animation frame: callbacks queued by these callbacks wait for the next frame.
    const pending = [...animationFrames.values()]; animationFrames.clear();
    for (const callback of pending) callback(0);
    return pending.length;
  } };
}
