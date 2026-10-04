/*
  Shared parsing for fixed JSON UI control references.

  Bedrock accepts all of the following authored forms:
  - "namespace.control"
  - "@namespace.control"
  - "instance@namespace.control"
  - "local_control" (qualified against the authored namespace)

  Exact `$variable` targets are deliberately reported, not evaluated here.
  Callers own the lexical environment and must resolve every bounded static
  alternative before parsing the terminal value again.
*/

const EXACT_CONTROL_VARIABLE_RE = /^\$[A-Za-z0-9_:.\-]{1,128}$/u;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/u;
const MAX_CONTROL_SPEC_LENGTH = 512;

/**
 * Parse one JSON UI control specification without consulting runtime state.
 *
 * @param {unknown} raw
 * @param {string} [namespace]
 * @returns {{
 *   ok: true,
 *   raw: string,
 *   target: string,
 *   qualifiedName: string,
 *   localName: string|null,
 * } | {
 *   ok: false,
 *   raw: string,
 *   target: string,
 *   localName: string|null,
 *   reason: 'non-string'|'empty'|'too-long'|'control-character'|'multiple-at'|'variable'|'binding'|'expression',
 *   variable?: string,
 * }}
 */
export function parseFixedControlSpec(raw, namespace = '') {
  if (typeof raw !== 'string') {
    return {
      ok: false,
      raw: String(raw ?? ''),
      target: '',
      localName: null,
      reason: 'non-string',
    };
  }

  const text = raw.trim();
  if (!text) {
    return { ok: false, raw: text, target: '', localName: null, reason: 'empty' };
  }
  if (text.length > MAX_CONTROL_SPEC_LENGTH) {
    return { ok: false, raw: text, target: '', localName: null, reason: 'too-long' };
  }
  if (CONTROL_CHARACTER_RE.test(text)) {
    return { ok: false, raw: text, target: '', localName: null, reason: 'control-character' };
  }

  const separator = text.indexOf('@');
  const localName = separator > 0 ? text.slice(0, separator).trim() || null : null;
  const target = (separator >= 0 ? text.slice(separator + 1) : text).trim();
  if (!target) {
    return { ok: false, raw: text, target, localName, reason: 'empty' };
  }
  if (EXACT_CONTROL_VARIABLE_RE.test(target)) {
    return { ok: false, raw: text, target, localName, reason: 'variable', variable: target };
  }
  if (target.includes('@')) {
    return { ok: false, raw: text, target, localName, reason: 'multiple-at' };
  }
  if (target.startsWith('$') || target.startsWith('#')) {
    return {
      ok: false,
      raw: text,
      target,
      localName,
      reason: target.startsWith('#') ? 'binding' : 'expression',
    };
  }
  if (target.startsWith('(') || target.endsWith(')')) {
    return { ok: false, raw: text, target, localName, reason: 'expression' };
  }

  const authoredNamespace = String(namespace || '').trim();
  const qualifiedName = target.includes('.') || !authoredNamespace
    ? target
    : `${authoredNamespace}.${target}`;
  return {
    ok: true,
    raw: text,
    target,
    qualifiedName,
    localName,
  };
}

