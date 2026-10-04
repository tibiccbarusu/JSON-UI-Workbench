/** パックの表示情報。重い画像検査と256角への変換はNodeが行う。 */
export function createPackExportSettings({ iconReadTimeoutMs = 10_000 } = {}) {
  const state = { name: 'JSON UI 選択エクスポート', description: '', version: '1.0.0', authors: '',
    iconPngBase64: undefined, iconName: '', iconBytes: 0, iconUrl: '', iconError: '', loading: false, open: false };
  let generation = 0;
  let cancelRead = null;
  const readTimeoutMs = Number.isFinite(iconReadTimeoutMs)
    ? Math.max(1, Math.min(10_000, Math.floor(iconReadTimeoutMs))) : 10_000;
  function readIconBytes(file) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (cancelRead === cancel) cancelRead = null;
        callback(value);
      };
      const cancel = () => finish(reject, Object.assign(new Error('アイコンの読込は更新されました。'), { name: 'AbortError' }));
      const timer = setTimeout(() => finish(reject, Object.assign(new Error('アイコンの読み込みが時間内に完了しませんでした。もう一度選択してください。'), {
        name: 'TimeoutError', code: 'EXPORT_ICON_READ_TIMEOUT',
      })), readTimeoutMs);
      cancelRead = cancel;
      // Blob.arrayBuffer itself has no AbortSignal. Ignore late completion,
      // but retain both handlers so late read errors never become unhandled.
      try { Promise.resolve(file.arrayBuffer()).then(value => finish(resolve, value), error => finish(reject, error)); }
      catch (error) { finish(reject, error); }
    });
  }
  function clearIcon() {
    generation++; cancelRead?.(); if (state.iconUrl) URL.revokeObjectURL(state.iconUrl);
    Object.assign(state, { iconPngBase64: undefined, iconName: '', iconBytes: 0, iconUrl: '', iconError: '', loading: false });
  }
  async function selectIcon(file) {
    // ダイアログの取消は進行中の選択を失効させない。
    if (!file) return false;
    const current = ++generation;
    cancelRead?.();
    state.loading = true; state.iconError = '';
    try {
      // 失敗する可能性のある入口検査も finally の対象にする。
      if (!Number.isSafeInteger(file.size) || file.size > 1024 * 1024 || file.size < 33 || !/\.png$/iu.test(file.name)) throw new Error('アイコンには1 MiB以下のPNG画像を指定してください。');
      const bytes = new Uint8Array(await readIconBytes(file));
      if (current !== generation) return false;
      if (bytes.length !== file.size || bytes.slice(0, 8).join(',') !== '137,80,78,71,13,10,26,10') throw new Error('PNG画像として読み込めません。');
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (header.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw new Error('PNG画像のヘッダーを読み込めません。');
      const width = header.getUint32(16), height = header.getUint32(20);
      // img のブラウザ復号より先に寸法を制限する。CRC検証と変換はNodeが行う。
      if (!width || !height || width > 2048 || height > 2048) throw new Error('アイコンは縦・横ともに2048ピクセル以下のPNG画像を指定してください。');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
      const encoded = btoa(binary);
      const url = URL.createObjectURL(file);
      if (state.iconUrl) URL.revokeObjectURL(state.iconUrl);
      Object.assign(state, { iconPngBase64: encoded, iconName: file.name, iconBytes: bytes.length, iconUrl: url });
      return true;
    } catch (error) {
      // 選び直し・クリアで失効した読込の失敗を現在の画面へ通知しない。
      if (current !== generation) return false;
      state.iconError = `${error?.message || 'アイコンを読み込めません。'} 前のアイコン設定を維持しています。`;
      throw error;
    } finally { if (current === generation) state.loading = false; }
  }
  function options() {
    if (state.loading) throw new Error('アイコンを読み込み中です。完了後に書き出してください。');
    const version = state.version.trim();
    if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('バージョンは1.0.0のように3つの整数で指定してください。');
    const numbers = version.split('.').map(Number);
    if (numbers.some(value => !Number.isSafeInteger(value) || value > 65535)) throw new Error('バージョンの各数値は0〜65535で指定してください。');
    if (!state.name.trim()) throw new Error('パック名を入力してください。');
    if (state.name.length > 120 || /[\u0000-\u001f\u007f]/u.test(state.name)) throw new Error('パック名は制御文字を含めず120文字以内で入力してください。');
    if (state.description.length > 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(state.description)) throw new Error('説明は1024文字以内で入力してください。');
    const authors = state.authors.split(/[,、\n]/u).map(name => name.trim()).filter(Boolean);
    if (authors.length > 16 || authors.some(name => name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name))) throw new Error('作者は16名まで、1名につき80文字以内で入力してください。');
    return { packOptions: { name: state.name.trim(), version: numbers,
      ...(state.description.trim() ? { description: state.description.trim() } : {}),
      ...(authors.length ? { authors } : {}) },
    ...(state.iconPngBase64 ? { iconPngBase64: state.iconPngBase64 } : {}) };
  }
  function render(h, { disabled = false, onChange = () => {}, onError = () => {} } = {}) {
    const status = h('span', { id: 'pack-export-icon-status', class: 'pack-export-icon-status', role: 'status' }, [state.loading ? 'アイコンを読み込み中…' : state.iconError]);
    const field = (name, label, attributes = {}) => h('label', { class: 'pack-export-field' }, [
      h('span', {}, [label]), h(name === 'description' ? 'textarea' : 'input', {
        id: `pack-export-${name}`, value: state[name], disabled, ...attributes,
        onInput: event => { state[name] = event.currentTarget.value; onChange(false); },
      }, name === 'description' ? [state[name]] : []),
    ]);
    return h('details', { class: 'pack-export-settings', open: state.open,
      onToggle: event => { if (event.currentTarget.isConnected) state.open = event.currentTarget.open; } }, [
      h('summary', {}, ['パック情報・アイコン']),
      h('div', { class: 'pack-export-fields' }, [
        field('name', 'パック名', { type: 'text', maxlength: 120 }),
        field('version', 'バージョン', { type: 'text', placeholder: '1.0.0', inputmode: 'decimal' }),
        field('description', '説明', { maxlength: 1024, rows: 2, placeholder: 'パックの内容を説明' }),
        field('authors', '作者（カンマ区切り）', { type: 'text', maxlength: 1295 }),
      ]),
      h('div', { class: 'pack-export-icon' }, [
        state.iconUrl ? h('img', { src: state.iconUrl, alt: '選択したパックアイコン', width: 64, height: 64 }, []) : '',
        h('label', {}, [h('span', {}, ['アイコン（PNG・1 MiB以下）']), h('input', {
          id: 'pack-export-icon-file', type: 'file', accept: '.png,image/png', disabled,
          onChange: async event => {
            const input = event.currentTarget, file = input.files?.[0];
            if (!file) return;
            const pending = selectIcon(file);
            status.textContent = state.loading ? 'アイコンを読み込み中…' : state.iconError;
            onChange(false);
            try { await pending; } catch (error) { onError(error); }
            finally { input.value = ''; onChange(true); }
          },
        }, [])]),
        status,
        state.iconName ? h('span', { class: 'hint' }, [state.iconName]) : '',
        state.iconUrl ? h('button', { type: 'button', class: 'btn', disabled,
          onClick: () => { clearIcon(); onChange(true); } }, ['アイコンを外す']) : '',
      ]),
      h('p', { class: 'hint' }, ['アイコンは比率を保って256×256に収めます。必要なMinecraftのバージョンは依存素材から自動設定します。']),
    ]);
  }
  return { state, options, render, clearIcon, selectIcon,
    diagnosticSummary: () => ({ configured: true, hasIcon: !!state.iconPngBase64, iconBytes: state.iconBytes, loading: state.loading }) };
}
