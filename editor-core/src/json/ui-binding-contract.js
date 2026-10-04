/** JSON UI binding_type の共有判定。元の値を変換・破棄しない純粋ESM。 */
const TYPES = new Set(['global', 'view', 'collection', 'collection_details', 'none']);
export function classifyUiBindingType(value, present = true) {
  if (!present) return 'global';
  if (typeof value !== 'string') return 'other';
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return 'global'; // 既存の空文字列の既定動作を維持。
  if (/^[#$][A-Za-z0-9_:@.\-]+$/u.test(value.trim()) || value.trim().startsWith('(') && value.trim().endsWith(')')) return 'dynamic';
  return TYPES.has(normalized) ? normalized : 'other';
}
export function describeUiBindingType(value) {
  const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const displayValue = typeof value === 'string' ? value.slice(0, 160)
    : typeof value === 'number' ? (Number.isFinite(value) ? value : String(value))
    : typeof value === 'boolean' || value === null ? value : `[${valueType}]`;
  return { value_type: valueType, value: displayValue, value_truncated: typeof value === 'string' && value.length > 160 };
}
