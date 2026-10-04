// Shared browser/Node text projection. No DOM, filesystem, timer or network IO.
// Resource-pack relative paths such as textures/ui/slot remain readable.
export const DEBUG_SECRET_KEY = /(?:token|password|passwd|secret|authorization|cookie|credential|session[_-]?id|api[_-]?key|private[_-]?key)/iu;
export const DEBUG_OMITTED_KEY = /^(?:raw(?:text|bytes|file|payload)?|text|(?:source|file|original|base|next|replacement|override)text|filecontents?|sourcecontents?|sourcecode|overrides(?:TextByPackPath)?|iconPngBase64|image(?:Base64|Bytes)|environment|env|headers|argv)$/iu;

export function sanitizeDebugText(input, { secrets = [] } = {}) {
  let text = String(input ?? '');
  for (const secret of secrets) if (typeof secret === 'string' && secret) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/\b(?:Cookie|Set-Cookie)\s*[:=]\s*[^\r\n]*/giu, '[REDACTED_COOKIE]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/giu, '[REDACTED_AUTH]')
    .replace(/\b(?:token|password|passwd|secret|api[_-]?key|authorization|cookie)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;"']+)/giu, '[REDACTED_SECRET]')
    .replace(/https?:\/\/[^\s<>"']+/giu, (url) => {
      try {
        const parsed = new URL(url);
        parsed.username = ''; parsed.password = ''; parsed.search = ''; parsed.hash = '';
        return parsed.href;
      } catch { return '[REDACTED_URL]'; }
    })
    .replace(/(^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\r\n<>"']*/gu, '$1[LOCAL_PATH]')
    .replace(/(^|[\s("'=])\/(?:Users|home|workspace|tmp|var|private|mnt|root|opt|usr|srv|etc)(?:\/[^\s<>"']*)?/gu, '$1[LOCAL_PATH]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
}
