import { siteText, translateSiteMessage } from '../i18n/site-messages.js';
import { normalizeHorsePreviewState, normalizeNativePreviewCamera } from '../preview/native-model-preview.js';

export const DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS = Object.freeze({
  previewState: normalizeHorsePreviewState(),
  camera: normalizeNativePreviewCamera(),
  bookOpeningDegrees: 130,
});

/** Convert DOM field values into an immutable request snapshot. Invalid input
 * is rejected, so an empty field never silently resets an existing condition.
 */
export function parseNativeModelPreviewFields(fields) {
  const number = (key) => typeof fields?.[key] === 'number'
    ? fields[key]
    : typeof fields?.[key] === 'string' && fields[key].trim() ? Number(fields[key]) : NaN;
  const previewState = normalizeHorsePreviewState({
    variant: number('variant'), markVariant: number('markVariant'),
    armorVariant: fields?.armorVariant === undefined ? 0 : number('armorVariant'),
    isSaddled: fields?.isSaddled, hasRider: fields?.hasRider,
  });
  if (!previewState) return { ok: false, error: siteText('毛色・模様・馬鎧は0〜31の整数を指定してください。') };
  const camera = normalizeNativePreviewCamera({ yaw: number('yaw'), pitch: number('pitch') });
  if (!camera) return { ok: false, error: siteText('左右の角度は−180〜180度、上下の角度は−89〜89度で指定してください。') };
  const bookOpeningDegrees = number('bookOpeningDegrees');
  if (!Number.isFinite(bookOpeningDegrees) || bookOpeningDegrees < 20 || bookOpeningDegrees > 180) {
    return { ok: false, error: siteText('本の開き角度は20〜180度で指定してください。') };
  }
  return { ok: true, options: Object.freeze({ previewState, camera, bookOpeningDegrees }) };
}

/** Draft form values are separate from the applied request snapshot. */
export function nativeModelPreviewFields(options = DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS) {
  return { ...options.previewState, ...options.camera, bookOpeningDegrees: options.bookOpeningDegrees };
}

/** The book uses a separate synchronous scene and does not invalidate horse IO. */
export function horsePreviewOptionsKey(options) {
  const { previewState, camera } = options;
  return JSON.stringify([previewState.variant, previewState.markVariant, previewState.armorVariant ?? 0, previewState.isSaddled, previewState.hasRider, camera.yaw, camera.pitch]);
}

export function nativeModelPreviewStatusText(snapshot) {
  if (snapshot?.status === 'ready') return siteText('馬の静止モデルを読み込みました。');
  if (snapshot?.status === 'loading') return siteText('選択した条件で馬のモデルを読み込み中…');
  if (snapshot?.issue === 'NATIVE_PREVIEW_VARIANT_OUT_OF_RANGE') return siteText('このパックには指定した毛色・模様番号がありません。別の番号を選んでください。');
  if (snapshot?.issue === 'NATIVE_PREVIEW_ARMOR_OUT_OF_RANGE') return siteText('このパックには指定した馬鎧番号がありません。別の番号を選んでください。');
  if (snapshot?.issue === 'NATIVE_PREVIEW_ARMOR_MATERIAL_UNSUPPORTED') return siteText('この馬鎧は染色または独自の材質処理が必要で、現在は表示できません。別の馬鎧番号を選んでください。');
  if (snapshot?.status === 'invalid' || snapshot?.status === 'missing') return siteText`馬の表示に必要な素材または定義を読み込めませんでした。ログ・参照を確認してください。${snapshot.issue ? ` (${snapshot.issue})` : ''}`;
  return siteText('馬の表示条件は「適用」で反映します。');
}

/** Compact browser form. Editing fields performs no network or Canvas work;
 * Apply passes one validated immutable snapshot to the application.
 */
export function renderNativeModelSettings(h, { options, uiState, usesHorse, usesBook, snapshot, onApply }) {
  if (!usesHorse && !usesBook) return '';
  if (!uiState.draft) uiState.draft = nativeModelPreviewFields(options);
  const feedback = h('div', { class: 'native-model-settings-error', role: 'alert' }, [translateSiteMessage(uiState.error) || '']);
  function field(key, label, minimum, maximum, step = '1') {
    return h('label', { class: 'native-model-field', for: `native-model-${key}` }, [
      h('span', {}, [label]),
      h('input', {
        id: `native-model-${key}`, type: 'number', min: String(minimum), max: String(maximum), step,
        required: 'required', value: uiState.draft[key],
        onInput: (event) => { uiState.draft[key] = event.currentTarget.value; },
      }),
    ]);
  }
  function checkbox(key, label) {
    return h('label', { class: 'native-model-check' }, [
      h('input', { id: `native-model-${key}`, type: 'checkbox', checked: uiState.draft[key], onChange: (event) => { uiState.draft[key] = event.currentTarget.checked; } }),
      label,
    ]);
  }
  function applyFields(fields) {
    const result = parseNativeModelPreviewFields(fields);
    uiState.error = result.ok ? '' : result.error;
    feedback.textContent = translateSiteMessage(uiState.error);
    if (!result.ok) return;
    uiState.open = true;
    uiState.draft = nativeModelPreviewFields(result.options);
    onApply(result.options);
  }
  return h('details', {
    class: 'native-model-settings', open: uiState.open,
    onToggle: (event) => { if (event.currentTarget.isConnected) uiState.open = event.currentTarget.open; },
  }, [
    h('summary', {}, [siteText('3Dの表示条件（静止）')]),
    h('form', { class: 'native-model-settings-form', onSubmit: (event) => { event.preventDefault(); applyFields(uiState.draft); } }, [
      h('p', { class: 'hint' }, [siteText('プレビュー内の表示条件です。ゲーム本体との状態同期は行いません。')]),
      usesHorse ? h('div', { class: 'native-model-horse-fields' }, [
        h('div', { class: 'native-model-fields' }, [
          field('variant', siteText('毛色番号'), 0, 31), field('markVariant', siteText('模様番号'), 0, 31),
          field('armorVariant', siteText('馬鎧番号（0：なし）'), 0, 31),
          field('yaw', siteText('左右の角度（度）'), -180, 180, 'any'), field('pitch', siteText('上下の角度（度）'), -89, 89, 'any'),
        ]),
        h('div', { class: 'native-model-checks' }, [checkbox('isSaddled', siteText('鞍あり')), checkbox('hasRider', siteText('騎乗者あり（手綱の条件）'))]),
        h('p', { class: 'hint' }, [siteText('番号と見た目の対応はパックで異なります。「騎乗者あり」は人のモデルを表示する設定ではありません。')]),
        h('p', { class: 'hint' }, [siteText('馬鎧はパックの配列順で選びます。鉄・金・ダイヤモンド・銅・ネザライトの無染色テクスチャを重ねた近似表示です。革の染色と独自材質は未対応です。')]),
        h('div', { class: 'native-model-presets' }, [
          h('span', { class: 'hint' }, [siteText('視点:')]),
          h('button', { type: 'button', class: 'btn btn-small', onClick: () => applyFields({ ...uiState.draft, yaw: 148, pitch: 18 }) }, [siteText('前方から')]),
          h('button', { type: 'button', class: 'btn btn-small', onClick: () => applyFields({ ...uiState.draft, yaw: -32, pitch: 18 }) }, [siteText('既定の向き')]),
        ]),
        h('div', { id: 'native-model-load-status', class: 'native-model-status', role: 'status' }, [nativeModelPreviewStatusText(snapshot)]),
      ]) : '',
      usesBook ? h('div', { class: 'native-model-book-fields' }, [
        field('bookOpeningDegrees', siteText('本を開いたときの角度（度）'), 20, 180, 'any'),
        h('p', { class: 'hint' }, [siteText('対象スロットが空なら本は閉じ、対象物を置くと開きます。この角度は開いているときに適用されます。形状と角度は実機画像に基づく近似です。')]),
      ]) : '',
      feedback,
      h('div', { class: 'native-model-actions' }, [
        h('button', { type: 'submit', class: 'btn btn-primary', id: 'native-model-apply' }, [siteText('表示条件を適用')]),
        h('button', { type: 'button', class: 'btn', onClick: () => applyFields(nativeModelPreviewFields()) }, [siteText('初期値に戻す')]),
      ]),
    ]),
  ]);
}
