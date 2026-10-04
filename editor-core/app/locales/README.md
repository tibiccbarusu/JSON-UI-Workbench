# サイト表示言語

`ja_JP.json` と `en_US.json` は同じキーを持つサイト用辞書です。既定は日本語です。

画面右上で切り替えると `jsonui.locale` に保存され、次回も選択した言語を使います。プレビューの `texts/*.lang` や原文 JSON、入力値とは別の設定です。

追加機能の文字列は `src/i18n/site-ui-translations.js` と `site-message-translations.js` に明示登録し、サイト所有の表示箇所でだけ変換します。
