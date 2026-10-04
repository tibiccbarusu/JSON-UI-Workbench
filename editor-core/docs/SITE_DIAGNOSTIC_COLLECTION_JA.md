# サイト実機診断ログ収集手順（S066）

## 1. 目的と提出物

この手順は、サイトを実際に操作したときの再現情報を、最小回数・最小提出物で収集するためのものです。標準の提出物は次の6ファイルです。

1. `jsonui_site_diagnostic_*.json`（必須、1ファイル）
2. `vanilla-audit.json`（必須、同一session ID、1ファイル）
3. `web-01-vanilla-loaded.png`（Vanilla Resource Pack 読込完了）
4. `web-02-target-screen-open.png`（対象JSON UIを開いた状態）
5. `web-03-preview-result.png`（Canvasプレビュー結果）
6. `web-04-export-reimport.png`（エクスポート後の再読込結果）

失敗箇所が上記4場面以外にある場合だけ、`web-05-error.png` を追加します。HAR、Pack本文、認証情報は通常提出しません。

## 2. 収集される情報／収集されない情報

| 区分 | 記録内容 | 方針 |
|---|---|---|
| セッション | Session ID、開始／停止時刻、アプリ版 | 常に記録 |
| User-Agent | ブラウザー識別文字列 | 開始時に明示指定した場合だけ記録 |
| 操作 | import、export、preview、その他サイト操作の種別・結果コード | 状態アクションと既存診断ログから半自動記録 |
| 異常 | app error、`window.error`、unhandled rejection | 既存診断ストア経由で記録 |
| console | debug/log/info/warn/error | 開始時に明示指定した場合だけ記録 |
| consoleのオブジェクト | 型名とキー名 | 値は記録しない |
| Pack／ファイル本文 | JSON、テキスト、Blob、payload等 | 記録しない（本文キーを強制マスク） |
| 秘匿値 | password、Authorization、token、cookie、API key等 | キーと文字列パターンの両方でマスク |
| スクリーンショット | ファイル名、撮影時刻、画面種別、短い注記 | 画像本体は別ファイル。JSONには参照だけ記録 |

既定の最終JSON上限は512 KiBです。イベント数だけでなく、整形後JSONのUTF-8実バイト数を検査し、超過時は古いイベントから省略します。省略数は `summary.droppedEventCount` に残ります。

## 3. 1回の診断セッション

### 3.1 開始

1. 対象サイトを開きます。
2. ブラウザーの開発者ツールで Console を開きます。
3. 次を実行します。

```js
const siteDiag = globalThis.__JSONUI_SITE_DIAGNOSTICS__;
const started = siteDiag.start({ includeUserAgent: true, captureConsole: true });
started;
```

戻り値の `code` が `SITE_DIAG_STARTED` であることを確認します。`SITE_DIAG_ALREADY_ACTIVE` の場合は、既存セッションを停止してから開始し直します。

`started.sessionId`をコピーしてVanilla CLI監査の`--session-id`へ渡し、出力を`vanilla-audit.json`として保存します。`validation_status=PASS`、`correlation.session_id`が診断JSONの`session.id`と同一であることを確認してから、Vanilla ZIPをサイトへ読み込みます。これにより、サイト結果を正確なfull asset・版・channel・SHAへ結合します。

User-Agentを提出したくない場合は `includeUserAgent: false` にできます。consoleを捕捉しない場合は `captureConsole: false` にできます。ただし、再現性を優先する実機試験では両方を `true` にすることを推奨します。

### 3.2 操作と代表スクリーンショット

次の順に1回ずつ操作します。

1. 対象Minecraft Bedrock版に対応するVanilla Resource Pack ZIPを読み込みます。
2. `web-01-vanilla-loaded.png` を撮影し、Consoleで参照を追加します。
3. 編集対象Packを読み込み、対象JSON UIを開きます。
4. `web-02-target-screen-open.png` を撮影し、参照を追加します。
5. Canvasで対象画面を表示し、言語・バインディング・テクスチャを確認します。
6. `web-03-preview-result.png` を撮影し、参照を追加します。
7. Resource Pack ZIPをエクスポートし、そのZIPをサイトへ再読込します。
8. `web-04-export-reimport.png` を撮影し、参照を追加します。

参照追加例:

```js
siteDiag.addScreenshotReference({
  fileName: "web-01-vanilla-loaded.png",
  view: "vanilla import",
  note: "Vanilla reference is ready; version was checked by operator"
});

siteDiag.addScreenshotReference({
  fileName: "web-02-target-screen-open.png",
  view: "target screen",
  note: "Target JSON UI is open"
});

siteDiag.addScreenshotReference({
  fileName: "web-03-preview-result.png",
  view: "preview canvas",
  note: "Expected resolution and locale selected"
});

siteDiag.addScreenshotReference({
  fileName: "web-04-export-reimport.png",
  view: "export reimport",
  note: "Exported ZIP was accepted by the site"
});
```

スクリーンショットの絶対パスは記録されず、ベースファイル名だけが残ります。注記へPack本文、URLの署名付きクエリ、ユーザー名、アクセストークンを書かないでください。

アプリ外の重要な境界を手動で記録する場合だけ、次を使います。

```js
siteDiag.recordOperation(
  "export",
  "success",
  "PACK_EXPORT_DOWNLOADED",
  { fileName: "example_export.zip", zipBytes: 123456 }
);
```

`details` には件数、バイト数、画面名、結果コードなどの短いメタデータだけを渡します。Pack JSONやファイル本文を渡しても本文キー／JSON文書検知でマスクされますが、最初から渡さないことが原則です。

### 3.3 停止と提出用JSON作成

期待結果と一致した場合:

```js
siteDiag.stop({
  resultCode: "SITE_REAL_DEVICE_PASS",
  summary: {
    vanillaLoaded: true,
    targetOpened: true,
    previewMatched: true,
    exportReimportPassed: true
  }
});
await siteDiag.download();
```

不一致または途中停止の場合:

```js
siteDiag.addScreenshotReference({
  fileName: "web-05-error.png",
  view: "failure",
  note: "Short symptom only; do not paste project content"
});
siteDiag.stop({
  resultCode: "SITE_REAL_DEVICE_FAIL",
  summary: {
    failedGate: "preview",
    observedCode: "copy the short on-screen error code here"
  }
});
await siteDiag.download();
```

ダウンロードの戻り値が `SITE_DIAG_DOWNLOADED` であることを確認します。ダウンロードが制限される環境では、HTTPS等のsecure context上で次を実行してクリップボードへコピーします。

```js
await siteDiag.copy();
```

`Clipboard.writeText()` はsecure contextとブラウザー権限を要求するため、`SITE_DIAG_CLIPBOARD_UNAVAILABLE` または `SITE_DIAG_COPY_FAILED` の場合はダウンロードを使用します。

## 4. JSON受入確認

提出前にJSONをテキストエディターで開き、次を確認します。

| 確認項目 | 合格条件 |
|---|---|
| Schema | `schema` が `jsonui.site-diagnostic-session` |
| Vanilla結合 | `vanilla-audit.json`がPASSで、`correlation.session_id`がサイト診断と一致 |
| 開始・停止 | `startedAtIso` と `stoppedAtIso` が存在 |
| 操作者判定 | `outcome.operatorResultCode` が `SITE_REAL_DEVICE_PASS` または `SITE_REAL_DEVICE_FAIL` |
| 証拠由来判定 | errorがあれば`outcome.resultCode=SITE_DIAGNOSTIC_ERRORS_CAPTURED`、warning／ログ省略があれば`SITE_DIAGNOSTIC_WARNINGS_CAPTURED`。なければ操作者判定と一致 |
| スクリーンショット | `screenshotReferences` が提出画像名と一致 |
| 本文非収集 | `policy.packAndFileBodiesCollected` が `false` |
| console制限 | `policy.objectValuesFromConsoleCollected` が `false` |
| サイズ | `summary.outputBytes <= policy.maxBytes` |
| 省略 | `droppedEventCount > 0` なら、異常発生直後のイベントが残っていることを確認 |
| 秘匿値 | token、cookie、Authorization、Pack本文が存在しない |

操作者がPASSを指定しても、error／rejectionを捕捉した場合は`outcome.resultCode`をPASSへ上書きできません。操作者の入力は`outcome.operatorResultCode`へ別保存されます。errorありは `SITE_DIAGNOSTIC_ERRORS_CAPTURED`、warningまたは省略ありは `SITE_DIAGNOSTIC_WARNINGS_CAPTURED`、それ以外は操作者指定値（未指定なら`SITE_DIAGNOSTIC_PASS`）になります。差がある場合はFAIL/WARNとして原因を調査し、無害と判断した根拠も別注記に残します。

## 5. 実装根拠（ブラウザー標準）

- 同期的なスクリプト／イベント処理エラーと未処理Promise rejectionは別イベントなので、既存診断ストアで `error` と `unhandledrejection` の両方を扱います: [MDN: Window error event](https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event)、[MDN: Window unhandledrejection event](https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event)
- Console APIは複数の任意値を受け取るため、任意オブジェクトの値をそのままJSON化せず、型とキー名だけに縮約します: [MDN: Console API](https://developer.mozilla.org/en-US/docs/Web/API/Console_API)
- クリップボード書込みはsecure contextと権限に依存するため、JSONダウンロードを主経路、コピーを代替経路にします: [MDN: Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)
- ダウンロードではBlob URLを作成し、完了後にrevokeしてメモリを解放します: [MDN: URL.createObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)
- Session IDは利用可能な場合 `crypto.randomUUID()` を使います。これは相関用IDであり、認証トークンではありません: [MDN: Crypto.randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)

## 6. 制約

- この診断JSONはサイト操作の証跡です。Minecraft Bedrock内のContent Log／コンソールログを代替しません。Bedrock側は別の実機収集手順で取得します。
- スクリーンショット画像はブラウザーが自動撮影しません。撮影した画像のファイル名と時刻だけを診断JSONへ関連付けます。
- User-Agentは端末識別につながり得るため、既定では収集しません。
- ログが完全でも、目視結果そのものは代表スクリーンショットで確認します。
