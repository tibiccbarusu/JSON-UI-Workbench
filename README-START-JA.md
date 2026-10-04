# JSON UI Workbench 0.16.1 — はじめに

0.16.1 では CLI が標準の入口です。未完成の GUI 編集を使いたい場合だけ、明示して実験版 GUI を起動します。

[新しい日本語説明書](docs/release/manual/USER_GUIDE_JA.md) · [English user guide](docs/release/manual/USER_GUIDE_EN.md) · [注意事項](docs/release/manual/LIMITATIONS_JA.md)

## 初回準備

1. ZIP を新しい、書き込み可能なフォルダーに全て展開します。
2. Node.js 22.14.0 以降を用意します。
3. `package.json` のある場所で PowerShell / ターミナルを開きます。

```powershell
npm ci --ignore-scripts
npm start
```

`npm start` はヘルプを表示して終了します。次は `npm run cli -- features --json` で機能を確認し、[CLI / API 利用ガイド](docs/release/ENTRYPOINTS_JA.md) のパック読込みへ進んでください。

PNG は任意の `@napi-rs/canvas` を使用します。JSON と SVG の確認には不要です。公開ソースはネイティブバイナリや Minecraft の texture / font / model を同梱しません。必要な参照パックは対象版に合わせて別途用意します。

## 目的に応じて起動する

| 目的 | 実行方法 |
|---|---|
| コマンドで処理 | `npm run cli -- help` |
| Node.js から呼ぶ | `local-node/api.mjs` の `createRenderer()` |
| HTTP で呼ぶ | `npm run api -- --connection-file .jsonui-api/connection.json` |
| 実験版 GUI | `npm run gui` |

CLI の通常のコマンドは処理後に終了します。HTTP API と GUI は使用中ターミナルを開いたままにし、終了時に `Ctrl+C` を押します。Node API は呼出し側で `close()` します。

`start.bat` / `start.cmd` と `bash start.sh` は従来互換の **実験版 GUI 用**です。CLI / API の起動とは区別してください。Windows 起動の細部は [GUI 起動ガイド](local-node/START-ja.md) に残しています。

## 次に読む資料

- [CLI / Node API / HTTP API の使い方](docs/release/ENTRYPOINTS_JA.md)
- [編集・書出しを含む CLI 詳細](local-node/CLI-ja.md)
- [実験版 GUI の操作と限界](README-LOCAL-JA.md)
- [ライセンスの範囲](LICENSE.md)
- [素材の扱い](docs/release/ASSET_POLICY.md)

プレビューの成功と Minecraft 実機の互換性は別です。結果の `quality` と診断を確認し、表示不足を許可した調査用画像を実機一致と扱わないでください。
