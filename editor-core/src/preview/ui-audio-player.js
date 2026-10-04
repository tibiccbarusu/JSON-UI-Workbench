import { createPreviewObservationTrace } from './preview-observation41.js';
import { resolveNodeSound, readNodeSoundBytes, nodeAudioSessionEpoch } from '../pack-io/node-remote-client.js';

export const UI_AUDIO_LIMITS = Object.freeze({ pcmBytes: 64 * 1024 * 1024, singlePcmBytes: 8 * 1024 * 1024,
  encodedBytes: 16 * 1024 * 1024, singleEncodedBytes: 4 * 1024 * 1024, voices: 8, requests: 8, startDeadlineMs: 300 });
const MESSAGES = Object.freeze({
  AUDIO_STARTED: '音声の再生を開始しました。', AUDIO_PREPARED: '音声を準備しました。', AUDIO_EXPIRED: '音声を準備中です。次の操作で再生できます。',
  AUDIO_MUTED: '音量が0のため無音です。', AUDIO_DISABLED: 'プレビュー音声はOFFです。', AUDIO_INVALIDATED: '古い操作の音声を失効しました。',
  AUDIO_CONTEXT_BLOCKED: '音声の許可を確認できません。次の実操作で再試行します。', AUDIO_CONTEXT_UNAVAILABLE: 'この環境ではWeb Audioを利用できません。',
  AUDIO_NODE_UNAVAILABLE: '音声の再生にはNodeローカル版が必要です。', AUDIO_DECODE_FAILED: '短音のdecodeに失敗しました。',
  AUDIO_STREAM_UNSUPPORTED: '長音のストリーム再生は未対応です。', AUDIO_FORMAT_UNSUPPORTED: '対応する短いOGG VorbisまたはPCM16 WAV音声ではありません。',
  AUDIO_SOUND_NAME_INVALID: 'sound_nameが未解決、空、または非対応の値です。', AUDIO_DEFINITION_MISSING: 'sound_nameに対応する音源定義がありません。',
  AUDIO_DEFINITION_INVALID: '音源定義の形式が不正です。上位定義から下位音声へ自動置換はしません。', AUDIO_FILE_MISSING: '音源定義が参照するOGGまたはWAVファイルがありません。',
  AUDIO_FORMAT_AMBIGUOUS: '同じ名前のOGGとWAVが同じパックにあります。音源定義で拡張子を指定してください。',
  AUDIO_FORMAT_MISMATCH: '上位パックの音源形式が明示された拡張子と異なります。下位音源へ自動置換はしません。',
  AUDIO_WAV_CONTAINER_INVALID: 'WAVのRIFFサイズ、chunk長、またはpaddingが不正です。元の音源を確認してください。',
  AUDIO_WAV_HEADER_INVALID: 'WAVのfmt/data構成、blockAlign、またはbyteRateが不正です。',
  AUDIO_WAV_FORMAT_UNSUPPORTED: 'WAVはPCM16、1または2ch、8,000〜192,000Hzに限定しています。',
  AUDIO_WAV_DATA_INVALID: 'WAVの音声データが空か、完全なPCMフレームになっていません。',
  AUDIO_WAV_CHUNK_BUDGET: 'WAVのchunk数が16,384の上限を超えています。',
  AUDIO_METADATA_INVALID: '音声メタデータの形式または整合性を確認できません。パックを再読込してください。',
  AUDIO_DECODED_MISMATCH: 'WAVのdecode後の長さが元のPCMフレーム数と一致しません。',
  AUDIO_PATH_UNSAFE: '安全なパック内音声パスではありません。', AUDIO_PATH_AMBIGUOUS: '大文字・小文字が衝突する音声パスを一意に決められません。',
  AUDIO_VOLUME_INVALID: '音量には有限で0以上の数値を指定してください。出力gainは1以下へ制限します。', AUDIO_PITCH_UNSUPPORTED: '合成後pitchは0.5から2までの数値に対応しています。',
  AUDIO_WEIGHT_INVALID: '音源候補のweightは1以上の整数に対応しています。', AUDIO_PREPARE_BUSY: '音声の準備処理が混雑しています。',
  AUDIO_VOICE_BUDGET: '同時再生数の上限に達したため短音を見送りました。', AUDIO_REQUEST_BUDGET: '待機中の音声要求が上限に達しました。',
  AUDIO_MEMORY_BUDGET: '音声メモリ予算の上限に達したため準備を見送りました。', AUDIO_DECODED_BUDGET: 'decode結果が短音の長さ・PCM予算を超えました。',
  AUDIO_ENCODED_BUDGET: '音声ファイルが4MiBの上限を超えています。', AUDIO_PCM_BUDGET: '音声のPCM予約量が8MiBの上限を超えています。',
  AUDIO_DURATION_UNSUPPORTED: '音声の長さが10秒を超えるか、時間情報が不正です。', AUDIO_DURATION_UNKNOWN: '音声の長さを確認できません。',
  AUDIO_CONTAINER_CRC_INVALID: 'OGGデータのチェックサムが一致しません。', AUDIO_CONTAINER_INVALID: 'OGGコンテナの構成が不正です。',
  AUDIO_CHAINED_STREAM_UNSUPPORTED: '連結されたOGGストリームは未対応です。', AUDIO_HEADER_INVALID: 'Vorbisヘッダーが不正です。',
  NODE_CATALOG_STALE: 'パック構成が変わりました。音声の準備を更新してください。', NODE_PACK_NOT_FOUND: '音源パックが読み込まれていません。',
  NODE_TOKEN_REJECTED: 'Node認証が更新されています。パックを再読込してください。', AUDIO_READ_FAILED: '音声ファイルを取得できませんでした。',
});
function failure(code) { return Object.assign(new Error(code), { code }); }
function validNumber(value, fallback, minimum, maximum, code) {
  const number = value === undefined ? fallback : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum || number > maximum) throw failure(code);
  return number;
}
function errorCode(error) {
  const value = error?.code || error?.message;
  if (value === 'NODE_BACKEND_UNAVAILABLE') return 'AUDIO_NODE_UNAVAILABLE';
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,127}$/u.test(value) ? value : 'AUDIO_READ_FAILED';
}
function soundPreviewEvidence(sound) {
  return {
    warnings: [...new Set((Array.isArray(sound?.warnings) ? sound.warnings : []).slice(0, 16)
      .filter(code => typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,127}$/u.test(code)))],
    definitionCategory: typeof sound?.definitionCategory === 'string' ? sound.definitionCategory.slice(0, 64) : null,
    candidateIs3D: typeof sound?.candidateIs3D === 'boolean' ? sound.candidateIs3D : null,
    spatialAudioMode: 'nonpositional_preview', gameMixerVerified: false,
  };
}

/** App singleton: screen DOM and effects must not own its lifetime. Injected adapters are for deterministic tests. */
export function createUiAudioPlayer({ onDiagnostic = () => {}, resolveSound = resolveNodeSound, readBytes = readNodeSoundBytes,
  getSessionEpoch = nodeAudioSessionEpoch, createContext = () => {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    return AudioContext ? new AudioContext({ latencyHint: 'interactive' }) : null;
  }, now = () => performance.now(), limits = {} } = {}) {
  const observation = createPreviewObservationTrace({ now });
  const budget = { ...UI_AUDIO_LIMITS, ...limits }, cache = new Map(), metadata = new Map(), tasks = new Set(), voices = new Set(), queue = [];
  let context = null, master = null, resumePromise = null, enabled = true, disposed = false, packEpoch;
  let sessionEpoch = getSessionEpoch(), playbackEpoch = 0, sequence = 0, pumping = false, masterVolume = 0.5;
  let pcmBytes = 0, pcmReserved = 0, encodedReserved = 0, decoding = 0;
  function diagnostic(code, task, extra = {}) {
    const result = { status: code === 'AUDIO_STARTED' ? 'started' : code === 'AUDIO_PREPARED' ? 'prepared' : code === 'AUDIO_EXPIRED' ? 'expired'
      : code === 'AUDIO_INVALIDATED' ? 'invalidated' : ['AUDIO_MUTED', 'AUDIO_DISABLED', 'AUDIO_NOT_REQUESTED'].includes(code) ? 'skipped' : 'failed',
      code, errorCode: code, message: MESSAGES[code] || `音声: ${code}`, interactionId: task?.interactionId || null, soundId: task?.soundName || null,
      packEpoch: task?.packEpoch ?? packEpoch ?? null, stage: task?.stage || 'intent', elapsedMs: task ? Math.max(0, now() - task.created) : 0, ...extra };
    observation.append({ kind:'audio-result', ...result, contextState:context?.state||'uncreated', sourceStarted:code==='AUDIO_STARTED', prefetch:task?.prefetch===true });
    result.audibleVerified=false;result.nativeVerified=false;
    if (!(task?.prefetch && code === 'AUDIO_INVALIDATED')) {
      try { onDiagnostic(result); } catch { /* diagnostics cannot break actions/audio cleanup */ }
    }
    return result;
  }
  function finish(task, code, extra) {
    if (task.reported) {
      if (task.reportedCode === 'AUDIO_EXPIRED' && !['AUDIO_EXPIRED', 'AUDIO_STARTED'].includes(code)) {
        task.reportedCode = code; diagnostic(code, task, { ...extra, preparationAfterDeadline: true });
      }
      return;
    }
    task.reported = true; task.reportedCode = code; clearTimeout(task.timer); task.complete(diagnostic(code, task, extra));
  }
  function ensureContext() {
    if (disposed || !enabled) return null;
    if (!context) {
      context = createContext();
      if (!context) return null;
      master = context.createGain(); master.gain.value = masterVolume; master.connect(context.destination);
    }
    return context;
  }
  // Called in the trusted input handler, before any await. Repeated clicks never queue old resume requests.
  function unlock(event) {
    if (event && event.isTrusted !== true) return Promise.resolve({ status: 'skipped', code: 'AUDIO_ACTIVATION_UNTRUSTED' });
    try {
      const ctx = ensureContext();
      if (!ctx) return Promise.resolve(diagnostic(enabled ? 'AUDIO_CONTEXT_UNAVAILABLE' : 'AUDIO_DISABLED'));
      if (ctx.state === 'running') return Promise.resolve({ status: 'ready', code: 'AUDIO_CONTEXT_RUNNING' });
      if (!resumePromise) resumePromise = Promise.resolve(ctx.resume()).then(() => ({ status: ctx.state === 'running' ? 'ready' : 'blocked', code: ctx.state === 'running' ? 'AUDIO_CONTEXT_RUNNING' : 'AUDIO_CONTEXT_BLOCKED' }),
        () => diagnostic('AUDIO_CONTEXT_BLOCKED')).finally(() => { resumePromise = null; });
      return resumePromise;
    } catch { return Promise.resolve(diagnostic('AUDIO_CONTEXT_UNAVAILABLE')); }
  }
  function current(task) { return !disposed && enabled && !task.invalidated && task.packEpoch === packEpoch && task.playbackEpoch === playbackEpoch && sessionEpoch === getSessionEpoch(); }
  function evict(required = 0, all = false) {
    for (const [key, entry] of cache) {
      if (!all && pcmBytes + pcmReserved + required <= budget.pcmBytes) break;
      if (all) entry.discard = true;
      if (entry.refs) continue;
      cache.delete(key); pcmBytes -= entry.bytes;
    }
  }
  function releaseEntry(entry) {
    entry.refs--;
    if (entry.discard && !entry.refs && cache.get(entry.key) === entry) { cache.delete(entry.key); pcmBytes -= entry.bytes; }
  }
  function releaseVoice(voice) {
    if (!voices.delete(voice)) return;
    releaseEntry(voice.entry); voice.source.onended = null;
    try { voice.source.disconnect(); voice.gain.disconnect(); } catch { /* closed context */ }
  }
  function stopVoice(voice) { observation.append({kind:'audio-stopped',interactionId:voice.interactionId,soundId:voice.soundId,contextState:context?.state||'uncreated'});try { voice.source.stop(); } catch { /* already ended */ } releaseVoice(voice); }
  function invalidate({ reason = 'navigation', interactionId } = {}) {
    playbackEpoch++;
    const keep = ['navigation', 'close'].includes(reason) && typeof interactionId === 'string' && interactionId.length > 0;
    for (const task of tasks) {
      if (keep && task.interactionId === interactionId) { task.playbackEpoch = playbackEpoch; continue; }
      task.invalidated = true; task.controller.abort(); finish(task, 'AUDIO_INVALIDATED');
    }
    for (const voice of [...voices]) if (!(keep && voice.interactionId === interactionId)) stopVoice(voice);
    // decodeAudioData is not cancellable: its slot and reservations remain until its Promise settles.
    if (['pack-change', 'session-change', 'dispose'].includes(reason)) { metadata.clear(); evict(0, true); }
  }
  function setPackEpoch(next) { if (next !== packEpoch) { packEpoch = next; invalidate({ reason: 'pack-change' }); } }
  function setEnabled(next) { const value = Boolean(next); if (value !== enabled) { enabled = value; if (!enabled) invalidate({ reason: 'off' }); } }
  function cacheKey(sound) { return [sound.filePackId, sound.contentRevision, sound.filePath, context.sampleRate, sound.policyVersion].join('|'); }
  function touch(key, entry) { cache.delete(key); cache.set(key, entry); }
  function checkMetadata(sound) {
    const legacyVorbis = sound?.schema === 'jsonui-sound-v1' && sound.codec === 'vorbis';
    const modernVorbis = sound?.schema === 'jsonui-sound-v2' && sound.container === 'ogg' && sound.codec === 'vorbis';
    const pcmWav = sound?.schema === 'jsonui-sound-v2' && sound.container === 'wav' && sound.codec === 'pcm_s16le';
    if ((!legacyVorbis && !modernVorbis && !pcmWav) || ![1, 2].includes(sound.channels)
      || sound.contextSampleRate !== context.sampleRate || !Number.isFinite(sound.durationSeconds) || sound.durationSeconds <= 0 || sound.durationSeconds > 10
      || !Number.isSafeInteger(sound.encodedBytes) || sound.encodedBytes < 1 || sound.encodedBytes > budget.singleEncodedBytes
      || !Number.isSafeInteger(sound.pcmReservationBytes) || sound.pcmReservationBytes < 1 || sound.pcmReservationBytes > budget.singlePcmBytes) throw failure('AUDIO_METADATA_INVALID');
    if (pcmWav) {
      if (sound.bitsPerSample !== 16 || sound.decodedFrameTolerance !== 2 || !Number.isSafeInteger(sound.sourceFrames) || sound.sourceFrames < 1
        || !Number.isInteger(sound.sampleRate) || sound.sampleRate < 8000 || sound.sampleRate > 192000
        || Math.abs(sound.durationSeconds - sound.sourceFrames / sound.sampleRate) > 1e-9
        || sound.sourceFrames * sound.channels * 2 >= sound.encodedBytes
        || sound.pcmReservationBytes < (Math.ceil(sound.sourceFrames * context.sampleRate / sound.sampleRate) + 4096) * sound.channels * 4) throw failure('AUDIO_METADATA_INVALID');
    }
  }
  function start(task, entry, sound) {
    if (!current(task)) { finish(task, 'AUDIO_INVALIDATED'); return; }
    if (task.prefetch) { finish(task, 'AUDIO_PREPARED', soundPreviewEvidence(sound)); return; }
    if (now() > task.deadline || task.reported) { finish(task, 'AUDIO_EXPIRED'); return; }
    if (context.state !== 'running') { finish(task, 'AUDIO_CONTEXT_BLOCKED'); return; }
    const rawVolume = task.soundVolume * sound.candidateVolume, volume = Math.min(1, rawVolume);
    const pitch = validNumber(task.soundPitch * sound.candidatePitch, 1, 0.5, 2, 'AUDIO_PITCH_UNSUPPORTED');
    if (volume === 0 || masterVolume === 0) { finish(task, 'AUDIO_MUTED'); return; }
    if (voices.size >= budget.voices) { finish(task, 'AUDIO_VOICE_BUDGET'); return; }
    const source = context.createBufferSource(), gain = context.createGain(), voice = { source, gain, entry, interactionId: task.interactionId, soundId:task.soundName };
    try {
      source.buffer = entry.buffer; source.playbackRate.value = pitch; gain.gain.value = volume;
      source.connect(gain); gain.connect(master); source.onended = () => { observation.append({kind:'audio-ended',interactionId:voice.interactionId,soundId:voice.soundId,contextState:context.state});releaseVoice(voice); };
      entry.refs++; voices.add(voice); source.start();
      finish(task, 'AUDIO_STARTED', { encodedBytes: sound.encodedBytes, pcmBytes: entry.bytes, candidateIndex: sound.candidateIndex, fileSource: sound.fileSource,
        ...soundPreviewEvidence(sound),
        codec: sound.codec, container: sound.container || 'ogg', filePath: sound.filePath, contentRevision: sound.contentRevision,
        sourceSampleRate: sound.sampleRate, decodedSampleRate: entry.buffer.sampleRate, decodedDurationSeconds: entry.buffer.duration,
        outputPitch: pitch, masterVolume,
        outputGain: volume, gainClamped: rawVolume > 1, ...(rawVolume > 1 ? { message: '音声の再生を開始しました。プレビューの出力音量を上限1へ制限しています。' } : {}) });
    } catch { releaseVoice(voice); try { source.disconnect(); gain.disconnect(); } catch {} throw failure('AUDIO_START_FAILED'); }
  }
  async function startWhenReady(task, entry, sound) {
    entry.refs++;
    try {
      if (!task.prefetch && context.state !== 'running' && resumePromise && current(task) && !task.reported) {
        let timer;
        try { await Promise.race([resumePromise, new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, task.deadline - now())); })]); }
        finally { clearTimeout(timer); }
      }
      start(task, entry, sound);
    } finally { releaseEntry(entry); }
  }
  async function run(task) {
    if (!current(task)) { finish(task, 'AUDIO_INVALIDATED'); return; }
    task.stage = 'resolve';
    const metaKey = task.catalogId + '|' + task.soundName + '|' + context.sampleRate;
    let sound = metadata.get(metaKey);
    if (!sound) {
      sound = await resolveSound({ catalogId: task.catalogId, soundId: task.soundName, selectionSeed: task.selectionSeed, contextSampleRate: context.sampleRate }, task.controller.signal);
      // Initial capability bootstrap creates epoch 1; it is not a server restart.
      if (sessionEpoch === 0 && getSessionEpoch() === 1) sessionEpoch = 1;
      else if (sessionEpoch !== getSessionEpoch()) { sessionEpoch = getSessionEpoch(); invalidate({ reason: 'session-change' }); }
      if (!current(task)) { finish(task, 'AUDIO_INVALIDATED'); return; }
      checkMetadata(sound);
      if (sound.candidateCount === 1) { while (metadata.size >= 128) metadata.delete(metadata.keys().next().value); metadata.set(metaKey, sound); }
    }
    checkMetadata(sound);
    observation.append({kind:'audio-resolved',interactionId:task.interactionId,soundId:task.soundName,filePath:sound.filePath,codec:sound.codec,container:sound.container,encodedBytes:sound.encodedBytes,contextState:context.state});
    validNumber(sound.candidateVolume, 1, 0, Number.MAX_VALUE, 'AUDIO_VOLUME_INVALID'); validNumber(sound.candidatePitch, 1, 0.5, 2, 'AUDIO_PITCH_UNSUPPORTED');
    validNumber(task.soundPitch * sound.candidatePitch, 1, 0.5, 2, 'AUDIO_PITCH_UNSUPPORTED');
    if (sound.candidateVolume === 0) { finish(task, 'AUDIO_MUTED'); return; }
    const key = cacheKey(sound), cached = cache.get(key);
    if (cached) { touch(key, cached); await startWhenReady(task, cached, sound); return; }
    evict(sound.pcmReservationBytes);
    if (pcmBytes + pcmReserved + sound.pcmReservationBytes > budget.pcmBytes || encodedReserved + sound.encodedBytes > budget.encodedBytes) throw failure('AUDIO_MEMORY_BUDGET');
    pcmReserved += sound.pcmReservationBytes; encodedReserved += sound.encodedBytes;
    let decodeActive = false;
    try {
      task.stage = 'fetch';
      const bytes = await readBytes(sound, task.controller.signal);
      if (!current(task)) { finish(task, 'AUDIO_INVALIDATED'); return; }
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== sound.encodedBytes) throw failure('AUDIO_BYTES_MISMATCH');
      observation.append({kind:'audio-fetched',interactionId:task.interactionId,soundId:task.soundName,encodedBytes:bytes.byteLength,contextState:context.state});
      task.stage = 'decode'; decoding++; decodeActive = true;
      let buffer;
      try { buffer = await context.decodeAudioData(bytes); } catch { throw failure('AUDIO_DECODE_FAILED'); }
      if (!current(task)) { finish(task, 'AUDIO_INVALIDATED'); return; }
      const size = buffer.length * buffer.numberOfChannels * 4;
      if (!Number.isSafeInteger(size) || size < 1 || size > sound.pcmReservationBytes || size > budget.singlePcmBytes
        || buffer.numberOfChannels !== sound.channels || buffer.sampleRate !== context.sampleRate || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 10) throw failure('AUDIO_DECODED_BUDGET');
      if (sound.codec === 'pcm_s16le' && (Math.abs(buffer.length - sound.sourceFrames * context.sampleRate / sound.sampleRate) > 2
        || Math.abs(buffer.duration - buffer.length / context.sampleRate) > 1 / context.sampleRate)) throw failure('AUDIO_DECODED_MISMATCH');
      observation.append({kind:'audio-decoded',interactionId:task.interactionId,soundId:task.soundName,decodedSampleRate:buffer.sampleRate,decodedDurationSeconds:buffer.duration,contextState:context.state});
      const entry = { buffer, bytes: size, refs: 0, key };
      // Move from reservation to retained PCM atomically before voices may acquire references.
      pcmReserved -= sound.pcmReservationBytes; pcmBytes += size; task.reservationMoved = true;
      cache.set(key, entry); task.stage = 'play'; await startWhenReady(task, entry, sound);
    } finally {
      if (decodeActive) decoding--;
      if (!task.reservationMoved) pcmReserved -= sound.pcmReservationBytes;
      encodedReserved -= sound.encodedBytes;
    }
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const task = queue.shift();
        try { await run(task); } catch (error) { finish(task, current(task) ? errorCode(error) : 'AUDIO_INVALIDATED'); }
        finally { clearTimeout(task.timer); tasks.delete(task); }
      }
    } finally { pumping = false; }
  }
  function request(intent = {}) {
    let task;
    try {
      if (intent.soundName === undefined || intent.soundName === null || intent.soundName === '') return Promise.resolve(diagnostic('AUDIO_NOT_REQUESTED'));
      if (!enabled || disposed) return Promise.resolve(diagnostic('AUDIO_DISABLED'));
      if (typeof intent.soundName !== 'string' || intent.soundName.length > 256 || /[$#\x00-\x1f\x7f]/u.test(intent.soundName)) throw failure('AUDIO_SOUND_NAME_INVALID');
      const volume = validNumber(intent.soundVolume, 1, 0, Number.MAX_VALUE, 'AUDIO_VOLUME_INVALID'), pitch = validNumber(intent.soundPitch, 1, 0.5, 2, 'AUDIO_PITCH_UNSUPPORTED');
      if (volume === 0 || masterVolume === 0) return Promise.resolve(diagnostic('AUDIO_MUTED'));
      if (typeof intent.catalogId !== 'string' || !intent.catalogId) return Promise.resolve(diagnostic('AUDIO_NODE_UNAVAILABLE'));
      const epoch = getSessionEpoch();
      if (sessionEpoch !== epoch) { sessionEpoch = epoch; invalidate({ reason: 'session-change' }); }
      if (packEpoch === undefined) packEpoch = intent.packEpoch;
      if (intent.packEpoch !== packEpoch) return Promise.resolve(diagnostic('AUDIO_INVALIDATED'));
      if (!intent.prefetch && tasks.size >= budget.requests) {
        // Unstarted background work yields its queue slot to the real click; running decode never does.
        const index = queue.findIndex(row => row.prefetch);
        if (index >= 0) {
          const [superseded] = queue.splice(index, 1); superseded.invalidated = true; superseded.controller.abort();
          finish(superseded, 'AUDIO_INVALIDATED'); tasks.delete(superseded);
        }
      }
      if (tasks.size >= budget.requests) return Promise.resolve(diagnostic('AUDIO_REQUEST_BUDGET'));
      // Prepare may construct/decode in a suspended context. Resume belongs to a real input.
      // The interactive resume call happens synchronously before run() performs Node I/O.
      if (intent.prefetch) ensureContext(); else void unlock();
      if (!context) return Promise.resolve(diagnostic('AUDIO_CONTEXT_UNAVAILABLE'));
      const created = now();
      task = { ...intent, soundVolume: volume, soundPitch: pitch, selectionSeed: String(intent.selectionSeed ?? intent.interactionId ?? ++sequence).slice(0, 256),
        interactionId: String(intent.interactionId ?? `audio-${++sequence}`).slice(0, 256), created, deadline: created + budget.startDeadlineMs,
        packEpoch, playbackEpoch, controller: new AbortController(), stage: 'queued', reported: false };
      const result = new Promise(resolve => { task.complete = resolve; });
      if (!task.prefetch) task.timer = setTimeout(() => finish(task, context?.state === 'suspended' ? 'AUDIO_CONTEXT_BLOCKED' : 'AUDIO_EXPIRED'), budget.startDeadlineMs);
      tasks.add(task);
      if (task.prefetch) queue.push(task); else { const background = queue.findIndex(row => row.prefetch); if (background < 0) queue.push(task); else queue.splice(background, 0, task); }
      void pump();
      return result;
    } catch (error) { return Promise.resolve(diagnostic(errorCode(error), task)); }
  }
  function snapshot() { return { enabled, disposed, contextState: context?.state || 'uncreated', sampleRate: context?.sampleRate || null,
    packEpoch: packEpoch ?? null, playbackEpoch, pending: tasks.size, queued: queue.length, decodeActive: decoding, voices: voices.size,
    pcmBytes, pcmReserved, encodedReserved, cachedBuffers: cache.size, limits: { ...budget }, observation:observation.snapshot() }; }
  function setMasterVolume(value) { masterVolume = validNumber(value, 0.5, 0, 1, 'AUDIO_VOLUME_INVALID'); if (master) master.gain.value = masterVolume; }
  function dispose() { if (disposed) return; disposed = true; invalidate({ reason: 'dispose' }); try { void context?.close()?.catch(() => {}); } catch {} }
  return { unlock, request, invalidate, setPackEpoch, setEnabled, setMasterVolume, snapshot, dispose,
    prepare: intents => Promise.all((Array.isArray(intents) ? intents : [intents]).slice(0, 8).map(intent => request({ ...intent, prefetch: true }))) };
}
