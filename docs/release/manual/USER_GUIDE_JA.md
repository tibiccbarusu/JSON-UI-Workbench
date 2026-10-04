# JSON UI Workbench 0.16.1 — 日本語説明書

[English](USER_GUIDE_EN.md) · [仕様書](TECHNICAL_SPEC_JA.md) · [注意事項](LIMITATIONS_JA.md) · [ライセンス](../../../LICENSE.md)

このアプリは、Minecraft Bedrock のリソースパックに書かれた **Classic JSON UI** を読み、見た目と代表的な状態をゲームの外で調べるツールです。ゲームを起動したり、アドオンの JavaScript を実行したりするものではありません。まず付属の小さな例で「取込み → 画面選択 → プレビュー → 編集 → 書出し」を試してください。

**対応するのは Classic UI のプレビューです。Pocket UI・スマートフォンで通常使われるタッチ向け UI のプレビューには対応していません。** この配布物は PC 上の Node.js で使う構成で、スマートフォン用アプリでもありません。端末の種類と Minecraft の UI プロファイルは別の条件です。詳しくは [注意事項](LIMITATIONS_JA.md) を参照してください。

## 1. 最初に選ぶ使い方

| 使いたい方法 | 入口 | 向いている作業 |
|---|---|---|
| ターミナルにコマンドを入力する | CLI・本書の標準手順 | 検査、画像作成、原文編集、パック書出し |
| プログラムから繰り返し呼び出す | Node API | 同じパックの繰り返し描画、AI との連携 |
| Python 等から HTTP で呼び出す | HTTP API | 常駐するローカルサービスへの要求 |
| マウスで見ながら編集する | GUI・実験版 | 手動の確認と編集。未完成なので結果確認が必要 |

`npm start` は **CLI の案内を表示して終了**します。ブラウザーを開くには `npm run gui` を使います。従来の `start.bat` も GUI 用の互換入口です。CLI と API は自動でブラウザーを開きません。

## 2. インストールして準備する

1. 配布 ZIP をすべて展開します。ZIP の中から直接実行せず、たとえば `C:\Tools\jsonui-workbench-0.16.1` に置きます。
2. [Node.js 公式サイト](https://nodejs.org/en/download)から **22.14.0 以上**の対応する Node.js と npm を用意します。初期検証の基準は Node.js 22.14.0 です。
3. Windows では、そのフォルダーをエクスプローラーで開き、アドレス欄に `powershell` と入力して Enter を押します。これで、このフォルダーを作業場所にしたターミナルが開きます。
4. 次を一行ずつ実行します。

```powershell
node --version
npm --version
npm ci --ignore-scripts
node local-node/cli.mjs help
```

`npm ci` は同梱の `package-lock.json` に従って依存を入れます。`--ignore-scripts` は依存のインストール時スクリプトを実行しない指定です。初回はパッケージ取得の通信が必要です。**既存の `node_modules` は `npm ci` により置き換わる**ので、自分の別プロジェクトでは実行しないでください。JSON と SVG の検査とは別に、PNG には任意依存の `@napi-rs/canvas` が必要です。

Windows で `npm.ps1` が実行ポリシーにより拒否されたら、同じフォルダーで `npm.cmd ci --ignore-scripts`、`npm.cmd run gui` のように `npm.cmd` を使えます。実行ポリシーを変更する必要はありません。

Windows で「`node` が認識されない」と出たら、インストール後にターミナルを開き直して `node --version` を確認します。`start.bat` がアプリ専用 Node を用意している場合は、`node` の代わりに `.\.jsonui\runtime\node.exe` を指定できます。GUI 用ランチャーだけでは npm と PNG 依存の導入まで完了したとは限りません。

macOS/Linux ではターミナルで展開先へ `cd` し、同じ `node` と `npm` のコマンドを使います。本書のコマンド中の `/` は PowerShell と POSIX シェルの双方で使えます。Windows 固有の `Get-Content` や `Invoke-RestMethod` は POSIX シェルのコマンドではありません。

## 3. ファイルの場所と名前を区別する

| 例 | 意味 |
|---|---|
| `outputs/manual-demo.mcpack` | PC 上の入力パック。通常の相対パスは、現在の作業フォルダーが基準 |
| `outputs/manual-session.json` | CLI の作業記録。元パックの場所・ハッシュ・設定・編集差分を保存 |
| `ui/manual_demo.json` | **パックの中**の UI ファイル。PC 上に同名ファイルがなくてもよい |
| `manual.screen` | ファイルの中の UI 定義名。名前空間 `manual` と定義 `screen` の組合せ |
| `/screen/controls/2/card` | JSON Pointer。原文 JSON の中の編集対象を指定する経路 |

パスに空白がある場合は `"C:\My Packs\sample.mcpack"` のように引用符で囲みます。以後は毎回同じ `--session` を指定してください。省略すると、現在の作業フォルダーにある `.jsonui-cli/session.json` が使われます。

## 4. 付属の例で初めてのプレビューを作る

この例は、本書用の JSON、白い 1 ピクセルの画像、付属の人工 OGG 音を使います。Minecraft の画像・フォントは必要ありません。文字を含まない小さな画面なので、PNG の環境確認にも使えます。**ゲームの中でフォームを開く完成アドオンではありません。**

```powershell
node docs/release/manual/examples/build-demo.mjs
node local-node/cli.mjs import --pack outputs/manual-demo.mcpack --session outputs/manual-session.json
node local-node/cli.mjs list --session outputs/manual-session.json
node local-node/cli.mjs definitions --file ui/manual_demo.json --session outputs/manual-session.json
node local-node/cli.mjs settings --file docs/release/manual/examples/settings-demo.json --session outputs/manual-session.json
```

`build-demo.mjs` は `outputs/manual-demo.mcpack` を新しく作ります。同名ファイルがあると停止し、勝手に上書きしません。やり直すときは、別名を指定します。

```powershell
node docs/release/manual/examples/build-demo.mjs outputs/manual-demo-2.mcpack
```

一覧で `ui/manual_demo.json` と `manual.screen` を確認したら、次を実行します。

```powershell
node local-node/cli.mjs validate --file ui/manual_demo.json --definition manual.screen --strict-semantics --session outputs/manual-session.json
node local-node/cli.mjs preview --file ui/manual_demo.json --definition manual.screen --frame 0 --format json --strict-semantics --out outputs/manual-frame.json --session outputs/manual-session.json
node local-node/cli.mjs preview --file ui/manual_demo.json --definition manual.screen --frame 0 --format svg --strict-semantics --out outputs/manual-frame.svg --session outputs/manual-session.json
node local-node/cli.mjs preview --file ui/manual_demo.json --definition manual.screen --frame 0 --format png --strict-semantics --out outputs/manual-frame.png --session outputs/manual-session.json
```

`outputs/manual-frame.png` を開くと、暗い背景、上の横帯、左のカード、下のスイッチが見えます。右側の詳細は、スイッチを操作するまで非表示です。幅 640・高さ 360・UI 倍率 2 の設定です。倍率 2 では、UI 内の 1 単位が出力画像の約 2 ピクセルに対応します。

| 出力 | 何を確認するか |
|---|---|
| JSON | 解決済みの値、フレーム・矩形・binding・診断を詳しく見る |
| SVG | 要素の矩形と配置を確認する図。素材・文字を再現した画像ではない |
| PNG | 対応するテクスチャやフォント等を使って描いた画像 |

通常は、同名出力があると止まります。自分で置き換えてよい出力だけに `--force` を付けます。**元パックとセッションを出力先にすることは `--force` でもできません。**

## 5. 自分のパックと状態を調べる

手順は例と同じです。`import` の入力を自分の ZIP/MCPACK/MCADDON に変え、`list` → `definitions` の順で **実在する**ファイルと定義を探します。通常パックは `--pack`、バニラ参照パックは `--vanilla` です。両方を同時に指定することもできます。参照パックは自分が利用する権利を持つものを用意してください。

```powershell
node local-node/cli.mjs import --pack "C:/MyPacks/addon.mcaddon" --vanilla "C:/MyPacks/reference.zip" --session outputs/my-session.json
node local-node/cli.mjs list --session outputs/my-session.json
```

MCADDON にリソースパック候補が複数あるときは、診断に出た header UUID を `--resource-pack` で指定します。最初の候補を勝手に選びません。参照パックや文字グリフが足りない場合、既定の PNG は停止します。JSON/SVG で構造を調べるか、必要な正当な参照素材を追加してから再試行してください。

ゲームから取得できない値には、代表状態を与えます。たとえば次を UTF-8 の `outputs/state.json` として保存します。

```json
{
  "form": {
    "type": "action",
    "title": "Sample",
    "body": "Choose an item",
    "buttons": [{ "text": "Continue" }, { "text": "Close" }]
  }
}
```

```powershell
node local-node/cli.mjs settings --state-file outputs/state.json --replace-state --session outputs/my-session.json
```

これは **プレビュー用のデータ**です。フォームを実機で開くものではなく、読み込んだパックに欠けている定義を自動で作るものでもありません。`--replace-state` は以前の代表状態とローカルトグル状態を置き換えます。高度な生データは設定の `mock_data` / `collections` を使用します。型付き `state` との書き方・競合条件は [仕様書](TECHNICAL_SPEC_JA.md) を確認してください。

アニメーションの時刻は `frame / fps` 秒です。`--frame 30 --fps 60` は 0.5 秒、`--frame 0` は開始時です。PNG は時刻を省略すると開始約 1 秒後を使用するため、比較には時刻を明示してください。`--strict-animation` を加えると、アニメーション品質に未対応・不明状態が残る場合も停止します。

## 6. 検査結果を読む

CLI は通常、成功・失敗を JSON 1 件で返します。`ok: true` と終了コード 0 が処理の成功、`ok: false` と非ゼロ終了コードが失敗です。PowerShell では直後の `$LASTEXITCODE` を確認できます。案内文字列が欲しい場合は `help`、説明を英語にしたい場合は `--language en` を使います。

画像ができただけで合格と判断せず、`quality`、`stage_diagnostics`、`diagnostics` を確認してください。`passed` は対応範囲で計算できたこと、`unknown` は未対応・観測不足等が残ること、`failed` は不整合を検出したこと、`not_evaluated` は未評価を表します。`quality.native_properties` は **記録済みの非対応プロパティ**の検査で、Minecraft の全仕様を検査したという意味ではありません。

`--strict-semantics` は選択した UI の解決・行参照・表示入力 binding 等の不明状態を許可しない指定です。既定の PNG も、対応範囲の未解決素材等が残れば止まります。調査目的で不完全な画像が必要な場合だけ `--allow-partial` を使います。厳格検査の指定が優先されるため、これだけでは strict による失敗を解除できません。`complete` / `preview_complete` の真偽は **実機の全画素・操作・音の一致を保証しません**。

## 7. 原文を編集して、取り消し・書出しを行う

まず付属例のカードを右へ 12 単位動かします。

```powershell
node local-node/cli.mjs edit --operation docs/release/manual/examples/move-demo.json --session outputs/manual-session.json
node local-node/cli.mjs preview --file ui/manual_demo.json --definition manual.screen --frame 0 --format png --strict-semantics --out outputs/manual-edited.png --session outputs/manual-session.json
node local-node/cli.mjs undo --session outputs/manual-session.json
node local-node/cli.mjs redo --session outputs/manual-session.json
```

付属の `move-demo.json` は `/screen/controls/2/card` の `offset` を `[36, 56]` にします。`offset` はアンカーからの位置であり、画面の絶対ピクセルではありません。編集はセッションへ保存され、**入力 MCPACK は変わりません**。

ファイル全体を自分のエディターで編集する場合は、いったん原文を取り出します。

```powershell
node local-node/cli.mjs read --file ui/manual_demo.json --out outputs/manual-authored.json --session outputs/manual-session.json
```

`outputs/manual-authored.json` を編集して UTF-8 で保存したら、反映します。

```powershell
node local-node/cli.mjs edit --file ui/manual_demo.json --text-file outputs/manual-authored.json --session outputs/manual-session.json
```

不正な構文等の拒否時は、直前の確定済み編集を保持します。新しい編集を確定すると redo の履歴が消えます。undo には件数・容量上限があり、設定変更や UI 選択は undo の対象外です。

最後に依存関係を確認して、新しいパックを書き出します。

```powershell
node local-node/cli.mjs export --file ui/manual_demo.json --definition manual.screen --plan --out outputs/manual-export-plan.json --session outputs/manual-session.json
node local-node/cli.mjs export --file ui/manual_demo.json --definition manual.screen --out outputs/manual-selected.mcpack --session outputs/manual-session.json
```

書出しは **選んだ UI と必要な依存**が対象です。入力アドオンの全ファイル、BP スクリプト、世界やプレイヤーの状態を丸ごと保存するものではありません。依存を解決できない場合は停止します。パック名等の指定と、追加・削除・継承の操作形式は [詳細 CLI ガイド](../../../local-node/CLI-ja.md) を参照してください。

## 8. GUI を手で使う

```powershell
npm run gui
```

ブラウザーが自動で開かない場合は、起動ログのローカル URL を使います。`editor-core/app/index.html` をダブルクリックして開く方法は使いません。ターミナルはサーバーとして動いているので開いたままにします。

1. 左側の「**1 · パックを読み込む**」で ZIP/MCPACK を選びます。練習には生成済みの `outputs/manual-demo.mcpack` を使えます。
2. 「**JSON UIファイル**」で `ui/manual_demo.json`、その下の UI 定義で `screen` を選び、「**選択したUIをプレビュー**」を押します。
3. 配置だけを見るときはプレビューを使います。変更するときは「**編集モード**」へ切り替え、対象要素と影響範囲を確認します。自動配置、動的 offset、アニメーション中の位置などはドラッグできない場合があり、原文で編集します。
4. キャンバスの未確定変更は「**JSON UIに確定**」で確定します。原文欄の変更は「**検証して反映**」で反映します。確定・適用に失敗した変更を、保存済みと判断しないでください。
5. 「**書き出し**」タブに現在の UI を追加し、依存を検査してパックを保存します。**ページ再読込で読込みパックと編集内容が失われる**ため、必要な成果物は先に書き出してください。
6. 問題がある場合は「**ログ・診断**」または診断の一括保存を使います。終了は起動ターミナルで Ctrl+C です。

GUI は実験機能です。マウスで編集した後は、書き出したパックを **別の CLI セッション**へ取り込み、`validate` と指定時刻の厳格 PNG で再確認する手順を推奨します。GUI の状態を CLI セッションへ自動共有する機能はありません。

## 9. Node API：同じ UI の状態を変える

次は実行できる付属プログラムです。先に 4 節でパックを生成し、PNG 依存を導入してください。

```powershell
node docs/release/manual/examples/sdk-demo.mjs
```

新しい `outputs/sdk-demo` に `before.png`、`after.png`、`result.json` ができます。スイッチを 1 回操作した状態を次の描画へ渡すため、`after.png` には右の紫色の詳細が現れます。インスタンスは `finally` で閉じます。出力フォルダーが既にある場合は、別名を指定します。

```powershell
node docs/release/manual/examples/sdk-demo.mjs outputs/manual-demo.mcpack outputs/sdk-demo-2
```

この例は `createRenderer()` → `import()` → `render()` → `interact()` → `render()` → `resolveSound()` の順に使います。`interact()` は、渡したローカルトグル状態を返す方式です。毎回 `uiInstanceId`、最新の `localToggleState`、その `revision` を引き継ぎます。サーバー自身が最新状態を保存する方式ではありません。

`audioIntent` は音声再生の **要求の記述**で、`resolveSound()` は登録 OGG の参照先・ハッシュ・事前検査を返します。**この Node/CLI/HTTP の例からスピーカーの音は出ません。** GUI のプレーヤーとは別です。任意のゲーム命令の実行やフォーム送信は行いません。入力・音声の対応範囲は [仕様書](TECHNICAL_SPEC_JA.md) を参照してください。

## 10. HTTP API：PowerShell から呼び出す

最初のターミナルで次を実行し、起動したままにします。

```powershell
node local-node/api-server.mjs --connection-file outputs/http-connection.json
```

別の PowerShell を同じプロジェクトフォルダーで開き、次を実行します。接続ファイルのトークンを表示したり、Git・共有ファイル・相談用ログへ貼り付けたりしないでください。

```powershell
$connection = Get-Content outputs/http-connection.json -Raw | ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($connection.token)" }
$importBody = @{ pack = (Resolve-Path outputs/manual-demo.mcpack).Path } | ConvertTo-Json
$importResult = Invoke-RestMethod -Method Post -Uri "$($connection.base_url)/api/renderer/v1/import" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($importBody))
$renderBody = @{
  file = "ui/manual_demo.json"
  definition = "manual.screen"
  format = "json"
  frame = 0
  width = 640
  height = 360
  uiScale = 2
  strictSemantics = $true
} | ConvertTo-Json -Depth 30
$renderResult = Invoke-RestMethod -Method Post -Uri "$($connection.base_url)/api/renderer/v1/render" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($renderBody))
$renderResult.result.quality
```

接続はループバックの `127.0.0.1` に限定され、通常のブラウザーの Origin 付き要求を受け付けません。他の PC やスマートフォンへ公開するサーバーではありません。CLI の保存セッションとは別のメモリ内作業領域です。終了はサーバー側ターミナルの Ctrl+C です。PNG の base64 保存等は [HTTP 詳細](../../../docs/release/ENTRYPOINTS_JA.md#6-http-api-を使う) と [仕様書](TECHNICAL_SPEC_JA.md) を参照してください。

## 11. よくある問題と次に確認する場所

| 症状・コード | 次にすること |
|---|---|
| `npm start` で画面が開かない | 正常です。GUI を使う場合は `npm run gui` |
| `RASTER_BACKEND_UNAVAILABLE` | プロジェクトのルートで `npm ci --ignore-scripts`。対応 OS/CPU の任意依存が導入されたか確認 |
| フォントやテクスチャの未解決 | 必要な権利のある参照パックを追加。文字のない本書の例と比較 |
| `CLI_DEFINITION_AMBIGUOUS` | `definitions` の完全な `rawKey` を指定。先頭候補を推測しない |
| `POCKET_PREVIEW_BLOCKED` | Pocket の描画は非対応。Classic の定義を選び直す |
| `CLI_SOURCE_CHANGED` | 読込み時と元パックの内容が異なる。元ファイルを戻すか、別セッションへ新規取込み |
| `CLI_SESSION_LOCKED` | 同じセッションの別処理が終わるまで待つ。起動中のロックを削除しない |
| `API_REIMPORT_REQUIRED` | Worker 復旧後に必要なパックを明示して再取込み |
| 画像は出るが実機と違う | 対応範囲・状態・時刻・倍率・素材の診断を確認し、実機で別に検証 |

診断は `node local-node/cli.mjs diagnostics --out outputs/diagnostics.json --session outputs/manual-session.json` で保存できます。単独実行は **今回の起動の診断**で、過去に終了した処理のイベントまで復元するものではありません。連続操作の診断をまとめるときは [CLI の workflow](../../../local-node/CLI-ja.md#複数操作をまとめる) を使います。

## 12. 利用条件と資料

本プロジェクトの独自部分は **PolyForm Noncommercial License 1.0.0** で提供します。非商用の利用・改変・再配布を認める条件と、必要な表示は [LICENSE](../../../LICENSE.md) を読んでください。商用利用を許可するライセンスではありません。依存ソフトや自分が読み込む素材には、それぞれ別の権利条件が適用されます。作品の販売等と組み合わせる場合も、利用目的が条件を満たすか確認してください。

- [仕様書](TECHNICAL_SPEC_JA.md)：入力、出力、内部処理、操作 API の契約。
- [注意事項](LIMITATIONS_JA.md)：Classic/Pocket、描画・状態・音声・編集等の制限。
- [詳しいコマンドと操作 JSON](../../../local-node/CLI-ja.md)。
- [Node.js 公式ダウンロード](https://nodejs.org/en/download)と [npm ci 公式説明](https://docs.npmjs.com/cli/commands/npm-ci/)：環境の準備。

この説明書の検査成功は、Minecraft のあらゆる UI・バージョン・デバイスの完全な互換性を意味しません。完成したアドオンの実機確認は別に行ってください。
