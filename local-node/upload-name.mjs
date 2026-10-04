/** 表示用アップロード名の境界。ディスク保存先には一切使用しない。 */
import { fail } from './limits.mjs';

export function decodeUploadName(header) {
  if (header === undefined) return 'pack.zip';
  if (typeof header !== 'string' || header.length > 4096) fail('NODE_NAME_INVALID');
  let name;
  try { name = decodeURIComponent(header); } catch { fail('NODE_NAME_INVALID'); }
  if (!name || name.length > 256 || /[\u0000-\u001f\u007f/\\]/u.test(name)) fail('NODE_NAME_INVALID');
  if (!/\.(?:zip|mcpack|mcaddon)$/iu.test(name)) fail('NODE_PACK_EXTENSION_UNSUPPORTED', 415);
  return name;
}
