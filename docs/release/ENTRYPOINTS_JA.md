# JSON UI Workbench 0.16.0 — CLI / Node API / HTTP API

CLI はコマンドによる検査・編集・書出し、Node API と HTTP API はパックを読み込んだまま繰り返し検査・描画するための入口です。ここでは Node.js 22.14.0 以降を対象とし、例はプロジェクトのルートで実行します。原本のパックは変更しません。

## 1. 入口と状態の違い

| 入口 | 起動 | 処理と状態 |
|---|---|---|
| CLI | `node local-node/cli.mjs <command>` | 処理後に終了。指定セッションへ設定・編集差分を保存 |
| Node API | `createRenderer()` | 専用の内部処理を 1 インスタンスで再利用。状態はメモリ内 |
| HTTP API | `node local-node/api-server.mjs --connection-file <path>` | 常駐して Node API を再利用。クライアント間で同じ作業領域を共有 |
| 実験版 GUI | `npm run gui` | ブラウザーから手で確認・編集。未完成の編集機能を含む |

`npm start` は CLI の入口案内を表示して終了します。`npm run cli --` は CLI の短縮形ですが、npm 自体の案内が加わるため、JSON のみを読みたい AI / スクリプトは `node local-node/cli.mjs` を直接呼んでください。

Node API は CLI 子プロセスを呼び出さず、既存の専用ループバックサーバーと Worker を保持します。JSON UI の解析・描画・診断は CLI と共通の経路です。HTTP API はその Node API を他の言語から呼ぶための入口です。従来の内部 `/api/node/*` と、新しい `/api/renderer/v1/*` の契約は別です。

API は読込み・一覧・検査・描画に加え、ローカル操作の投影と登録音源の解決に対応します。操作後の状態は呼出し側が引き継ぎます。[操作・音声ガイド](INTERACTION_AUDIO_JA.md)に契約と限界を記載しています。編集・Undo / Redo・MCpack 書出しが必要なときは CLI を利用してください。Node API と HTTP API の状態を CLI セッションへ自動保存・復元する機能はありません。

## 2. 共通の準備

```powershell
npm ci --ignore-scripts
npm run cli -- features --json
```

初回だけ固定依存を導入します。PNG の任意依存 `@napi-rs/canvas` が利用できない場合も JSON と SVG の確認は可能です。JSON / SVG の成功を PNG バックエンドの利用可否と混同しないでください。

例の `packs/addon.mcpack` は実在するパックに置き換えます。ZIP / MCPACK / MCADDON 内のリソースパックを扱います。BP の JavaScript を実行しません。MCADDON に RP 候補が複数ある場合は UUID を明示します。バニラの継承元・画像・フォントが必要なら、対象ゲーム版の正規に入手した参照パックも用意してください。

`ui/example.json` と `example.screen` は説明用の名前です。`list` / `definitions` の結果から対象を選びます。候補が曖昧な場合、先頭の定義を勝手に選ぶ方式ではありません。

## 3. CLI を使う

```powershell
node local-node/cli.mjs import --pack "C:\packs\addon.mcpack" --session outputs/session.json
node local-node/cli.mjs list --session outputs/session.json
node local-node/cli.mjs definitions --file ui/example.json --session outputs/session.json
node local-node/cli.mjs preview --file ui/example.json --definition example.screen --format json --frame 0 --out outputs/frame.json --session outputs/session.json
```

バニラ参照を加える場合は、同じセッションで `import --vanilla "C:\packs\vanilla.zip"` を実行します。通常パックとバニラの両方を一度に指定することもできます。指定した層を交換し、指定していない層は維持します。

PNG は `--format png --out outputs/frame.png`、レイアウト境界の SVG は `--format svg --out outputs/frame.svg` です。同名成果物の置換は `--force` を明示しますが、元パック・セッション・アプリ本体を出力先にすることは拒否します。

通常コマンドの標準出力は `jsonui-cli-result-v1` の JSON 1 件です。`ok: true` は終了コード 0、失敗は `ok: false` と非ゼロ終了です。`help` は人向けの説明、`help --json` は JSON です。アニメーションの PNG は省略時に開始約 1 秒後を使うため、開始時刻を確認するなら `--frame 0` を指定してください。

連続処理には `workflow` が使えます。1 回のサーバー起動と読込みを共有するため、API を使わず CLI のまま効率を改善できます。編集と書出しを含む詳細は [CLI リファレンス](../../local-node/CLI-ja.md) にあります。

## 4. Node.js API を使う

プロジェクトのルートに `preview-example.mjs` を保存して、`node preview-example.mjs` で実行する例です。

```javascript
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRenderer } from './local-node/api.mjs';

const renderer = await createRenderer({
  language: 'ja',
  settings: { width: 1280, height: 720, fps: 60, locale: 'ja_JP' },
});

try {
  await renderer.import({ pack: path.resolve('packs/addon.mcpack') });
  // 必要なら vanilla: path.resolve('packs/vanilla.zip') も指定します。
  console.log(await renderer.list());
  console.log(await renderer.definitions({ file: 'ui/example.json' }));

  const result = await renderer.render({
    file: 'ui/example.json',
    definition: 'example.screen',
    format: 'json',
    frame: 0,
    fps: 60,
  });

  await mkdir('outputs', { recursive: true });
  await writeFile('outputs/api-frame.json', JSON.stringify(result, null, 2));
  console.log(result.quality);
} finally {
  await renderer.close();
}
```

Node API / HTTP API の `import` は、指定したパック組合せで作業領域全体を置き換えます。
通常パックとバニラを重ねる場合は、同じ呼出しに `pack` と `vanilla` の両方を
指定してください。CLI の `import` が未指定の層を維持する動作とは異なります。

元パックのパスは `path.resolve` で絶対パスにします。メソッド名は以下のとおりです。パック内の `file` は OS の絶対パスではなく、`ui/example.json` のようなパック内パスです。

| メソッド | 主な指定 | 用途 |
|---|---|---|
| `import(options)` | `pack`, `vanilla`, `resourcePack` | パックを読み込む |
| `list(options)` | `kind`（任意） | UI ファイル一覧 |
| `definitions(options)` | `file`, `definition`, `kind`（任意） | ファイル内の定義一覧 |
| `validate(options)` | `file`, `definition`, `settings`, `state`, `strictSemantics` | 選択投影の検査 |
| `render(options)` | `file`, `definition`, `format`, `frame`, `fps`, `settings`, `state` | 指定状態・時刻の描画 |
| `interact(options)` | 対象UI、`uiInstanceId`, `localToggleState`, `expectedRevision`, `nodeId` | ローカル操作の投影。返された状態を次の要求に渡す |
| `resolveSound(options)` | `soundId`, `selectionSeed`, `contextSampleRate` | 登録された音源の参照・形式・ハッシュ・診断を取得 |
| `status()` | なし | 読込み状況・機能の確認 |
| `close()` | なし | 受付停止、取消、所有する処理の終了 |

`kind` は `imported` / `vanilla` で対象層を選びます。`render` の `format` は `json` / `svg` / `png`。画像サイズには `width` / `height`、UI 倍率には `uiScale: 'auto'` または 1～8 を指定します。幅・高さは出力ピクセル、UI 倍率はゲーム風 UI の表示倍率です。

`frame` は 0 始まり、時刻は `frame / fps` 秒です。例えば `frame: 30, fps: 60` は 0.5 秒の状態です。PNG で開始時刻を厳密に指定する場合は `frame: 0` を使います。

### 同梱の実行例を使う

[api-preview.mjs](../../local-node/examples/api-preview.mjs) は、要求 JSON を受け取り、
Node API でパックを読み込んで PNG を保存する実行例です。ルートに次の
`request.json` を作成し、実際の絶対パス・UI 名へ置き換えて実行します。

```json
{
  "pack": "C:\\packs\\addon.mcpack",
  "file": "ui/example.json",
  "definition": "example.screen",
  "out": "C:\\outputs\\api-frame.png",
  "width": 1280,
  "height": 720,
  "uiScale": 4,
  "frame": 0
}
```

```powershell
node local-node/examples/api-preview.mjs request.json
```

`pack` / `vanilla` / `resourcePack` は読込み指定、`out` は PNG 保存先です。
`settings` があれば `createRenderer` の既定設定へ渡し、それ以外の項目は
`render` の要求に渡します。この例は `format: "png"` を指定して描画します。
`state` も追加できます。PNG の任意依存と必要素材を用意してください。

保存時は要求 JSON・元パックを保護し、既存の同名 PNG を上書きせず、別の一時
ファイルから結果を公開します。成功時は成果物と `quality` を JSON で返し、
失敗時は非ゼロ終了します。処理後は例内の `finally` で `close()` します。
この例の保存処理は、SDK 本体が自動でファイルを書く機能とは区別してください。

### PNG と SVG を保存する

上の `render` の `format` を `png` に変更すると、戻り値の `png` が Buffer になります。`svg` の場合は `svg` が文字列になります。保存操作は API が自動で行うのではなく、呼出し側で実行します。

```javascript
const result = await renderer.render({
  file: 'ui/example.json', definition: 'example.screen',
  format: 'png', frame: 0,
});
await writeFile('outputs/api-frame.png', result.png);
```

この追加例は `try` の中、`renderer.close()` より前に実行します。任意依存や必要素材が欠けていれば例外を返し、不完全な PNG を成功として保存しません。呼出し側の `writeFile` は通常のファイル書込みです。同名出力を置換したくない場合は `writeFile(..., { flag: 'wx' })` を使い、原本のパスを保存先に指定しないでください。

### 戻り値と失敗

API メソッドは Promise を返します。成功すると各結果オブジェクトを返し、失敗すると `error.code` と診断コンテキストを持つ例外を投げます。SDK の成功値には `schema` と `ok: true` があり、描画結果なら `format` 等も含みます。

読込み失敗・取消では、送信前に確保した upload ID に基づき、取消済みの signal を使わずに新規登録を片付けます。通常は既存のパックを保持し、次の処理で workspace を再構築できます。後片付け自体が失敗した場合は、未追跡の登録を残して処理を続けず、所有するレンダラーを閉じます。この場合は `context.import_cleanup.completed: false`、`recreate_renderer_required: true`、`previous_stack_preserved: false` の情報を確認し、新しい `createRenderer()` から必要なパックを再読込みしてください。取消通知は後片付けより先に返ることがあります。後続の `status()` 等は内部の直列処理後に実行され、閉鎖済みなら上記のコンテキストを含む `API_CLOSED` になります。
HTTP はこの値をさらに `result` へ包みます。SDK 自体に `result` の二重包装はありません。
要求は通常の JSON オブジェクトで指定し、関数・循環参照・getter・未定義値を渡しません。

描画の品質は `quality`、段階別情報は `stage_diagnostics`、PNG の素材解決は `complete` / `preview_complete` と `diagnostics` を確認します。JSON には投影後の原文とフレーム情報があり、SVG はレイアウト境界の確認用です。PNG の最終座標情報には実フォント測定後の `final_frame_summary` を使います。

### パック保持と Worker の復旧

Node API で読み込んだパックは、30 分間操作がなくても自動削除しません。
再度 `import` して置き換えるか、`close()` するまで保持します。HTTP API も
同じ Node API を使います。アップロード容量・処理時間等の別の上限は維持します。

Worker が異常終了して内部処理を復旧した場合、以前のパック状態を勝手に
再構築しません。`API_REIMPORT_REQUIRED` と `reimport_required` の診断が
返ったときは、利用者が `import` で必要なパック組合せを明示して読み込み直します。
復旧前の一時的な model / projection ID を使い回さないでください。

## 5. 状態と設定を与える

### 型付きの状態

フォームやインベントリの見え方を試す場合は `state` に代表状態を与えます。フォームを実際に開いたり、インベントリへアイテムを投入したりする処理ではありません。

```javascript
const result = await renderer.render({
  file: 'ui/server_form.json',
  definition: 'server_form.main_screen',
  format: 'json',
  frame: 0,
  state: {
    form: {
      type: 'action',
      title: '表示テスト',
      body: '選択する項目',
      buttons: [{ text: '最初の項目' }, { text: '次の項目' }],
    },
  },
});
```

この例のファイル・定義は、実際に読み込んだフォーム UI の名前に置き換えます。型付き状態が示す推奨定義があっても、API が任意のパックに不足している UI 定義を作成するものではありません。

インベントリ状態の例は次のとおりです。

```json
{
  "inventory": {
    "main": [{ "id": "minecraft:stone", "count": 32 }, null],
    "hotbar": [{ "id": "minecraft:diamond_pickaxe", "count": 1 }]
  }
}
```

`state` は共有の型付き形式を使用します。高度な binding / collection の入力は `state.mockData` / `state.collectionData` も利用できます。snake_case の `mock_data` / `collections` を `state` 直下に置く形式とは異なります。不明なキーや不正な型は拒否します。

API の `state` は **その呼出しだけ**に適用し、以前の runtime 状態を明示的に置き換えます。CLI では `settings --state-file state.json --replace-state --session ...` が対応する入口です。CLI の設定はセッションへ保存されるため、寿命は API と異なります。

### 生の runtime 設定

生の binding / collection や変数・スクロール値を設定する場合は `settings` を使います。

```javascript
const result = await renderer.render({
  file: 'ui/example.json', definition: 'example.screen',
  format: 'json', frame: 0,
  settings: {
    mock_data: { '#title': '表示テスト' },
    collections: {},
    variables: {},
    scroll: {},
  },
});
```

`createRenderer({ settings })` はインスタンスの既定設定です。各 `render` / `validate` の `settings` はその呼出しだけ上書きし、次の呼出しの既定設定へ保存しません。`locale` はパックの文字列・フォント、`language` はツールの説明言語です。

`state` と、手動 runtime データを持つ `settings` は同じ呼出しで併用しません。どちらを評価したか曖昧になるため、入力競合として拒否します。型付き状態を使う場合の画面サイズ・locale 等、runtime データ以外の設定は別途指定できます。

## 6. HTTP API を使う

最初のターミナルで常駐サーバーを起動します。

```powershell
npm run api -- --connection-file .jsonui-api/connection.json
```

既定の `--port 0` は空きポートの自動選択です。固定が必要なら `--port 3211` のように指定します。接続先は `127.0.0.1` に固定し、ブラウザーの `Origin` 付き要求を受け付けません。GUI は公開しません。

起動完了時に、指定ファイルへ `base_url` / `token` / `pid` を保存します。標準出力の ready 情報に token は含めません。同名ファイルを勝手に上書きしません。接続ファイルは OS が対応する範囲で mode 0600 のアクセスにします。Windows の ACL をこの Unix mode だけで完全制御できるという意味ではありません。認証値をログ・Git・共有ファイルへコピーしないでください。

### PowerShell の呼出し例

別のターミナルを開き、同じルートから実行します。token 自体を表示する必要はありません。

```powershell
$connection = Get-Content .jsonui-api/connection.json -Raw | ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($connection.token)" }
$importBody = @{ pack = (Resolve-Path .\packs\addon.mcpack).Path } | ConvertTo-Json
$importResult = Invoke-RestMethod -Method Post -Uri "$($connection.base_url)/api/renderer/v1/import" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($importBody))

$renderBody = @{
  file = "ui/example.json"
  definition = "example.screen"
  format = "json"
  frame = 0
} | ConvertTo-Json -Depth 30
$renderResult = Invoke-RestMethod -Method Post -Uri "$($connection.base_url)/api/renderer/v1/render" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($renderBody))
$renderResult.result.quality
```

`list` / `status` は本文 `{}`、`definitions` は `{"file":"ui/example.json"}` を同様に POST します。原本のパスは API サーバーが動く端末上の絶対パスです。URL を渡して外部パックを取得する入口ではありません。

### エンドポイントと応答

| メソッド / パス | 本文 | 返す情報 |
|---|---|---|
| `GET /health` | なし | 稼働だけ。描画品質・token の正しさの認定ではない |
| `POST /api/renderer/v1/import` | Node API の import options | 読込み結果 |
| `POST /api/renderer/v1/list` | list options / `{}` | UI ファイル一覧 |
| `POST /api/renderer/v1/definitions` | definitions options | 定義一覧 |
| `POST /api/renderer/v1/validate` | validate options | 選択投影の検査 |
| `POST /api/renderer/v1/render` | render options | JSON / SVG / PNG と描画診断 |
| `POST /api/renderer/v1/status` | `{}` | 読込み状況・機能 |

`/health` 以外は `Authorization: Bearer <接続ファイルのtoken>` と `Content-Type: application/json` が必要です。SDK と同じ options を本文に渡しますが、AbortSignal は JSON へ含めません。

成功応答は次の包装です。

```json
{
  "schema": "jsonui-renderer-http-v1",
  "ok": true,
  "correlation_id": "要求を識別するID",
  "result": { "format": "json", "quality": {} }
}
```

これは包装の説明用で、`result` はメソッドによって変わります。失敗時は非成功 HTTP status と `ok: false`、`error.code` / `category` / `correlation_id` / 必要な診断コンテキストを返します。`ok: true` は API 処理の成功で、実機一致の合格ではありません。

PNG の `result.png` は Buffer を JSON にできる形へ置き換えたものです。

```json
{
  "encoding": "base64",
  "media_type": "image/png",
  "size_bytes": 12345,
  "checksum_sha256": "実際の画像のSHA-256",
  "data": "実際のbase64文字列"
}
```

上の描画要求を `format = "png"` に変えた場合は、呼出し側で次のように保存できます。

```powershell
New-Item -ItemType Directory -Force outputs | Out-Null
[IO.File]::WriteAllBytes((Join-Path (Get-Location) "outputs/http-frame.png"), [Convert]::FromBase64String($renderResult.result.png.data))
```

SDK と同じ品質 metadata は `result` に残ります。SVG は `result.svg` の文字列です。HTTP API に保存先を渡して原本を上書きさせる入口はありません。上の利用者コードによる保存先は自分で管理してください。

## 7. 取消・終了・排他

Node API の各処理の第二引数は `{ signal }` を受け付けます。

```javascript
const controller = new AbortController();
const promise = renderer.render({
  file: 'ui/example.json', definition: 'example.screen', format: 'json',
}, { signal: controller.signal });

// 必要なときに取消します。
controller.abort();
try {
  await promise;
} catch (error) {
  console.error(error.code);
}
```

取消は処理の完了待ちを止める要求です。OS の停止や任意の同期処理を即座に中断できる保証ではありません。`close()` は新規受付を止め、処理を取り消して、所有するサーバーと Worker を終了します。同じ `close()` を複数回呼んでも同じ終了処理を待ちます。別の GUI や既存サーバーは終了しません。

HTTP はクライアントの切断で、その要求を取り消します。常駐サーバーは起動ターミナルの `Ctrl+C` で停止します。**接続ファイルは、`close()` / `Ctrl+C` 後も残します。** サーバー停止後、その起動の token は利用できません。接続ファイルが存在することを稼働中の証拠として扱わないでください。

終了時に自動削除しないのは、別のプロセスが同じパスへ置換したファイルを誤って削除することを避けるためです。再起動時は新しい `--connection-file` のパスを選ぶか、旧サーバーが停止していて自分の旧接続ファイルであることを確認して、そのファイルを削除してから同じパスを使います。既存ファイルの上書きは許可しません。

1 インスタンスの Node API は処理を順番に受け付けます。HTTP のクライアントは 1 つの作業領域を共有するため、別のクライアントの import は同じパック状態を変えます。別パックを独立して並行処理する場合は、別の renderer / HTTP サーバーを用意します。キュー・要求数の上限に達した場合はエラーを返し、無制限に処理をためません。

| 上限 | 現行値 |
|---|---|
| Node API の受付済み処理（実行中を含む） | 8 件 |
| Node API / HTTP の要求 JSON | 16 MiB |
| HTTP の同時要求 / 接続 | 8 件 / 32 接続 |
| HTTP 応答 JSON | 64 MiB |
| HTTP 本文の受信待ち | 30 秒 |

PNG の base64 化には画像バイト列より大きい応答容量が必要です。上限を超えた画像は
転送成功として返しません。これらの上限は、パック展開や描画内部の別の上限を解除しません。

CLI セッションは別の排他ロックで保護します。同じセッションの同時利用、元パックの改変を黙認しません。原本変更・ロック残留の扱いは [CLI 詳細](../../local-node/CLI-ja.md) を参照してください。

## 8. 品質を判定する

| 情報 / 指定 | 意味 |
|---|---|
| `quality.semantic` | 選択投影の解決状態 |
| `quality.state` など状態の metadata | 明示状態の適用・根拠 |
| `quality.evaluation` | 評価・展開の完了状態 |
| `quality.collection` / `quality.bindings` | 行参照と表示・入力値の解決 |
| `quality.animation` | 対応するアニメーション評価の範囲 |
| `quality.native_comparison` | 実機比較の状態。描画できたことと別 |
| `complete` / `preview_complete` | 素材・行参照・binding 等の互換用完了情報。実機一致ではない |
| `strictSemantics: true` | 解決・評価・行参照・binding 等の厳格判定を明示 |
| `strictAnimation: true` | アニメーション品質の未対応・不明で描画停止 |
| `allowPartial: true` | PNG の不完全な調査用画像を明示許可 |
| `drawEvidence: true` | PNG の最終描画入力・矩形情報を上限付きで取得 |
| `frameSummary: true` | JSON の件数・打切り等の概要だけ。画像用の全シーンではない |

`validate` は投影の検査で、実行時フレームの全行・binding 評価を行いません。描画による strict 判定と同一の合格範囲にしないでください。`allowPartial` を指定しても strict 判定は解除しません。

フレーム転送上限で失敗した場合、`frameSummary: true, format: 'json'` は調査に使えます。概要が返ったことは、その巨大な UI の全シーンを描画できたという証明ではありません。

入力クリック、音声の実再生、サーバー応答、Minecraft ネイティブ screen controller やコンテナ処理は API の描画対象と別です。結果を実機プレビューの代替資料として使えますが、全画素・全操作・全ゲーム版の一致を保証するものではありません。

## 9. 旧版からの移行

0.14.0 で `npm start` により GUI を開いていた場合、0.15.0 では `npm run gui` に変更します。CLI の `local-node/cli.mjs`、既存セッション形式、主要コマンドは引き続き使えます。自動化で GUI を開く必要はありません。

ライセンス・素材配布方針は変更していません。共有 `editor-core` は CLI と API の実行にも必要なため保持しています。以前の検証説明・起動履歴を今回の API 検証結果と取り違えず、現在の利用にはこのガイドを優先してください。
