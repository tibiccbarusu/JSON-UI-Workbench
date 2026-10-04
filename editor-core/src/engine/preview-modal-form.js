/** 明示したModalForm状態を公式server_formのcollectionへ変換する。I/Oなし。 */
import { createPreviewMessageResolver } from './preview-raw-message38.js';
const TYPES = new Set(['label', 'header', 'divider', 'toggle', 'slider', 'step_slider', 'dropdown', 'input']);
function fail(code, path) { const error = new Error(`${code}:${path}`); error.code = code; throw error; }
function plainText(value, fallback, path) { if (value === undefined) return fallback; if (typeof value !== 'string') fail('PREVIEW_STATE_STRING_REQUIRED', path); return value; }
function boolean(value, fallback, path) { if (value === undefined) return fallback; if (typeof value !== 'boolean') fail('PREVIEW_STATE_BOOLEAN_REQUIRED', path); return value; }
function number(value, fallback, path) { if (value === undefined) return fallback; if (typeof value !== 'number' || !Number.isFinite(value)) fail('PREVIEW_STATE_NUMBER_REQUIRED', path); return value; }
function fields(value, names, path) { for (const name of Object.keys(value)) if (!names.includes(name)) fail('PREVIEW_STATE_UNKNOWN_FIELD', `${path}.${name}`); }
function alignedStep(value) {
  // 小数の二進表現誤差だけを許容する。current 自体は丸めない。
  const tolerance = Math.min(1e-7, Number.EPSILON * 16 * Math.max(1, Math.abs(value)));
  return Math.abs(value - Math.round(value)) <= tolerance;
}
function sliderValues(entry, label, path, diagnostics, text) {
  if (entry.range === undefined) {
    if (entry.valueText !== undefined || entry.displayText !== undefined) fail('PREVIEW_STATE_SLIDER_RANGE_REQUIRED', path);
    // R36 以前の value は常に 0..1 の位置。実値へ再解釈しない。
    const value = number(entry.value, 0, `${path}.value`);
    if (value < 0 || value > 1) fail('PREVIEW_STATE_RATIO_0_1', `${path}.value`);
    return { '#custom_slider_text': label, '#custom_slider_value': value, '#custom_slider_text_value': String(value) };
  }
  if (entry.value !== undefined) fail('PREVIEW_STATE_SLIDER_VALUE_CONFLICT', path);
  const range = entry.range;
  if (!range || typeof range !== 'object' || Array.isArray(range)) fail('PREVIEW_STATE_SLIDER_RANGE', `${path}.range`);
  fields(range, ['min', 'max', 'current', 'step'], `${path}.range`);
  for (const field of ['min', 'max', 'current']) if (range[field] === undefined) fail('PREVIEW_STATE_SLIDER_RANGE_FIELD_REQUIRED', `${path}.range.${field}`);
  const min = number(range.min, undefined, `${path}.range.min`);
  const max = number(range.max, undefined, `${path}.range.max`);
  const current = number(range.current, undefined, `${path}.range.current`);
  const step = number(range.step, 1, `${path}.range.step`);
  const span = max - min;
  if (!(min < max) || !Number.isFinite(span)) fail('PREVIEW_STATE_SLIDER_RANGE', `${path}.range`);
  if (step <= 0) fail('PREVIEW_STATE_SLIDER_STEP', `${path}.range.step`);
  if (current < min || current > max) fail('PREVIEW_STATE_SLIDER_CURRENT', `${path}.range.current`);
  const stepCount = span / step;
  if (!Number.isFinite(stepCount) || stepCount === 0 || stepCount > Number.MAX_SAFE_INTEGER) fail('PREVIEW_STATE_SLIDER_STEP_PRECISION', `${path}.range.step`);
  const stepAligned = alignedStep((current - min) / step);
  const endpointAligned = alignedStep(stepCount);
  if (!stepAligned || !endpointAligned) diagnostics.push({
    code: 'PREVIEW_STATE_SLIDER_STEP_UNCONFIRMED', severity: 'warning', path,
    currentAligned: stepAligned, endpointAligned,
    message: '現在値または上端が刻み幅に一致しません。指定値を丸めず表示します。実機の丸め・端点処理は未検証です。',
  });
  const position = (current - min) / span;
  const valueText = text(entry.valueText, String(current), `${path}.valueText`);
  const displayText = text(entry.displayText, label, `${path}.displayText`);
  return {
    '#custom_slider_text': displayText, '#custom_slider_value': position, '#custom_slider_text_value': valueText,
    __jsonui_preview_slider_range: { min, max, current, step, position, valueText, displayText, label, stepAligned, endpointAligned },
  };
}
/** 入力はnormalizePreviewStateで安全なJSONとしてcopy済みであること。 */
export function normalizeModalForm(form, messageResolver = createPreviewMessageResolver()) {
  const text = (value, fallback, path) => messageResolver.resolve(value, fallback, path);
  fields(form, ['type', 'title', 'submitText', 'submitVisible', 'elements'], 'form');
  if (!Array.isArray(form.elements) || form.elements.length > 256) fail('PREVIEW_STATE_FORM_ELEMENTS', 'form.elements');
  // A deliberately supplied zero-content ModalForm is not an unspecified
  // preview state. The SHELL0 device report rejected this payload before the
  // UI tree existed. Keep raw collection inspection separate from this typed
  // form contract; callers can add a non-input label for an explanatory shell.
  if (form.elements.length === 0) fail('PREVIEW_STATE_MODAL_EMPTY_CONTENT', 'form.elements');
  const diagnostics = [];
  const rows = Array.from(form.elements, (entry, index) => {
    const path = `form.elements.${index}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !TYPES.has(entry.type)) fail('PREVIEW_STATE_FORM_ELEMENT_TYPE', path);
    const common = ['type', 'text', 'tooltip'];
    const allowed = { toggle: ['value', 'enabled'], slider: ['value', 'range', 'valueText', 'displayText', 'enabled'], step_slider: ['options', 'selected', 'enabled'], dropdown: ['options', 'selected'], input: ['value', 'placeholder', 'enabled'] };
    fields(entry, [...common, ...(allowed[entry.type] || [])], path);
    const label = text(entry.text, '', `${path}.text`);
    const row = { __jsonui_preview_factory_control_id: entry.type, '#custom_text': label, '#custom_tooltip_text': text(entry.tooltip, '', `${path}.tooltip`) };
    if (entry.type === 'toggle') Object.assign(row, { '#custom_toggle_state': boolean(entry.value, false, `${path}.value`), '#custom_toggle_enabled': boolean(entry.enabled, true, `${path}.enabled`) });
    if (entry.type === 'input') Object.assign(row, { '#custom_input_text': plainText(entry.value, '', `${path}.value`), '#custom_placeholder_text': text(entry.placeholder, '', `${path}.placeholder`), '#custom_input_enabled': boolean(entry.enabled, true, `${path}.enabled`) });
    if (entry.type === 'slider') {
      Object.assign(row, sliderValues(entry, label, path, diagnostics, text), { '#custom_slider_enabled': boolean(entry.enabled, true, `${path}.enabled`), '#custom_slider_timeout': 0 });
    }
    if (entry.type === 'step_slider' || entry.type === 'dropdown') {
      if (!Array.isArray(entry.options) || entry.options.length < 1 || entry.options.length > 256) fail('PREVIEW_STATE_FORM_OPTIONS', `${path}.options`);
      // Missing array entries must not silently disappear and renumber later
      // candidates. Visibility is a UI property, not a filtered option array.
      const options = Array.from(entry.options, (value, optionIndex) => {
        if (!Object.hasOwn(entry.options, optionIndex)) fail('PREVIEW_STATE_FORM_OPTION_MISSING', `${path}.options.${optionIndex}`);
        return text(value, '', `${path}.options.${optionIndex}`);
      });
      const selected = number(entry.selected, 0, `${path}.selected`);
      if (!Number.isInteger(selected) || selected < 0 || selected >= entry.options.length) fail('PREVIEW_STATE_FORM_SELECTION', `${path}.selected`);
      if (entry.type === 'step_slider') Object.assign(row, { '#custom_slider_step_text': label, '#custom_slider_step_value': options.length > 1 ? selected / (options.length - 1) : 0, '#custom_slider_step_text_value': options[selected], '#custom_slider_steps': Math.max(0, options.length - 1), '#custom_slider_enabled': boolean(entry.enabled, true, `${path}.enabled`), '#custom_slider_timeout': 0 });
      else Object.assign(row, { '#dropdown_option_text': options[selected], '#custom_dropdown_length': options.length, '#custom_toggle_focus_id': selected, __collections: { custom_dropdown: options.map((value, i) => ({ '#custom_radio_text': value, '#custom_radio_toggled': i === selected })) } });
    }
    return row;
  });
  return {
    mockData: { '#title_text': text(form.title, '', 'form.title'), '#custom_form_length': rows.length, '#submit_text': text(form.submitText, '送信', 'form.submitText'), '#submit_button_visible': boolean(form.submitVisible, true, 'form.submitVisible') },
    collectionData: { custom_form: rows },
    recommendedDefinition: 'server_form.custom_form',
    diagnostics: [...diagnostics, ...messageResolver.diagnostics, { code: 'PREVIEW_STATE_MODAL_DIRECT_DEFINITION', severity: 'info', message: 'server_form.custom_formを選択。指定した表示状態を再現します。ScriptAPI実行・操作後の値の送信・自動ゲームイベントは実行しません。slider.valueは従来の0〜1位置、slider.rangeは実値範囲です。数値付き見出しはdisplayTextで指定できます。' }],
  };
}
