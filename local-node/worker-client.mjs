import { Worker } from 'node:worker_threads';
import { LIMITS, fail } from './limits.mjs';
import { sanitizeDiagnostic } from './debug-bundle.mjs';
const cancelledError = correlationId => Object.assign(new Error('NODE_JOB_CANCELLED'), {
  code: 'NODE_JOB_CANCELLED', status: 499, category: 'cancelled', retryable: false,
  ...(correlationId ? { correlation_id: correlationId } : {}),
});
const progressId = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value) ? value : null;

export class Processor {
  constructor() { this.pending = 0; this.sequence = 0; this.tail = Promise.resolve(); this.dead = false;
    this.metrics = { calls: 0, completed: 0, failed: 0, cancelled: 0, cancelled_queued: 0, cancelled_running: 0, total_queue_ms: 0, total_work_ms: 0, recent: [], caches: null };
    this.jobs = new Map(); this.admissionSequence = 0;
    this.worker = new Worker(new URL('./processor.mjs', import.meta.url), { execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 } });
    this.worker.on('error', error => { this.dead = true; this.lastFailure = sanitizeDiagnostic({ name: error?.name, message: error?.message, stack: error?.stack }).data; });
    this.worker.on('exit', () => { this.dead = true; });
  }
  call(action, payload = {}, timeout = LIMITS.jobMs, { signal, correlationId } = {}) {
    const admitted = Date.now(), deadline = admitted + timeout;
    if (signal?.aborted) return Promise.reject(cancelledError(correlationId));
    if (this.dead) return Promise.reject(new Error('NODE_PROCESSOR_RESTART_REQUIRED'));
    if (this.pending >= LIMITS.queue) return Promise.reject(Object.assign(new Error('NODE_QUEUE_FULL'), { status: 429 }));
    this.pending++; this.metrics.calls++;
    const admissionId=++this.admissionSequence;
    const job={action,admitted_at:new Date(admitted).toISOString(),started_at:null,correlation_id:correlationId||null,
      progress_id: progressId(payload?.progressId), progress: null};
    this.jobs.set(admissionId,job);
    let began = null, outcome = 'failure';
    const run = this.tail.then(() => new Promise((resolve, reject) => {
      if (this.dead) { reject(new Error('NODE_PROCESSOR_RESTART_REQUIRED')); return; }
      if (signal?.aborted) { this.metrics.cancelled_queued++; outcome = 'cancelled'; reject(cancelledError(correlationId)); return; }
      if (Date.now() >= deadline) { reject(Object.assign(new Error('NODE_QUEUE_TIMEOUT'), { status: 504 })); return; }
      const id = ++this.sequence;
      began = Date.now();
      job.started_at=new Date(began).toISOString();
      // Aborting a frame must not terminate the shared worker and discard every
      // loaded pack. Bounded synchronous work finishes; its cancelled result is
      // discarded, and the queue remains serialized until that work completes.
      let cancelled = false;
      const cancellation = action === 'workspace-preview-draft' ? new SharedArrayBuffer(4) : undefined;
      const abort = () => { if (!cancelled) { cancelled = true; this.metrics.cancelled_running++; job.cancel_requested = true;
        if (cancellation) Atomics.store(new Int32Array(cancellation), 0, 1); } };
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.worker.off('message', message); this.worker.off('error', error); this.worker.off('exit', exited); };
      const message = data => {
        if (data.id !== id) return;
        if (data.progress) { job.progress = data.progress; return; }
        cleanup(); if(data.metrics)this.metrics.caches=data.metrics;
        if(cancelled || data.error === 'NODE_JOB_CANCELLED'){outcome='cancelled';job.result_discarded=data.ok===true;reject(cancelledError(correlationId));return;}
        outcome=data.ok?'success':'failure'; if (!data.ok) this.lastFailure = data.diagnostic || { code: data.error };
        data.ok ? resolve(data.value) : reject(Object.assign(new Error(data.error), { code: data.error,
          status: data.status || 400, diagnostic: data.diagnostic,
          ...(Array.isArray(data.addonCandidates) ? { addonCandidates: data.addonCandidates } : {}),
          ...(typeof data.category === 'string' ? { category: data.category } : {}),
          ...(typeof data.retryable === 'boolean' ? { retryable: data.retryable } : {}),
          ...(correlationId ? { correlation_id: correlationId } : {}) }));
      };
      const error = err => { cleanup(); reject(err); };
      const exited = () => { cleanup(); reject(new Error('NODE_PROCESSOR_EXIT')); };
      const timer = setTimeout(async () => { cleanup(); this.dead = true; await this.worker.terminate(); reject(Object.assign(new Error('NODE_JOB_TIMEOUT'), { status: 504 })); }, Math.max(1, deadline-Date.now()));
      this.worker.on('message', message); this.worker.once('error', error); this.worker.once('exit', exited);
      signal?.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ id, action, payload, cancellation });
    })).finally(() => {
      this.pending--; this.jobs.delete(admissionId); const finished = Date.now(), queue_ms = Math.max(0,(began??finished)-admitted), work_ms = began===null?0:Math.max(0,finished-began);
      this.metrics.total_queue_ms += queue_ms; this.metrics.total_work_ms += work_ms;
      if(outcome==='success')this.metrics.completed++;else if(outcome==='cancelled')this.metrics.cancelled++;else this.metrics.failed++;
      this.metrics.recent.push({action,outcome,queue_ms,work_ms,last_progress:job.progress,
        ...(job.result_discarded ? {result_discarded:true}:{}),...(correlationId?{correlation_id:correlationId}:{})}); if(this.metrics.recent.length>100)this.metrics.recent.shift();
    });
    this.tail = run.catch(() => {});
    return run;
  }
  snapshot() { return { ...this.metrics, recent: this.metrics.recent.slice(), pending:this.pending, dead:this.dead, last_failure: this.lastFailure || null,
    active_jobs:[...this.jobs.values()].map(job=>({...job,state:job.started_at?'running':'queued',
      elapsed_ms:Math.max(0,Date.now()-Date.parse(job.admitted_at)),
      queue_ms:Math.max(0,Date.parse(job.started_at||new Date().toISOString())-Date.parse(job.admitted_at)),
      work_ms:job.started_at?Math.max(0,Date.now()-Date.parse(job.started_at)):0,
      progress_age_ms:job.progress?Math.max(0,Date.now()-Date.parse(job.progress.updated_at)):null})) }; }
  async close() { this.dead = true; await this.worker.terminate(); }
}
