/** 原UIの画面/action/collection契約に限定した、I/Oを持たないプレビュー用動作。 */
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const note = (code, message) => ({ code, severity: 'info', message });
const applied = (effects, message) => ({ status: 'applied', effects, diagnostics: [note('INTERACTION_PREVIEW_SIMULATED', message)], evidence: 'preview-simulated' });
const blocked = (code, message) => ({ status: 'blocked', effects: [], diagnostics: [note(code, message)] });
const unavailable = (code, message) => ({ status: 'unsupported', effects: [], diagnostics: [note(code, message)] });
const BOOK_ACTIONS = new Set(['button.prev_page','button.next_page','button.swap_page_left','button.swap_page_right','button.insert_text_page','button.delete_page']);
const BOOK_CORPUS = '__jsonui_preview_book_pages';
const BOOK_SPREAD = '__jsonui_preview_book_spread';

function bookAction({ action, collectionData = {}, mockData = {}, collectionAddress }) {
  const visible = own(collectionData, 'book_pages'), stored = own(collectionData, BOOK_CORPUS);
  const spread = own(mockData, BOOK_SPREAD) ?? 0;
  if (!Array.isArray(visible) || !visible.length || visible.length > 256 || visible.some(row => !record(row)) || !Number.isInteger(spread) || spread < 0 || spread > 127) return blocked('INTERACTION_BOOK_PAGES_REQUIRED', '本のページ一覧と表示位置を確認できません。');
  if (stored !== undefined && (!Array.isArray(stored) || !stored.length || stored.length > 256 || stored.some(row => !record(row)))) return blocked('INTERACTION_BOOK_PAGES_REQUIRED', '保持した本のページ一覧が不正です。');
  const pages = (stored ?? visible).map(row => ({ ...row }));
  if (spread * 2 >= pages.length) return blocked('INTERACTION_BOOK_PAGE_STALE', '表示ページが保持ページの範囲外です。状態JSONを確認してください。');
  // 入力欄・ペンの直近編集を、現在表示している見開きへだけ取り込む。
  if (stored) for (let i = 0; i < Math.min(2, visible.length); i += 1) if (pages[spread * 2 + i] && visible[i]['#page_visible'] !== false) pages[spread * 2 + i] = { ...visible[i] };
  let nextSpread = spread;
  if (action === 'button.next_page' || action === 'button.prev_page') {
    nextSpread += action === 'button.next_page' ? 1 : -1;
    if (nextSpread < 0 || nextSpread * 2 >= pages.length) return blocked('INTERACTION_BOOK_PAGE_BOUNDARY', 'これ以上ページを移動できません。');
  } else {
    if (mockData['#editable'] === false) return blocked('INTERACTION_BOOK_READONLY', 'この本は読み取り専用です。');
    const index = collectionAddress?.collection === 'book_pages' && Number.isInteger(collectionAddress.index) && collectionAddress.index >= 0 && collectionAddress.index < 2 ? spread * 2 + collectionAddress.index : -1;
    if (index < 0 || !pages[index] || visible[collectionAddress.index]?.['#page_visible'] === false) return blocked('INTERACTION_COLLECTION_ADDRESS_REQUIRED', '編集対象の表示ページを確認できません。');
    if (pages[index]['#editable'] === false) return blocked('INTERACTION_BOOK_READONLY', 'このページは読み取り専用です。');
    if (action === 'button.insert_text_page') {
      if (pages.length >= 256) return blocked('INTERACTION_BOOK_PAGE_LIMIT', 'プレビューの上限256ページに達しています。');
      pages.splice(index + 1, 0, { '#text_box_item_name': '', '#is_text_page': true, '#is_photo_page': false, '#editable': true, '#edit_controls_active': false, '#edit_button_active': true });
    } else if (action === 'button.delete_page') {
      if (pages.length <= 1) return blocked('INTERACTION_BOOK_LAST_PAGE', '最後の1ページは削除できません。');
      pages.splice(index, 1); nextSpread = Math.min(spread, Math.floor((pages.length - 1) / 2));
    } else {
      const destination = index + (action === 'button.swap_page_left' ? -1 : 1);
      if (!pages[destination]) return blocked('INTERACTION_BOOK_PAGE_BOUNDARY', 'ページの交換先がありません。');
      [pages[index], pages[destination]] = [pages[destination], pages[index]];
    }
  }
  const normalized = pages.map((row, index) => {
    const editable = mockData['#editable'] !== false && row['#editable'] !== false;
    return { ...row, '#page_visible': true, '#page_number': `${index + 1} / ${pages.length}`, '#swap_left_active': editable && index > 0, '#swap_right_active': editable && index + 1 < pages.length, '#insert_page_active': editable && pages.length < 256 };
  });
  const window = normalized.slice(nextSpread * 2, nextSpread * 2 + 2);
  if (window.length < 2) window.push({ '#page_visible': false, '#editable': false, '#text_box_item_name': '' });
  return applied([
    { type: 'collectionPatch', patch: { book_pages: window, [BOOK_CORPUS]: normalized } },
    { type: 'mockPatch', patch: { [BOOK_SPREAD]: nextSpread, '#prev_page_button_active': nextSpread > 0, '#next_page_button_active': (nextSpread + 1) * 2 < pages.length } },
  ], `本のプレビューを${nextSpread * 2 + 1}ページ目から表示しました（全${pages.length}ページ）。ページ編集・並び順はプレビュー状態だけに反映します。`);
}

function formAction({ action, collectionData = {}, collectionAddress, screenDefinition }) {
  if (action === 'button.form_button_click') {
    const rows = own(collectionData, 'form_buttons'), index = collectionAddress?.collection === 'form_buttons' ? collectionAddress.index : -1;
    if (!Array.isArray(rows) || rows.length > 256 || !Number.isInteger(index) || index < 0 || !record(rows[index])) return blocked('INTERACTION_FORM_ROW_REQUIRED', '選択したform_buttonsの行を確認できません。');
    const row = rows[index];
    if (typeof row['#form_button_text'] !== 'string' || row.__jsonui_preview_factory_control_id && row.__jsonui_preview_factory_control_id !== 'button') return unavailable('INTERACTION_FORM_DATA_SOURCE_UNCONFIRMED', 'この行をフォームのボタンデータとして確認できません。');
    return applied([{ type: 'mockPatch', patch: { __jsonui_preview_form_response: { screenDefinition, action, selection: index, text: row['#form_button_text'] } } }], `フォームの${index + 1}番「${row['#form_button_text'].slice(0, 160)}」をプレビューで選択しました。選択結果を状態JSONへ記録しました。サーバーへの送信・次フォームの受信は行いません。`);
  }
  if (action === 'button.submit_custom_form') {
    const rows = own(collectionData, 'custom_form');
    if (!Array.isArray(rows) || rows.length > 256 || rows.some(row => !record(row))) return blocked('INTERACTION_FORM_DATA_REQUIRED', '確定するcustom_formの入力データがありません。');
    const fields = ['#custom_toggle_state','#custom_input_text','#custom_slider_value','#custom_slider_step_value','#dropdown_option_text'];
    const values = rows.map(row => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key) && ['string','boolean','number'].includes(typeof row[key])).map(key => [key, row[key]])));
    return applied([{ type: 'mockPatch', patch: { __jsonui_preview_form_response: { screenDefinition, action, values } } }], 'フォームの現在の入力値をプレビュー状態JSONへ記録しました。サーバー送信・ゲーム設定変更は行いません。');
  }
  return null;
}

function selectorAction(options, collection, textureBinding) {
  const { collectionData = {}, collectionAddress } = options;
  const rows = own(collectionData, collection), index = collectionAddress?.collection === collection ? collectionAddress.index : -1;
  if (!Array.isArray(rows) || rows.length > 256 || !Number.isInteger(index) || index < 0 || !rows[index] || rows.some(row => !record(row) || typeof row[textureBinding] !== 'string')) return blocked('INTERACTION_SELECTOR_DATA_REQUIRED', `${collection}の選択行と背景bindingを確認できません。`);
  const patch = rows.map((row, i) => ({ ...row, __jsonui_preview_selector_background: row.__jsonui_preview_selector_background ?? row[textureBinding], __jsonui_preview_selected: i === index, [textureBinding]: i === index ? 'textures/ui/cell_image_invert' : row.__jsonui_preview_selector_background ?? row[textureBinding] }));
  return applied([{ type: 'collectionPatch', patch: { [collection]: patch } }], `${collection}の${index + 1}番をプレビューで選択しました。選択背景だけを変更し、材料消費・レシピ生成は行いません。`);
}

function tradeSelection({ collectionData = {}, collectionAddress }) {
  const rows = own(collectionData, 'trades'), index = collectionAddress?.collection === 'trades' ? collectionAddress.index : -1;
  if (!Array.isArray(rows) || rows.length > 256 || !Number.isInteger(index) || index < 0 || !record(rows[index]) || rows.some(row => !record(row) || typeof row['#trade_toggle_state'] !== 'boolean')) return blocked('INTERACTION_TRADE_ROW_REQUIRED', '選択するtradesの行と排他選択状態を確認できません。');
  const chosen = rows[index];
  if (chosen['#trade_toggle_enabled'] !== true) return blocked('INTERACTION_TRADE_LOCKED', 'この取引候補はロックされています。');
  const supplied = chosen.__collections;
  if (!record(supplied) || !Array.isArray(supplied.trade_item_1) || !Array.isArray(supplied.sell_item) || !Array.isArray(supplied.trade_item_2) || [supplied.trade_item_1,supplied.trade_item_2,supplied.sell_item].some(items => items.length > 1 || items.some(item => !record(item)))) return unavailable('INTERACTION_TRADE_DATA_REQUIRED', '候補固有の入力・出力mockデータがありません。表示中の別取引のアイテムを流用しません。');
  const patch = { trades: rows.map((row, i) => ({ ...row, '#trade_toggle_state': i === index })) };
  for (const [source, targets] of [['trade_item_1',['trade_item_1','trade_item_A','trade2_ingredient1_item','trade_ingredient1_items']],['trade_item_2',['trade_item_2','trade_item_B','trade2_ingredient2_item','trade_ingredient2_items']],['sell_item',['sell_item','trade2_result_item','trade_result_item']]]) for (const name of targets) patch[name] = supplied[source].map(row => ({ ...row }));
  return applied([{ type: 'collectionPatch', patch }, { type: 'mockPatch', patch: { '#trade_button_enabled': chosen['#trade_possible'] === true, '#cross_out_icon': chosen['#trade_cross_out_visible'] === true, '#show_second_trade_slot': supplied.trade_item_2[0]?.['#item_valid'] === true, '$second_item_slot_ignored': !supplied.trade_item_2.length } }], `${index + 1}番の取引候補をプレビューで選択し、その候補の明示mockを詳細欄へ表示しました。取引・材料消費は実行しません。`);
}

/** 未知actionを成功にせず、画面定義とデータ契約の完全一致だけを登録する。 */
export function resolveScopedUiAction(options = {}) {
  const { screenDefinition, action } = options;
  if (screenDefinition === 'book.book_screen' && BOOK_ACTIONS.has(action)) return bookAction(options);
  if (['server_form.third_party_server_screen','server_form.long_form','server_form.custom_form'].includes(screenDefinition)) {
    const form = formAction(options); if (form) return form;
  }
  if (screenDefinition === 'loom.loom_screen' && action === 'button.pattern_select') return selectorAction(options, 'patterns', '#pattern_cell_background_texture');
  if (screenDefinition === 'stonecutter.stonecutter_screen' && action === 'button.stone_select') return selectorAction(options, 'stones', '#stone_cell_background_texture');
  if (screenDefinition === 'trade2.trade_screen' && action === 'button.trade_select') return tradeSelection(options);
  if (screenDefinition === 'persona_emote.emote_wheel_screen' && action === 'button.emote_wheel_exit_non_gamepad') return applied([{ type: 'close', reason: action }], 'マウス／キーボード用の終了mappingに従ってエモートUIのプレビューを閉じました。');
  return null;
}

export function describeUnsupportedUiAction(screenDefinition, action) {
  if (screenDefinition === 'book.book_screen' && ['button.finalize','button.export_book','button.insert_photo_page','button.picked','button.picked_inventory'].includes(action)) return '本の署名確定・写真取得・ファイル出力にはゲーム側の保存先または画像データが必要です。表示状態から推定して実行しません。';
  if (['button.loom_result_take_all_place_all','button.stonecutter_result_take_all_place_all','button.craft_take_all','button.trade','button.enchant','button.beacon_confirm'].includes(action)) return 'レシピ・材料消費・取引・効果確定のゲームデータを実行できません。明示したmockスロットの移動と選択表示だけに対応しています。';
  if (action === 'button.submit_custom_form' || action === 'button.form_button_click') return 'この画面とフォームのデータ源を確認できません。ゲームサーバーやアドオンの処理へは接続しません。';
  return `「${action}」はこの画面で対応するデータ源と動作を確認できないため未対応です。画面遷移は明示マッピングを指定できます。`;
}
