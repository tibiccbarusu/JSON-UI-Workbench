# JSON UI Workbench 0.16.1

0.16.1 は文書・ライセンス整備版です。描画実装は 0.16.0 のまま、日本語・英語の説明書、仕様書、注意事項、非商用ライセンスを整えました。初めて使う方は、ゲーム素材なしで実行できる教材が付いた説明書から始めてください。

**Classic UI 専用です。Pocket・タッチ向け UI とスマートフォン上での利用は対応対象外です。**

| 文書 | 日本語 | English |
|---|---|---|
| 人間向け説明書 | [説明書](docs/release/manual/USER_GUIDE_JA.md) | [User guide](docs/release/manual/USER_GUIDE_EN.md) |
| 操作・入力・出力・内部処理の仕様 | [仕様書](docs/release/manual/TECHNICAL_SPEC_JA.md) | [Technical specification](docs/release/manual/TECHNICAL_SPEC_EN.md) |
| 非対応・制約・未検証の範囲 | [注意事項](docs/release/manual/LIMITATIONS_JA.md) | [Limitations](docs/release/manual/LIMITATIONS_EN.md) |
| 利用・改変・再配布の条件 | [ライセンス説明](LICENSE-JA.md) | [License explanation](LICENSE-EN.md) |
| ブラウザーで読む一冊版 | [日本語 HTML](docs/release/manual/HANDBOOK_JA.html) | [English HTML](docs/release/manual/HANDBOOK_EN.html) |

[文書案内](docs/release/manual/INDEX.md) · [0.16.0 の変更・検査範囲（過去の実行記録）](docs/release/VERIFICATION_0160_JA.md)

Minecraft: Bedrock Edition の Classic JSON UI を、ゲーム外で読み込み・描画・検査する独立した開発ツールです。**CLI を標準の入口**にし、プログラムから継続して利用するための **Node.js API とローカル HTTP API** を用意しています。PowerPoint のような編集を目指した GUI は、明示して起動する実験版として残しています。

[English](README-EN.md) · [はじめに](README-START-JA.md) · [CLI / API の利用ガイド](docs/release/ENTRYPOINTS_JA.md) · [CLI 詳細](local-node/CLI-ja.md) · [変更履歴](CHANGELOG.md) · [権利表記](LICENSE.md)

**非公式のツールです。Mojang / Microsoft に承認・提携された製品ではありません。**

## 使う入口を選ぶ

| 目的 | 入口 | 状態の扱い |
|---|---|---|
| コマンドで検査・描画・編集・書出しを行う | `npm run cli -- <command>` | 指定したセッション JSON に保存 |
| AI や自分の Node.js プログラムから連続描画する | `createRenderer()` | インスタンス内で保持、`close()` で終了 |
| Python 等から HTTP で連続描画する | `npm run api -- --connection-file .jsonui-api/connection.json` | 起動中のサーバー内で保持 |
| 手で画面を確認・編集する | `npm run gui` | 実験版 GUI の作業状態 |

`npm start` は CLI のヘルプと入口案内を表示して終了します。ブラウザーは開きません。Node API と HTTP API は同じ描画経路を使い、コマンドごとの Node 子プロセス起動を省けます。CLI でも `workflow` を使えば、複数操作を 1 回の起動と読込みでまとめられます。

CLI・Node API・HTTP API はプレビュー用の状態データを受け取り、対応する binding・collection・アニメーションを評価します。`interact` は既知の入力マッピングによる効果を記述し、ローカルトグルの状態更新だけを応答へ適用します。Minecraft 本体、Script API、ネイティブフォームや実際のインベントリ処理を動かす機能ではありません。Pocket UI は索引・原文の対象で、描画対象ではありません。

## 準備と最初の CLI 実行

Node.js **22.14.0 以降**を用意し、ZIP を新しいフォルダーに全て展開して、`package.json` のある場所で実行します。

```powershell
npm ci --ignore-scripts
npm start
npm run cli -- features --json
```

`@napi-rs/canvas` は PNG 出力の任意依存です。導入できなくても JSON による構造・状態評価と SVG によるレイアウト確認を利用できます。PNG が使えるかは機能情報で確認してください。SVG はテクスチャ・パックのフォント・3D モデルを描く完成画像ではありません。

自分のパックを取り込んで、ファイルと定義を調べます。

```powershell
npm run cli -- import --pack "C:\packs\addon.mcpack" --session ".\outputs\work-session.json"
npm run cli -- list --session ".\outputs\work-session.json"
npm run cli -- definitions --file "ui/example.json" --session ".\outputs\work-session.json"
npm run cli -- preview --file "ui/example.json" --definition "example.screen" --format json --out ".\outputs\frame.json" --session ".\outputs\work-session.json"
```

`C:\packs\addon.mcpack` は手元の実在するファイルに、`ui/example.json` と `example.screen` は一覧に出た名前に置き換えてください。バニラの継承元・画像・フォントが必要なら、対象ゲーム版の正規に入手した参照パックを `import --vanilla` で追加します。Minecraft の素材は配布物に同梱していません。

AI から JSON だけを受け取りたい場合は `node local-node/cli.mjs ...` で直接実行してください。`npm run` 自体の案内文字列が加わることがあります。

## Node.js / HTTP API

Node.js からは `local-node/api.mjs` の `createRenderer` を import し、パックの読込み・一覧・検査・描画を直接呼び出します。戻り値の PNG は Buffer、SVG は文字列で、ファイル保存は呼出し側が選びます。処理後は必ず `await renderer.close()` を呼びます。

HTTP API は `127.0.0.1` のみで待ち受けます。接続情報を指定ファイルに保存し、認証トークンは標準出力へ出しません。公開サーバーとして外部公開する構成ではありません。

```powershell
npm run api -- --connection-file .jsonui-api/connection.json
```

Node API の完全な例、HTTP の送信例、状態の設定、結果の判定、キャンセルと終了は [利用ガイド](docs/release/ENTRYPOINTS_JA.md) を参照してください。[同梱の Node API 実行例](local-node/examples/api-preview.mjs) は `node local-node/examples/api-preview.mjs request.json` で PNG を保存できます。要求 JSON の項目と原本保護の扱いは利用ガイドにあります。

API のパックは 30 分の未操作で自動削除せず、再 import / close まで保持します。Worker 復旧で `API_REIMPORT_REQUIRED` が返った場合は、明示してパックを読み込み直します。HTTP 接続ファイルは終了後も残し、停止したサーバーの token は無効です。再起動には新しい接続ファイル名を選ぶか、自分の旧ファイルを確認して削除します。既存ファイルを上書きしません。

## 実験版 GUI

```powershell
npm run gui
```

GUI のプレビュー・原文編集・配置編集・Undo / Redo・書出しを試せます。編集機能は未完成です。共通部品・継承・生成された行の変更は他の要素にも影響し、個別要素だけを意図どおり移動・削除できるとは限りません。CLI / API の利用に GUI 起動は必要ありません。

Windows の `start.bat` / `start.cmd`、macOS / Linux の `bash start.sh` は、従来との互換性のため **実験版 GUI** を起動します。Windows の自動 Node 取得を含む実機起動は今回の環境で未検証です。[GUI 操作ガイド](README-LOCAL-JA.md) と [GUI 起動の詳細](local-node/START-ja.md) を参照してください。

## 正確さと結果の読み方

描画に成功しても、Minecraft 内の見た目・入力・クラッシュしないことを保証するものではありません。必要な外部状態を指定し、`quality`、`diagnostics`、素材の解決状態と評価の完了状態を併せて確認してください。`quality.native_comparison` は実機比較なしで成功になりません。

通常の PNG は必要素材や未対応の描画が残る場合に停止します。`allowPartial: true` / `--allow-partial` は調査用の部分画像を許可する指定です。意味論・アニメーションの厳格判定を解除する指定ではありません。JSON / SVG の成功を PNG の完成と扱わないでください。

3D が必要なアイテムを単なる表面画像で代用しません。対応情報がない場合は `NATIVE_ITEM_MODEL_REQUIRED` 等の診断を残します。任意のモデル・NBT・実行時に採番された追加アイテム ID の完全再現は対象外です。

## 原本と作業状態

CLI / API は読み込んだ元パックを上書きしません。CLI の編集はセッションに保持し、明示した別の出力先へ書き出します。Node API と HTTP API の作業状態は起動中だけ保持し、終了後に自動復元するセッション機能ではありません。両 API の `import` は作業領域全体の置換なので、通常パックとバニラを重ねる場合は同じ要求に両方を指定します。

同じ CLI セッションは同時に使えません。Node API の 1 インスタンスは呼出しを順番に処理します。独立した並列作業には別インスタンス・別セッションを用います。詳細は [利用ガイド](docs/release/ENTRYPOINTS_JA.md) にあります。

## 開発と配布

```powershell
npm run test:release
npm run check:package
node scripts/release/audit-public.mjs
python scripts/release/package_public.py --output-dir dist
```

Python 3.11 以降は配布 ZIP の生成に使用します。公開版から除外したゲーム素材依存の試験、Windows 実機操作、Minecraft 実機描画は、実行していない限り合格件数へ含めません。[0.15.0 の今回の検証](docs/release/VERIFICATION_015_JA.md) と、[0.14.0 の既存の検証説明](docs/release/VERIFICATION_JA.md) は別の実行記録です。

| フォルダー | 内容 |
|---|---|
| `editor-core/` | CLI / API / GUI で共用する解析・描画エンジン、実験版画面、固定ライブラリ |
| `local-node/` | CLI、Node API、HTTP API、ローカル処理、テスト |
| `docs/release/` | 現行の入口案内、変更根拠、公開手順、素材の扱い |
| `scripts/release/` | 配布生成、公開内容の監査、回帰試験 |
| `examples/` | 小さな自作例 |

CLI を主入口にするために共有エンジンを削除していません。古い `editor-core/docs/` や版別の資料には旧画面・旧コマンドの記録があります。起動方法と対応範囲はこの README と、上記の新しい説明書・仕様書・注意事項を優先してください。旧版の検証報告は当時の記録です。

## 権利

公開者が権利を保有する、または許諾する権限を持つ独自部分を **PolyForm Noncommercial License 1.0.0** で提供します。条件に従った非商用の利用・改変・再配布は可能です。商用目的の利用は許可しません。[LICENSE.md](LICENSE.md) と [日本語の説明](LICENSE-JA.md) を参照してください。商用制限があるため、OSI の意味でのオープンソースではなく、非商用のソース公開ソフトウェアです。

第三者ライブラリには各ライセンスが適用されます。[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) と同梱本文を確認してください。Minecraft 素材、他者のアドオン、個人ログの読込み機能は、それらの再配布許可を与えるものではありません。[素材ポリシー](docs/release/ASSET_POLICY.md) · [GitHub 公開手順](docs/release/GITHUB_JA.md)。
