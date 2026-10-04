// ブラウザー ESM。未反映の変更は確定原文へ書かず、Node の読取専用投影へ送る。
// UI イベントの連続入力をまとめ、世代の古い応答・タイムアウト・破棄を境界で処理する。
const makeError = (code, message) => Object.assign(new Error(message), { code });
const identity = value => value ? JSON.stringify([value.workspaceId, value.expectedRevision,
  value.pendingVersion, value.screen, value.preview, value.variables, value.representativeCollections, value.eventFactorySelections, value.frame]) : '';

/**
 * readSnapshot は operations を複製した {workspaceId,expectedRevision,pendingVersion,screen,preview,operation}。
 * project は AbortSignal を受ける読取専用 API。確定操作やリトライはこのモジュールへ渡さない。
 * getResult は現在の世代に一致した結果だけを返す。失敗しても呼出側の確定画像は削除しない。
 */
export function createWorkspaceDraftPreview23({ readSnapshot, project, onChange = () => {},
  delayMs = 180, timeoutMs = 45000 } = {}) {
  if (typeof readSnapshot !== 'function' || typeof project !== 'function'
    || !Number.isFinite(delayMs) || delayMs < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw makeError('WORKSPACE_DRAFT_ADAPTER_INVALID', '草稿プレビューの通信と時間制限を設定してください。');
  }
  let generation = 0, timer = null, active = null, queued = null, ready = null, failedKey = null;
  const state = { status: 'idle', version: null, error: null, requested: 0, completed: 0, superseded: 0, timedOut: 0, cancelled: 0, progress: null,
    retryRequired: false, suppressedRetries: 0 };
  const emit = kind => onChange({ ...state }, kind);
  function current(key, ownGeneration) {
    // 送信後に呼出元の表示条件オブジェクトが更新されても、送信時のキーは変えない。
    return generation === ownGeneration && identity(readSnapshot()) === key;
  }
  function stopTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function cancel() {
    generation++; stopTimer(); queued = null; ready = null; failedKey = null; state.retryRequired = false;
    active?.controller.abort(); state.progress = null; state.status = 'idle'; state.version = null; state.error = null;
    emit('draft-idle');
  }
  async function start() {
    stopTimer();
    if (active || !queued) return active?.promise ?? null;
    const job = queued; queued = null;
    const { snapshot, key, ownGeneration } = job;
    if (!current(key, ownGeneration)) { state.superseded++; return null; }
    const controller = new AbortController();
    state.status = 'loading'; state.error = null; state.progress = null; state.version = snapshot.pendingVersion;
    state.requested++; emit('draft-loading');
    const token = { controller, promise: null, key, ownGeneration }; active = token;
    token.promise = (async () => {
      let timeout;
      try {
        const deadline = new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(makeError('WORKSPACE_DRAFT_TIMEOUT', '草稿プレビューの計算が時間内に完了しませんでした。変更は保持されています。再計算してください。'));
          }, timeoutMs);
        });
        const result = await Promise.race([Promise.resolve().then(() => project(snapshot, { signal: controller.signal, onProgress: progress => {
          if (current(key, ownGeneration)) { state.progress = { ...progress }; emit('draft-progress'); }
        } })), deadline]);
        if (!current(key, ownGeneration)) { state.superseded++; return null; }
        if (!result || result.ok === false || result.pendingVersion !== snapshot.pendingVersion
          || result.baseRevision !== snapshot.expectedRevision) {
          throw makeError(result?.code || 'WORKSPACE_DRAFT_RESPONSE_INVALID', result?.error?.message
            || '草稿プレビューの応答と編集世代が一致しません。変更を確認して再計算してください。');
        }
        ready = { key, result }; state.status = 'ready'; state.completed++;
        emit('draft-ready'); return result;
      } catch (error) {
        if (!current(key, ownGeneration)) { state.superseded++; return null; }
        state.status = 'error'; state.error = { code: error?.code || 'WORKSPACE_DRAFT_FAILED',
          message: String(error?.message || error).slice(0, 1000) };
        failedKey = key; state.retryRequired = true;
        if (error?.code === 'WORKSPACE_DRAFT_TIMEOUT') state.timedOut++;
        emit('draft-error'); return null;
      } finally {
        clearTimeout(timeout);
        if (active === token) active = null;
        if (queued) timer = setTimeout(() => void start(), delayMs);
      }
    })();
    return token.promise;
  }
  function request({ immediate = false } = {}) {
    const snapshot = readSnapshot();
    if (!snapshot) { cancel(); return Promise.resolve(null); }
    const key = identity(snapshot);
    if (ready?.key === key && state.status === 'ready') return Promise.resolve(ready.result);
    // 同一入力の再通知は時間切れ計算を繰り返さない。再計算ボタン（flush）、
    // 新しい編集・表示条件、破棄後の再要求では再開できる。
    if (!immediate && failedKey === key) { state.suppressedRetries++; return Promise.resolve(null); }
    if (active?.key === key && active.ownGeneration === generation && !active.controller.signal.aborted && !queued) return active.promise;
    if (queued?.key === key) return immediate ? start() : Promise.resolve(null);
    generation++; stopTimer();
    // A superseded preview has no persistent effects. Abort its HTTP request
    // so the Worker can stop at its next bounded computation checkpoint.
    if (active && !active.controller.signal.aborted) { active.controller.abort(); state.cancelled++; }
    state.progress = null;
    queued = { snapshot, key, ownGeneration: generation }; failedKey = null; state.retryRequired = false;
    state.status = 'queued'; state.error = null; state.version = snapshot.pendingVersion;
    emit('draft-queued');
    if (!active) {
      if (immediate) return start();
      timer = setTimeout(() => void start(), delayMs);
    }
    return Promise.resolve(null);
  }
  return { request, flush: () => request({ immediate: true }), cancel,
    getResult: () => ready?.key === identity(readSnapshot()) ? ready.result : null,
    getStatus: () => ({ ...state }) };
}
