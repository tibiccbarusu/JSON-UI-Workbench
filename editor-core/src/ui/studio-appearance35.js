/** 選択要素の文字/テクスチャをJSON記法なしで編集する小さな表示部品。 */
export function textureSuggestions35(indexes, query = '', limit = 40) {
  const result = new Set(), search = String(query).toLocaleLowerCase();
  const cap = Math.max(1, Math.min(80, limit));
  for (const index of indexes) {
    for (const paths of index?.textures?.byLower?.values?.() || []) {
      for (const path of paths) {
        if (!/^textures\/.+\.(?:png|tga|jpe?g)$/iu.test(path)) continue;
        const ref = path.replace(/\.(?:png|tga|jpe?g)$/iu, '');
        if (!search || ref.toLocaleLowerCase().includes(search)) result.add(ref);
        if (result.size >= cap) return [...result];
      }
    }
  }
  return [...result];
}

export function renderStudioAppearance35(h, { type, value, disabled = false, draft, suggestions = [], onApply }) {
  const property = type === 'label' ? 'text' : type === 'image' ? 'texture' : null;
  if (!property || typeof value !== 'string') return null;
  const label = property === 'text' ? '表示する文字' : 'テクスチャ';
  const fieldId = `studio-appearance-${property}35`;
  const input = h(property === 'text' ? 'textarea' : 'input', { id: fieldId, type: property === 'texture' ? 'text' : undefined,
    class: 'studio-appearance-input35', 'aria-label': label, value: draft.value, disabled,
    rows: property === 'text' ? 3 : undefined, maxlength: property === 'text' ? 16384 : 1024,
    list: property === 'texture' ? 'studio-texture-suggestions35' : undefined,
    onInput: event => { draft.value = event.currentTarget.value; applyButton.disabled = disabled || draft.value === value; },
  }, []);
  const applyButton = h('button', { type: 'button', class: 'btn', disabled: disabled || draft.value === value,
    onClick: () => { if (!disabled && draft.value !== value) return onApply(property, draft.value); } }, [property === 'text' ? '文字を変更' : 'テクスチャを変更']);
  return h('section', { class: 'studio-appearance35', 'aria-label': '表示内容' }, [
    h('label', { for: fieldId }, [label]), input,
    property === 'texture' ? h('datalist', { id: 'studio-texture-suggestions35' }, suggestions.map(item => h('option', { value: item }, []))) : '',
    applyButton,
    h('p', { class: 'hint' }, [property === 'text' ? '現在の表示値から編集します。変更すると、元の変数や式を入力した値で置き換えます。日本語・翻訳キー・変数を指定できます。' : '現在の表示値から編集します。変更すると元の変数や式を入力値で置き換えます。読み込んだ textures/ パスを指定し、候補は最大40件です。']),
  ]);
}
