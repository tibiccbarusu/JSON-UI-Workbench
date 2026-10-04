// Private fallback provenance never enters authored JSON or serialized maps.
const origins = new WeakMap();

export function copyVariableDefaultOrigins37(source, target) {
  const prior = origins.get(source);
  if (prior) origins.set(target, new Map([...prior].filter(([key]) => Object.hasOwn(target, key))));
  return target;
}

export function markVariableDefault37(scope, key, origin) {
  if (!origin) return;
  let map = origins.get(scope);
  if (!map) { map = new Map(); origins.set(scope, map); }
  map.set(key, origin);
}

export function markVariableExact37(scope, key) {
  origins.get(scope)?.delete(key);
}

export function shadowsAncestorDefault37(scope, key, origin) {
  const previous = origins.get(scope)?.get(key);
  if (!previous || !origin || previous.domain !== origin.domain || previous.kind !== origin.kind) return false;
  // Require an actual descendant. Authored inheritance is not lexical descent:
  // another base record must not displace a more-derived caller's fallback.
  const prefix = previous.pointer + (origin.kind === 'authored' ? '/controls/' : '/');
  return origin.pointer.startsWith(prefix);
}
