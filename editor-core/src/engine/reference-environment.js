/* Internal immutable-by-construction lexical scopes used by catalog scanning.
 * Layers share inherited Sets; callers must never mutate an emitted scope.
 * Candidate identity and iteration order are preserved (no JSON coercion).
 */
export class ReferenceEnvironment extends Map {
  constructor(parent, changes) {
    super(changes);
    this.parent = parent;
    this.resolvedValues = new Map();
    this.resolvedPresence = new Map();
    let inheritedKeys = 0;
    for (const key of super.keys()) if (parent.has(key)) inheritedKeys += 1;
    this.scopeSize = parent.size + super.size - inheritedKeys;
  }
  get size() { return this.scopeSize; }
  has(key) {
    if (super.has(key)) return true;
    if (!this.resolvedPresence.has(key)) this.resolvedPresence.set(key, this.parent.has(key));
    return this.resolvedPresence.get(key);
  }
  get(key) {
    if (super.has(key)) return super.get(key);
    if (!this.resolvedValues.has(key)) this.resolvedValues.set(key, this.parent.get(key));
    return this.resolvedValues.get(key);
  }
}

export function sameOrderedCandidates(a, b) {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  const values = b.values();
  for (const value of a) if (!Object.is(value, values.next().value)) return false;
  return true;
}

export function createReferenceEnvironmentCache() {
  const stats = { created: 0, reused: 0, unchanged: 0 };
  return {
    stats,
    intern(parent, changes, rootEnvironment) {
      // Preserve the first authored lexical scope even when its declarations
      // equal global defaults: root identity is the existing context boundary.
      if (!changes.size && parent !== rootEnvironment) {
        stats.unchanged += 1;
        return parent;
      }
      // Exact result caching owns context equivalence. Interning every child
      // scope retained long observer chains for very few additional cache hits.
      const result = new ReferenceEnvironment(parent, changes);
      stats.created += 1;
      return result;
    },
  };
}
