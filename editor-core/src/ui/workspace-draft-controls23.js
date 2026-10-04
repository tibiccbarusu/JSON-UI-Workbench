// ブラウザー ESM。追加予定の要素だけに表示する属性欄。原文へは保存しない。
export function renderWorkspaceDraftControls23(h, { controller, selectionId, onUpdate, onError, onBack } = {}) {
  const addition = controller.pendingAdditions().find(item => item.id === selectionId);
  if (!addition) return null;
  const props = addition.operation.value;
  const caption = props.type === 'button' && props.controls?.length === 1 ? props.controls[0]?.caption : null;
  const edit = change => {
    try { controller.editPendingAddition(selectionId, change); onUpdate?.(); }
    catch (error) { onError?.(error); }
  };
  const vector = (property, index, label) => h('label', { class: 'workspace-property-label' }, [label,
    h('input', { type: 'number', step: 'any', value: String(props[property]?.[index] ?? 0),
      onChange(event) {
        const raw = event.currentTarget.value.trim(), number = Number(raw);
        if (!raw || !Number.isFinite(number) || property === 'size' && number < 0) {
          onError?.(Object.assign(new Error('位置は有限な数値、サイズは0以上の数値で指定してください。'), { code: 'WORKSPACE_DRAFT_FIELD_INVALID' })); return;
        }
        const value = [...(props[property] || [0, 0])]; value[index] = number;
        edit({ type: 'set', property, value });
      } }),
  ]);
  return h('section', { class: 'workspace-pending-addition', 'aria-label': '追加予定の要素の属性' }, [
    h('h3', {}, [addition.operation.name]), h('p', { class: 'hint' }, ['追加予定の要素です。移動と属性はプレビューへ反映され、「変更を反映」でJSON UIへ保存されます。']),
    h('div', { class: 'workspace-properties' }, [vector('offset', 0, '横位置'), vector('offset', 1, '縦位置'), vector('size', 0, '幅'), vector('size', 1, '高さ'),
      ...['text', 'texture'].map(property => h('label', { class: 'workspace-property-label' }, [property === 'text' ? '文字列' : 'テクスチャ',
        h('input', { type: 'text', value: String(property === 'text' && caption?.type === 'label' ? caption.text || '' : props[property] || ''), onChange: event => edit({ type: 'set', property, value: event.currentTarget.value }) }),
      ])),
    ]),
    h('button', { type: 'button', class: 'btn', onClick: () => edit({ type: 'delete' }) }, ['追加を削除']),
    h('button', { type: 'button', class: 'btn', onClick: onBack }, ['既存要素の属性へ戻る']),
  ]);
}
