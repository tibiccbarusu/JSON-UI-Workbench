import { siteText, translateSiteMessage } from '../i18n/site-messages.js';
/** A bounded transport queue. One frame runs and one latest frame may wait.
 * Time-only updates may display the completed frame; changed data/model inputs
 * reject stale output. Otherwise a slow renderer could never display playback.
 */
export function createNodeFrameController({ request, onResult, onError, onStatus }) {
  const models = new WeakMap();
  let desired = null, pending = null, running = false, generation = 0;
  const stats = { submitted: 0, completed: 0, replaced: 0, discarded: 0, failures: 0, modelRetries: 0 };
  async function drain() {
    if (running || !pending) return;
    const job = pending;
    pending = null;
    running = true;
    onStatus?.('working', job);
    try {
      const modelId = models.get(job.file);
      const payload = { ...job.input, generation: job.generation,
        ...(modelId ? { modelId } : { file: job.file }) };
      let result;
      try { result = await request(payload); }
      catch (error) {
        if (!modelId || error.message !== 'NODE_FRAME_MODEL_STALE') throw error;
        models.delete(job.file); stats.modelRetries++;
        result = await request({ ...job.input, generation: job.generation, file: job.file });
      }
      if (result?.schema !== 'jsonui-frame-v1' || result.generation !== job.generation
        || !Array.isArray(result.layout?.boxes) || typeof result.modelId !== 'string') {
        throw new Error('NODE_FRAME_RESPONSE_INVALID');
      }
      models.set(job.file, result.modelId);
      stats.completed++;
      const rewound = Number.isFinite(desired?.input?.animationTime) && Number.isFinite(job.input.animationTime)
        && desired.input.animationTime < job.input.animationTime;
      if (desired?.file === job.file && desired.contextKey === job.contextKey && !rewound) onResult(result, job);
      else stats.discarded++;
    } catch (error) {
      stats.failures++;
      const rewound = Number.isFinite(desired?.input?.animationTime) && Number.isFinite(job.input.animationTime)
        && desired.input.animationTime < job.input.animationTime;
      if (desired?.file === job.file && desired.contextKey === job.contextKey && !rewound) onError?.(error, job);
    } finally {
      running = false;
      onStatus?.(pending ? 'working' : 'idle', desired);
      if (pending) void drain();
    }
  }
  return {
    submit({ file, contextKey, input }) {
      if (pending) stats.replaced++;
      desired = { file, contextKey, input, generation: ++generation };
      pending = desired; stats.submitted++;
      void drain();
      return generation;
    },
    invalidate() { desired = null; pending = null; },
    snapshot() { return { ...stats, inFlight: Number(running), pending: Number(Boolean(pending)) }; },
  };
}

/** Send only changed intrinsic sizes/metrics, never overwrite freshly evaluated text,
 * visibility or bindings with values from an earlier Node frame. */
export function intrinsicSizeOverrides(baseProps, measuredProps) {
  const out = Object.create(null);
  for (const [id, props] of Object.entries(measuredProps || {})) {
    const size = props?.size;
    const previous = baseProps?.[id]?.size;
    if (Array.isArray(size) && size.length === 2
      && (!Array.isArray(previous) || size[0] !== previous[0] || size[1] !== previous[1])) out[id] = { size: [...size] };
    const metric = props?.__jsonui_preview_text_intrinsic_size;
    const beforeMetric = baseProps?.[id]?.__jsonui_preview_text_intrinsic_size;
    if (Array.isArray(metric) && metric.length === 2 && [metric[0], metric[1]].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10_000_000)
      && (!Array.isArray(beforeMetric) || metric[0] !== beforeMetric[0] || metric[1] !== beforeMetric[1])) {
      out[id] = { ...out[id], __jsonui_preview_text_intrinsic_size: [...metric] };
    }
  }
  return out;
}

/** Registered read-only projections already exist in Node. Refer to that
 * snapshot, avoiding another multi-megabyte model upload on first display.
 * Edited/local models use a prepared execution model. Node owns restoration
 * of an evicted projection; an obsolete pack generation must be reselected.
 */
export async function requestNodeFramePayload(payload, { request, prepareFile }) {
  const { file, ...input } = payload;
  if (!file) return request(input);
  const projectionId = file.readOnly === true && file.meta?.resolution?.nodeProjectionId;
  if (typeof projectionId === 'string' && /^[a-f0-9]{64}$/u.test(projectionId)) {
    try { return await request({ ...input, projectionId, filePath: file.uiModel?.filePath || file.path || '' }); }
    catch (error) {
      if (error.message === 'NODE_FRAME_PROJECTION_STALE') {
        error.code = 'NODE_FRAME_PROJECTION_STALE';
        error.message = siteText('表示元のUI情報が失効しました。ファイルとUI定義を選び直してください。');
      }
      throw error;
    }
  }
  return request({ ...input, file: prepareFile(file) });
}

export function describeNodeFrameError(error) {
  const code = String(error?.code || error?.message || 'NODE_FRAME_FAILED');
  const messages = {
    NODE_FRAME_MODEL_LIMIT: siteText('選択UIの実行モデルが64 MiBの上限を超えています。小さいUI定義を選択してください。'),
    NODE_FRAME_REPLY_LIMIT: siteText('描画結果の転送が24 MiBの上限を超えています。CLIの --frame-summary で件数と打切り理由を確認できます。部品別の確認は全体の合格を意味しません。'),
    NODE_BODY_LIMIT: siteText('送信データが16 MiBの上限を超えています。パックからUIを選び直すか、編集データを減らしてください。'),
    NODE_FRAME_DEPTH_LIMIT: siteText('UIの入れ子が256段の上限を超えています。定義の構造を確認してください。'),
    NODE_FRAME_NODE_LIMIT: siteText('UI要素数が上限を超えているか、実行モデルが空です。小さいUI定義を選択してください。'),
    NODE_FRAME_STATE_LIMIT: siteText('状態データが1 MiBの上限を超えています。指定する項目数や文字量を減らしてください。'),
    NODE_FRAME_PROJECTION_STALE: siteText('表示元のUI情報が失効しました。ファイルとUI定義を選び直してください。'),
    NODE_FRAME_PROJECTION_IDENTITY_MISMATCH: siteText('選択UIとNodeの保持情報が一致しません。ファイルとUI定義を選び直してください。'),
    POCKET_PREVIEW_BLOCKED: siteText('Pocket UIはプレビューできません。Classic UIを選択してください。'),
    NODE_QUEUE_FULL: siteText('Nodeで別の処理が進行中です。少し待って「表示を再計算」で再試行してください。'),
  };
  if (messages[code]) return messages[code];
  if (error?.name === 'TimeoutError' || code === 'NODE_WORKER_TIMEOUT') return siteText('Nodeの応答が制限時間内に届きませんでした。「表示を再計算」で再試行してください。');
  return siteText`${code}。「表示を再計算」で再試行し、解消しない場合はログを保存してください。`;
}
