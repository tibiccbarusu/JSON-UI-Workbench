/** 挿入タブの表示部品。原文の変更と入力状態は呼出元が所有する。 */
export const INSERT_TOOLS35 = Object.freeze([
  { type: 'panel', label: 'パネル', symbol: '▭', hint: '要素をまとめる領域を配置' },
  { type: 'label', label: 'テキスト', symbol: 'T', hint: '文字を表示する要素を配置' },
  { type: 'image', label: '画像', symbol: '▧', hint: 'パックのテクスチャを表示' },
  { type: 'button', label: 'ボタン', symbol: '▣', hint: '文字付きのボタンを配置' },
]);

export function renderStudioInsert35(h, { type = '', disabled = false, onChoose, onCancel, parentLabel = '', status = '', prerequisite = '', advanced = null }) {
  return h('div', { class: 'studio-insert35' }, [
    h('div', { class: 'studio-insert-tools35', role: 'group', 'aria-label': '挿入する要素' }, INSERT_TOOLS35.map(tool =>
      h('button', { id: `studio-insert-${tool.type}35`, class: 'btn studio-insert-tool35', type: 'button',
        disabled, title: tool.hint, 'aria-pressed': String(type === tool.type),
        onClick: () => onChoose(type === tool.type ? '' : tool.type),
      }, [h('span', { class: `studio-insert-symbol35 symbol-${tool.type}`, 'aria-hidden': 'true' }, [tool.symbol]), h('span', {}, [tool.label])]))),
    h('div', { class: 'studio-insert-guide35', role: 'status' }, [
      h('strong', {}, [prerequisite ? '挿入を始めるには' : type ? 'キャンバス上で配置してください' : '要素を選んで、キャンバスへ配置']),
      h('span', {}, [prerequisite || (type ? 'ドラッグで大きさを指定。クリックだけでも配置できます。Escで中止。' : '配置後は枠のハンドルで大きさを変更できます。')]),
      type && parentLabel ? h('span', { class: 'studio-insert-parent35' }, [parentLabel]) : '',
      type === 'image' ? h('span', {}, ['画像のテクスチャは、配置後にプロパティから指定できます。']) : '',
      type === 'button' ? h('span', {}, ['ボタンの動作は原文で割り当ててください。']) : '',
      type ? h('button', { type: 'button', class: 'btn', id: 'workspace-add-cancel32', onClick: onCancel }, ['挿入を中止']) : '',
      status ? h('span', { class: 'studio-insert-status35' }, [status]) : '',
    ]),
    advanced || '',
  ]);
}
