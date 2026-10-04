import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiAudioPlayer } from '../src/preview/ui-audio-player.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const intent = (id = 'one') => ({ soundName: 'random.click', interactionId: id, catalogId: 'catalog', packEpoch: 1, soundVolume: 1, soundPitch: 1 });
const meta = (extra = {}) => ({ schema: 'jsonui-sound-v1', codec: 'vorbis', channels: 1, contextSampleRate: 48000, durationSeconds: 0.12,
  encodedBytes: 100, pcmReservationBytes: 40000, filePackId: 'pack', contentRevision: 'hash', filePath: 'sounds/click.ogg', policyVersion: 'test',
  candidateVolume: 1, candidatePitch: 1, candidateCount: 1, candidateIndex: 0, ...extra });
const buffer = () => ({ length: 5760, numberOfChannels: 1, sampleRate: 48000, duration: 0.12 });
function fixture(options = {}) {
  const calls = { resolve: 0, read: 0, decode: 0, resume: 0, starts: [], stops: 0 }, diagnostics = [];
  const context = { state: 'running', sampleRate: 48000, destination: {},
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource: () => ({ playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() { calls.starts.push(this); }, stop() { calls.stops++; this.onended?.(); } }),
    resume() { calls.resume++; this.state = 'running'; return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); },
    decodeAudioData() { calls.decode++; return Promise.resolve(buffer()); }, ...options.context };
  const player = createUiAudioPlayer({ createContext: () => context,
    resolveSound: async () => { calls.resolve++; return meta(); }, readBytes: async () => { calls.read++; return new ArrayBuffer(100); },
    getSessionEpoch: () => 1, onDiagnostic: row => diagnostics.push(row), ...options.player });
  return { player, calls, diagnostics, context };
}
test('prepared audio starts from cache with scalar volume/pitch, voices release independently', async () => {
  const { player, calls } = fixture();
  assert.equal((await player.prepare(intent()))[0].code, 'AUDIO_PREPARED'); assert.equal(calls.starts.length, 0);
  assert.equal((await player.request({ ...intent(), soundVolume: 0.4, soundPitch: 1.5 })).code, 'AUDIO_STARTED');
  assert.equal(calls.resolve, 1); assert.equal(calls.read, 1); assert.equal(calls.decode, 1); assert.equal(calls.starts[0].playbackRate.value, 1.5);
  assert.equal(player.snapshot().voices, 1); calls.starts[0].onended(); assert.equal(player.snapshot().voices, 0);
  assert.equal(player.snapshot().pcmBytes, 23040); player.dispose(); assert.equal(player.snapshot().pcmBytes, 0);
});
test('zero volume is preserved and never creates context, fetches or decodes', async () => {
  let contexts = 0; const { player, calls } = fixture({ player: { createContext: () => { contexts++; throw new Error(); } } });
  assert.equal((await player.request({ ...intent(), soundVolume: 0 })).code, 'AUDIO_MUTED');
  assert.equal(contexts, 0); assert.equal(calls.resolve, 0); assert.equal(calls.decode, 0);
  assert.equal((await player.request({ ...intent(), soundPitch: 0 })).code, 'AUDIO_PITCH_UNSUPPORTED');
});
test('authored volume 4 is accepted, candidate volume is composed, and only final voice output is clamped', async () => {
  const normal = fixture(); const result = await normal.player.request({ ...intent(), soundVolume: 4 });
  assert.equal(result.code, 'AUDIO_STARTED'); assert.equal(result.outputGain, 1); assert.equal(result.gainClamped, true); normal.player.dispose();
  const reduced = fixture({ player: { resolveSound: async () => meta({ candidateVolume: 0.1 }) } });
  const scaled = await reduced.player.request({ ...intent(), soundVolume: 4 });
  assert.equal(scaled.code, 'AUDIO_STARTED'); assert.equal(scaled.outputGain, 0.4); assert.equal(scaled.gainClamped, false); reduced.player.dispose();
  const large = fixture({ player: { resolveSound: async () => meta({ candidateVolume: Number.MAX_VALUE }) } });
  const capped = await large.player.request({ ...intent(), soundVolume: Number.MAX_VALUE });
  assert.equal(capped.outputGain, 1); assert.equal(capped.code, 'AUDIO_STARTED'); large.player.dispose();
  const invalid = fixture(); for (const volume of [-1, Infinity, NaN, '4']) assert.equal((await invalid.player.request({ ...intent(), soundVolume: volume })).code, 'AUDIO_VOLUME_INVALID'); invalid.player.dispose();
});
test('resume is invoked synchronously before metadata I/O and synthetic unlock is ignored', async () => {
  const order = [], { player, context } = fixture({ context: { state: 'suspended', resume() { order.push('resume'); this.state = 'running'; return Promise.resolve(); } },
    player: { resolveSound: async () => { order.push('resolve'); return meta(); } } });
  await player.unlock({ isTrusted: false }); assert.deepEqual(order, []);
  const request = player.request(intent()); assert.deepEqual(order, ['resume', 'resolve']); assert.equal(context.state, 'running');
  assert.equal((await request).code, 'AUDIO_STARTED'); player.dispose();
});
test('prepare decodes in a suspended context without requesting resume or producing sound', async () => {
  const { player, calls, context } = fixture({ context: { state: 'suspended' } });
  assert.equal((await player.prepare(intent()))[0].code, 'AUDIO_PREPARED');
  assert.equal(context.state, 'suspended'); assert.equal(calls.resume, 0); assert.equal(calls.starts.length, 0); assert.equal(calls.decode, 1);
  assert.equal((await player.request(intent('clicked'))).code, 'AUDIO_STARTED'); assert.equal(calls.resume, 1); player.dispose();
});
test('same-interaction close/navigation retains pending click; unrelated navigation stops old voice', async () => {
  const hold = deferred(), { player, calls } = fixture({ player: { resolveSound: () => hold.promise } });
  const requested = player.request(intent()); player.invalidate({ reason: 'close', interactionId: 'one' }); player.invalidate({ reason: 'navigation', interactionId: 'one' });
  hold.resolve(meta()); assert.equal((await requested).code, 'AUDIO_STARTED'); assert.equal(calls.starts.length, 1);
  player.invalidate({ reason: 'navigation', interactionId: 'different' }); assert.equal(calls.stops, 1); assert.equal(player.snapshot().voices, 0); player.dispose();
});
test('OFF during native decode keeps slot and reservations until actual settlement; stale PCM is discarded', async t => {
  // This case orders OFF before the 300ms deadline; scheduler load must not
  // change that precondition. Freeze both the timer and the injected clock.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const decode = deferred(), { player, calls } = fixture({ context: { decodeAudioData() { calls.decode++; return decode.promise; } }, player: { now: () => 0 } });
  t.after(() => { player.dispose(); decode.resolve(buffer()); });
  const requested = player.request(intent()); await turn(); assert.equal(player.snapshot().decodeActive, 1); assert.equal(player.snapshot().pcmReserved, 40000);
  player.setEnabled(false); assert.equal((await requested).code, 'AUDIO_INVALIDATED'); assert.equal(player.snapshot().decodeActive, 1); assert.equal(player.snapshot().encodedReserved, 100);
  player.setEnabled(true); const newer = player.request(intent('two')); await turn(); assert.equal(calls.decode, 1); assert.equal(player.snapshot().queued, 1);
  decode.resolve(buffer()); assert.equal((await newer).code, 'AUDIO_STARTED'); await turn();
  assert.equal(calls.decode, 2); assert.equal(calls.starts.length, 1); assert.equal(player.snapshot().decodeActive, 0); assert.equal(player.snapshot().pcmReserved, 0); player.dispose();
});
test('deadline before OFF reports expiry once, then discards late PCM and releases reservations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const decode = deferred(); let time = 0, outcome = null;
  const { player, calls, diagnostics } = fixture({ context: { decodeAudioData: () => decode.promise }, player: { now: () => time } });
  t.after(() => { player.dispose(); decode.resolve(buffer()); });
  assert.equal(player.snapshot().limits.startDeadlineMs, 300);
  const requested = player.request(intent()).then(result => { outcome = result; return result; });
  await turn(); assert.equal(player.snapshot().decodeActive, 1);
  time = 299; t.mock.timers.tick(299); await Promise.resolve(); assert.equal(outcome, null);
  time = 300; t.mock.timers.tick(1);
  assert.equal((await requested).code, 'AUDIO_EXPIRED'); assert.equal(calls.starts.length, 0);
  player.setEnabled(false); assert.equal(outcome.code, 'AUDIO_EXPIRED', 'settled request retains the earlier deadline result');
  assert(diagnostics.some(row => row.code === 'AUDIO_INVALIDATED' && row.preparationAfterDeadline === true));
  assert.equal(player.snapshot().decodeActive, 1); assert.equal(player.snapshot().pcmReserved, 40000); assert.equal(player.snapshot().encodedReserved, 100);
  decode.resolve(buffer()); await turn();
  assert.equal(calls.starts.length, 0); assert.equal(player.snapshot().decodeActive, 0);
  assert.equal(player.snapshot().pcmReserved, 0); assert.equal(player.snapshot().encodedReserved, 0);
  assert.equal(player.snapshot().pcmBytes, 0); assert.equal(player.snapshot().cachedBuffers, 0);
});
test('pack change aborts fetch and invalidates its sound; failed audio Promise never rejects', async () => {
  const read = deferred(); let readSignal;
  const { player, calls } = fixture({ player: { readBytes: (_sound, signal) => { readSignal = signal; return read.promise; } } });
  const requested = player.request(intent()); await turn(); player.setPackEpoch(2); assert(readSignal.aborted); assert.equal((await requested).code, 'AUDIO_INVALIDATED');
  assert.equal(player.snapshot().pcmReserved, 40000); read.resolve(new ArrayBuffer(100)); await turn();
  assert.equal(calls.decode, 0); assert.equal(player.snapshot().pcmReserved, 0); assert.equal((await player.request(intent())).code, 'AUDIO_INVALIDATED'); player.dispose();
});
test('late decode never starts old click but prepares cache for the next interaction', async () => {
  const decode = deferred(); let time = 0;
  const { player, calls } = fixture({ context: { decodeAudioData: () => decode.promise }, player: { now: () => time } });
  const requested = player.request(intent()); await turn(); time = 301; decode.resolve(buffer());
  assert.equal((await requested).code, 'AUDIO_EXPIRED'); assert.equal(calls.starts.length, 0); assert.equal(player.snapshot().cachedBuffers, 1);
  assert.equal((await player.request(intent('next'))).code, 'AUDIO_STARTED'); player.dispose();
});
test('voice, pending and PCM admission budgets stay bounded and pinned buffers are not evicted', async () => {
  const { player } = fixture({ player: { limits: { voices: 1, pcmBytes: 50000 }, resolveSound: async data => meta({ contentRevision: data.soundId }) } });
  assert.equal((await player.request(intent())).code, 'AUDIO_STARTED');
  assert.equal((await player.request(intent('two'))).code, 'AUDIO_VOICE_BUDGET');
  assert.equal((await player.request({ ...intent('three'), soundName: 'second.sound' })).code, 'AUDIO_MEMORY_BUDGET');
  assert.equal(player.snapshot().pcmBytes, 23040); assert.equal(player.snapshot().pcmReserved, 0); player.dispose();
  const hold = deferred(), queued = fixture({ player: { limits: { requests: 1 }, resolveSound: () => hold.promise } });
  const first = queued.player.request(intent()); assert.equal((await queued.player.request(intent('two'))).code, 'AUDIO_REQUEST_BUDGET');
  queued.player.dispose(); hold.resolve(meta()); await first; await turn(); assert.equal(queued.player.snapshot().pending, 0);
});
test('decoded dimensions are rechecked and rejected bytes never reach retained cache', async () => {
  const { player } = fixture({ context: { decodeAudioData: async () => ({ ...buffer(), length: 1000000, duration: 20 }) } });
  assert.equal((await player.request(intent())).code, 'AUDIO_DECODED_BUDGET'); await turn();
  assert.equal(player.snapshot().pcmBytes, 0); assert.equal(player.snapshot().pcmReserved, 0); assert.equal(player.snapshot().encodedReserved, 0); player.dispose();
});
test('session restart invalidates cached sound and pending decode result', async () => {
  let epoch = 1; const { player, calls } = fixture({ player: { getSessionEpoch: () => epoch } });
  await player.prepare(intent()); epoch = 3; await player.request(intent('next')); assert.equal(calls.read, 2); player.dispose();
  const decode = deferred(); epoch = 1;
  const pending = fixture({ context: { decodeAudioData: () => decode.promise }, player: { getSessionEpoch: () => epoch } });
  const old = pending.player.request(intent()); await turn(); epoch = 3; decode.resolve(buffer());
  assert.equal((await old).code, 'AUDIO_INVALIDATED'); assert.equal(pending.calls.starts.length, 0); pending.player.dispose();
});
test('pack clear while awaiting activation retains PCM accounting until the waiting owner releases it', async () => {
  const resume = deferred(), { player } = fixture({ context: { state: 'suspended', resume: () => resume.promise } });
  const requested = player.request(intent()); await turn();
  assert.equal(player.snapshot().pcmBytes, 23040); player.setPackEpoch(2);
  assert.equal((await requested).code, 'AUDIO_INVALIDATED'); assert.equal(player.snapshot().pcmBytes, 23040);
  resume.resolve(); await turn(); assert.equal(player.snapshot().pcmBytes, 0); assert.equal(player.snapshot().pcmReserved, 0); player.dispose();
});
test('interactive request takes an unstarted prefetch slot and runs before remaining background work', async () => {
  const decode = deferred(), { player, calls } = fixture({ context: { decodeAudioData: () => decode.promise } });
  const prepared = player.prepare(Array.from({ length: 8 }, (_, index) => ({ ...intent(`prepare${index}`), soundName: `sound${index}` })));
  await turn(); assert.equal(player.snapshot().pending, 8); assert.equal(player.snapshot().decodeActive, 1);
  const clicked = player.request({ ...intent('click'), soundName: 'sound0' });
  assert.equal(player.snapshot().pending, 8); assert.equal(player.snapshot().decodeActive, 1);
  decode.resolve(buffer()); assert.equal((await clicked).code, 'AUDIO_STARTED');
  const results = await prepared; assert.equal(results.filter(result => result.code === 'AUDIO_INVALIDATED').length, 1);
  assert.equal(calls.starts.length, 1); player.dispose();
});
