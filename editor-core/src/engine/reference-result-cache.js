import { sameOrderedCandidates } from './reference-environment.js';

// This wrapper observes only reads from the incoming lexical scope. Reads of
// values introduced inside a template stop at its immutable child layers.
export class ObservedReferenceEnvironment extends Map {
  constructor(parent, reads) { super(); this.parent = parent; this.reads = reads; }
  get size() { return this.parent.size; }
  has(name) {
    const exists = this.parent.has(name);
    if (!this.reads.has(name)) this.reads.set(name, { exists, read: false });
    return exists;
  }
  get(name) {
    const exists = this.parent.has(name), value = this.parent.get(name);
    this.reads.set(name, { exists, read: true, value });
    return value;
  }
}

export function createReferenceResultCache(limits) {
  const entries = new Map();
  // Caching is optional: exhausting either optimization budget resumes the
  // original bounded evaluation. It never marks an unscanned record complete.
  const maxEntries = Math.min(limits.maxDefinitions, 10_000);
  const maxChecks = limits.maxReferenceNodesTotal * 8;
  const maxRetainedMembers = limits.maxReferenceNodesTotal * 4;
  const stats = { entries: 0, hits: 0, checks: 0, bypassed: 0, retainedMembers: 0, storageBypassed: 0 };
  return {
    stats,
    find(targetId, environment, stack, depth) {
      if (stats.checks >= maxChecks) { stats.bypassed += 1; return null; }
      for (const entry of entries.get(targetId) || []) {
        if (stats.checks >= maxChecks) { stats.bypassed += 1; return null; }
        stats.checks += 1;
        if (environment.size + entry.maxScopeDelta > limits.maxReferenceVariablesPerScope
          || depth + entry.relativeDepth > limits.maxScanDepth) continue;
        let match = true;
        // Lexical mismatches are common across reused Vanilla templates.
        // Reject those before walking the caller ancestry, while retaining
        // every ancestry/depth/storage guard before accepting a replay.
        for (const [name, expected] of entry.reads) {
          stats.checks += 1;
          if (stats.checks >= maxChecks) { stats.bypassed += 1; return null; }
          if (environment.has(name) !== expected.exists
            || (expected.read && !sameOrderedCandidates(environment.get(name), expected.value))) { match = false; break; }
        }
        if (!match) continue;
        // The current ancestor path is usually much smaller than a template's
        // transitive closure; intersect from that side without array copies.
        for (const id of stack) {
          if (stats.checks >= maxChecks) { stats.bypassed += 1; return null; }
          stats.checks += 1;
          if (entry.visited.has(id)) { match = false; break; }
        }
        if (!match) continue;
        for (const id of entry.requiredAncestors) {
          if (stats.checks >= maxChecks) { stats.bypassed += 1; return null; }
          stats.checks += 1;
          if (!stack.has(id)) { match = false; break; }
        }
        if (!match) continue;
        if (match) {
          // Reserve the finite cost of replay before accepting the hit.
          if (stats.checks + entry.references.size > maxChecks) { stats.bypassed += 1; return null; }
          stats.checks += entry.references.size;
          stats.hits += 1;
          return entry;
        }
      }
      return null;
    },
    store(targetId, entry) {
      if (stats.entries >= maxEntries || stats.checks >= maxChecks) return;
      const alternatives = entries.get(targetId) || [];
      if (alternatives.length >= Math.min(limits.maxReferenceAlternatives, 8)) return;
      // Count retained collection slots, not bytes. This bounds the optional
      // transitive closure cache even when each entry has many dependencies.
      // A storage miss changes only performance: the normal scan still runs.
      const members = 1 + entry.reads.size + entry.references.size + entry.visited.size + entry.requiredAncestors.size;
      if (stats.retainedMembers + members > maxRetainedMembers) {
        stats.storageBypassed += 1;
        return;
      }
      alternatives.push({ reads: entry.reads, references: entry.references, visited: entry.visited,
        requiredAncestors: entry.requiredAncestors, relativeDepth: entry.relativeDepth, maxScopeDelta: entry.maxScopeDelta });
      entries.set(targetId, alternatives);
      stats.entries += 1;
      stats.retainedMembers += members;
    },
  };
}
