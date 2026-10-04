# JSON UI Workbench 0.15.0 — コマンドモード

- 対象: Node.js 22.14.0 以降。
- 標準入口: `local-node/cli.mjs` / `npm run cli -- <command>`。`npm start` はヘルプを表示して終了。
- Node API / HTTP API: [入口ガイド](../docs/release/ENTRYPOINTS_JA.md)。GUI は `npm run gui` で明示して起動する実験版。
- PNG の任意依存: `@napi-rs/canvas` 0.1.100。初回にルートで `npm ci --ignore-scripts` を実行。画像素材は利用者の参照パックから読み込み。
- コマンド例のシェル: Windows PowerShell。
- 作業状態: UTF-8 のセッション JSON に、元パックの場所・SHA-256・編集差分・設定を保存。
- 元パック: 読取専用。編集結果はセッションと書出し先へ保存。

## 現在の品質判定

詳細は [製品説明](../README.md) と [公開版の説明](../docs/release/) を参照してください。
`quality.animation` は、指定時刻で評価したアニメーションモデルの品質です。
`preview --strict-animation` は、この品質が `passed` のときだけ通過します。
`--strict-semantics` とは別の指定で、`--allow-partial` は strict-animation を解除しません。

`complete` は素材の完了、`preview_complete` は素材・行参照・binding 品質の完了を
表す既存の互換用フィールドです。診断の対象範囲も一緒に確認してください。
成功しても、Minecraft の実機イベント、時計、操作、全画素の一致を認定しません。
`--draw-evidence` は PNG の描画入力・描画矩形を記録します。

実機で確認された不正なプロパティと、まだ実機で確認できていない組合せは別の診断です。
元 JSON を黙って書き換えて合格に見せることはしません。label の anchor を内部の文字の
縦位置と同一視した旧 r41 の説明は、本版の仕様として使用しないでください。

## 機能確認と草稿計算

機能と制限は次で確認します。このコマンドはセッションを新規作成しません。

```powershell
node .\local-node\cli.mjs features --json
```

既存の操作JSONを、元ZIPや保存セッションへ確定せず試す場合は次を実行します。`ui/example.json` と `example.screen` は `definitions` で確認した実際の名前に置き換えます。

```powershell
node .\local-node\cli.mjs draft --operation ".\outputs\operation.json" --file "ui/example.json" --definition "example.screen" --session ".\outputs\work-session.json" --out ".\outputs\draft-frame.json"
```

`draft` の出力は草稿のJSON/フレームIRです。PNGを出すコマンドではなく、サイトのマウス操作・音声・クリップボードまで自動化する機能でもありません。入力ファイルやセッションと同じ出力先は、`--force` 指定時も拒否します。確定したい操作は従来の `edit --operation` を別途実行します。

未対応のネイティブ描画が残るPNGは、通常の `preview --format png` では失敗します。`--allow-partial` を付けた場合だけ調査用の部分画像を作ります。この画像を実機一致と解釈しないでください。

## 最初の実行

アプリのフォルダーで PowerShell を開き、次のように実行します。`--session` は作業ごとに同じファイルを指定します。パスに空白がある場合は引用符で囲んでください。

```powershell
node .\local-node\cli.mjs help
node .\local-node\cli.mjs import --vanilla "C:\packs\vanilla.zip" --session ".\outputs\work-session.json"
node .\local-node\cli.mjs list --session ".\outputs\work-session.json"
node .\local-node\cli.mjs definitions --file "ui/beacon_screen.json" --session ".\outputs\work-session.json"
```

`start.bat` がアプリ専用 Node.js を初期設定した環境で `node` が見つからない場合は、各例の `node` を `.\.jsonui\runtime\node.exe` に置き換えてください。システムの PATH を変更する必要はありません。

```powershell
.\.jsonui\runtime\node.exe .\local-node\cli.mjs help
.\.jsonui\runtime\node.exe .\local-node\cli.mjs import --vanilla "C:\packs\vanilla.zip" --session ".\outputs\work-session.json"
```

通常パックだけの場合は `--pack`、通常パックとバニラを組み合わせる場合は `--pack` と `--vanilla` を同時に指定します。ZIP・MCPACK・MCADDONのリソースパックに対応し、拡張子は大文字小文字を問いません。MCADDON内にRP候補が複数ある場合は候補一覧のheader UUIDを `--resource-pack` で明示し、先頭候補を自動採用しません。BPスクリプトは実行しません。取込名の条件は HTTP API でも検査します。指定した種類のパックを入れ替えると、その種類の編集差分をリセットします。引数で指定しなかった種類のパックは維持します。

各コマンドは専用のループバックサーバーを空きポートで起動し、本物の HTTP API と Node Worker を経由して処理します。終了時は自分が起動したサーバーを停止します。既に起動しているブラウザ版や別のサーバーは操作しません。

セッションの既定値は、実行ディレクトリ内の `.jsonui-cli/session.json` です。作業場所の混同を防ぐため、明示的な `--session` を推奨します。セッションには元 ZIP の絶対パスが含まれるため、他の PC へ移動する場合は元 ZIP の配置も維持してください。API トークンは保存しません。

## UI を選択する

`list` は UI ファイル、`definitions` はファイル内の定義を一覧化します。`--kind imported` または `--kind vanilla` で対象層を限定できます。

同じ物理パスを両方のパックが持つ場合、`read` と `edit` にも `--kind` を指定して下位バニラ原文を独立して扱えます。省略時は優先される上位原文を対象にします。操作 JSON では `sourceId: "vanilla"` / `"imported"` または一覧の sourceId を使用できます。`--operation` と `--kind` を併用する場合、操作 JSON の sourceId と矛盾する指定は拒否します。

同じファイルに複数の UI がある場合、`--definition` に一覧の `qualifiedName` または `rawKey` を指定します。同じ修飾名が複数ある場合は、継承元を含む完全な `rawKey` を指定してください。候補が一意でなければ `CLI_DEFINITION_AMBIGUOUS` で停止し、先頭の UI を勝手に選びません。

```powershell
node .\local-node\cli.mjs definitions --file "ui/example.json" --session ".\outputs\work-session.json"
node .\local-node\cli.mjs validate --file "ui/example.json" --definition "example.screen" --session ".\outputs\work-session.json"
```

以後の例にある `ui/example.json` や `example.screen` は説明用の名前です。実際の一覧で確認した名前に置き換えてください。別ファイルの継承元は同じ作業領域から解決します。Pocket UI は一覧・原文参照・編集に対応しますが、投影とフレームのプレビューは `POCKET_PREVIEW_BLOCKED` で停止します。

## 原文を直接編集する

現在の原文と、編集対象を指定する JSON Pointer は `read` で取得します。`--out` を指定すると原文だけを別ファイルへ出力します。

```powershell
node .\local-node\cli.mjs read --file "ui/example.json" --out ".\outputs\edited.json" --session ".\outputs\work-session.json"
```

出力した `edited.json` を編集した後、次のコマンドで反映します。

```powershell
node .\local-node\cli.mjs edit --file "ui/example.json" --text-file ".\outputs\edited.json" --session ".\outputs\work-session.json"
```

無効な構文や新しく発生する不正な構造は編集 API が拒否します。失敗した変更はセッションへ保存せず、直前の有効な編集状態を保持します。検査コマンドやプレビューでエラーがある場合は、成功したプレビューとして扱いません。

保存済みの原文編集は `undo` で取り消し、`redo` で再適用できます。別々の CLI プロセスで実行しても、同じセッションの履歴を使用します。

```powershell
node .\local-node\cli.mjs undo --session ".\outputs\work-session.json"
node .\local-node\cli.mjs redo --session ".\outputs\work-session.json"
node .\local-node\cli.mjs status --session ".\outputs\work-session.json"
```

履歴は原文の編集差分を最大 64 件 / 8 MiB まで保持し、セッション全体の 16 MiB 上限も守ります。上限を超えると古い履歴から削除し、`status` の `history.dropped_entries` に数を記録します。大きすぎる単一編集は保存できても取り消せない場合があります。新しい編集を確定すると redo を破棄し、パックを交換すると全履歴を破棄します。取り消し前後は元 ZIP の SHA-256 と原文 revision を照合し、履歴と現状が一致しなければ上書きしません。設定の変更と UI 選択は原文 undo の対象外です。

## 要素の編集・移動・追加・削除

AI やスクリプトからの利用では、PowerShell の引用符処理に依存しない `--operation` を推奨します。操作 JSON は UTF-8 で保存します。

```powershell
node .\local-node\cli.mjs edit --operation ".\outputs\operation.json" --session ".\outputs\work-session.json"
```

文字列やテクスチャ、サイズ、動作設定などは `set` で対象プロパティを変更できます。

```json
{
  "type": "set",
  "path": "ui/example.json",
  "pointer": "/screen/controls/0/title/text",
  "value": "編集後の表示文字"
}
```

`move` は対象要素の `offset` を設定します。これはアンカーからの位置であり、ブラウザ画面上の絶対ピクセル座標ではありません。`read` が返す対象要素のポインターを使います。

```json
{
  "type": "move",
  "path": "ui/example.json",
  "pointer": "/screen/controls/0/title",
  "offset": [12, 24]
}
```

`add` は指定した親の `controls` に要素を追加します。`parentPointer` を空文字列にすると、ファイル直下へ定義を追加します。

```json
{
  "type": "add",
  "path": "ui/example.json",
  "parentPointer": "/screen",
  "name": "new_label",
  "value": {
    "type": "label",
    "text": "追加した文字",
    "size": [80, 12],
    "offset": [10, 10]
  }
}
```

`inherit` は対象要素の定義名にある継承参照を変更します。継承を解除する場合は `baseRef` を `null` にします。循環や解決不能な参照の扱いは、ブラウザ UI と共通の編集サービスが判断します。

```json
{
  "type": "inherit",
  "path": "ui/example.json",
  "pointer": "/screen/controls/0/new_label",
  "baseRef": "common.base_label"
}
```

削除の影響は `planDelete` で取得できます。実際の削除には `delete` を使います。子要素や継承先も削除する場合は `cascade: true` を明示します。影響を確定できない動的参照がある場合は、推測で削除しません。

```json
{
  "type": "planDelete",
  "path": "ui/common.json",
  "pointer": "/base_panel"
}
```

```json
{
  "type": "delete",
  "path": "ui/common.json",
  "pointer": "/base_panel",
  "cascade": true
}
```

JSON Pointer の要素名に `/` が含まれる場合は `~1`、`~` が含まれる場合は `~0` に置き換えます。継承付きのキーは、たとえば `/screen@common.base` のように `@` 以下も含めます。

## 指定フレームを取得する

```powershell
node .\local-node\cli.mjs preview --file "ui/example.json" --definition "example.screen" --frame 30 --fps 60 --out ".\outputs\frame.json" --session ".\outputs\work-session.json"
node .\local-node\cli.mjs preview --file "ui/example.json" --definition "example.screen" --frame 30 --fps 60 --format svg --out ".\outputs\frame.svg" --session ".\outputs\work-session.json"
```

`--frame` は 0 始まりです。上の例は開始から 0.5 秒の状態です。FPS は 1～240、時間は最大 3,600 秒、画面サイズは幅・高さとも 1～16,384 です。

JSON 出力は投影後の原文、選択した定義、検査結果、バインディング・アニメーション評価結果、レイアウトの IR を含みます。内部の `modelId` や `projectionId` はその起動の識別子であり、次回呼出しへ渡すための永続 ID ではありません。次回は元 ZIP とセッション差分から再構築します。

SVG はレイアウト境界を画像として確認する診断資料です。テクスチャ、リソースパックのフォント、ローカライズ済みの文字描画、3D モデルはラスタライズしません。製品キャンバスの見た目や Minecraft 実機画像と一致したという証拠には使えません。

PNG は利用可能な `@napi-rs/canvas` バックエンドを使い、製品キャンバス描画とパック内のテクスチャ・文字グリフ・対応するネイティブモデルから指定時刻の画像を生成します。`status` の `capabilities.png` で利用可否を確認できます。描画バックエンドを利用できない環境では `RASTER_BACKEND_UNAVAILABLE` で停止し、画像を作りません。

```powershell
node .\local-node\cli.mjs preview --file "ui/example.json" --definition "example.screen" --frame 15 --fps 30 --format png --out ".\outputs\frame.png" --session ".\outputs\work-session.json"
```

必要なテクスチャ、文字、動的状態などを解決できなければ既定で PNG を出力しません。調査用として欠落箇所を残した画像が必要な場合に限り、`--allow-partial` を明示します。その場合も `complete`、`diagnostics`、素材の `provenance`、`rendering` を確認してください。`complete:true` は対応する素材が解決できたことを意味し、Minecraft 実機との画素一致を証明しません。未対応のエンジン固有描画や外部状態は診断として残します。

## 設定

次のような `settings.json` を用意します。指定したキーを現在の設定に重ねます。

`font_profile` は `bitmap`（既定）または `observed-smooth`。後者は default 字体を提供資産の観測smooth profileで描画します。原文の明示 smooth は両設定で対応し、unicode/rune は変えません。実機完全一致の認定ではありません。観測用の近似表示であり、対象パックの字体素材と現在の診断を確認してください。

```json
{
  "width": 1280,
  "height": 720,
  "fps": 60,
  "locale": "ja_JP",
  "visibility": "safe",
  "animation_event": "screen.entrance_push",
  "font_profile": "bitmap",
  "mock_data": { "#title": "表示テスト" },
  "collections": {},
  "scroll": {},
  "variables": {}
}
```

```powershell
node .\local-node\cli.mjs settings --file ".\outputs\settings.json" --session ".\outputs\work-session.json"
node .\local-node\cli.mjs settings --session ".\outputs\work-session.json"
```

`mock_data` はバインディング用の代表実行時データ、`collections` はコレクションデータ、`variables` は投影時の変数、`scroll` はノード ID ごとのスクロール値です。使用できる値や再現できる動作は共通レンダラーが対応する範囲に従います。Minecraft クライアントの実行状態そのものを取得する機能ではありません。

### 型付き状態を設定する

フォームやインベントリの代表状態を、共有の型付き状態として設定できます。
次は ActionForm の表示に使う例です。フォームを Minecraft で開く処理ではありません。

```json
{
  "form": {
    "type": "action",
    "title": "表示テスト",
    "body": "選択する項目",
    "buttons": [{ "text": "最初の項目" }, { "text": "次の項目" }]
  }
}
```

`outputs/state.json` に保存して実行します。`--state-file` と通常設定用の `--file` は
同時指定できません。`--replace-state` は以前の代表状態とローカル toggle 状態を
引き継がずに置き換えます。

```powershell
node .\local-node\cli.mjs settings --state-file ".\outputs\state.json" --replace-state --session ".\outputs\work-session.json"
```

生の binding / collection を指定する場合は既存の `settings.json` の
`mock_data` / `collections` を使います。型付き状態を設定する方法と区別してください。

## 選択した UI と依存だけを書き出す

```powershell
node .\local-node\cli.mjs export --file "ui/example.json" --definition "example.screen" --plan --out ".\outputs\export-plan.json" --session ".\outputs\work-session.json"
node .\local-node\cli.mjs export --file "ui/example.json" --definition "example.screen" --out ".\outputs\selected.mcpack" --session ".\outputs\work-session.json"
```

複数の定義をまとめる場合は `selections.json` を指定します。

```json
{
  "selections": [
    { "filePath": "ui/example.json", "rawKey": "screen@common.base" },
    { "filePath": "ui/other.json", "definition": "other.screen" }
  ]
}
```

```powershell
node .\local-node\cli.mjs export --selections ".\outputs\selections.json" --out ".\outputs\selected.mcpack" --session ".\outputs\work-session.json"
```

出力対象と依存関係は、ブラウザ UI と同じ Node の書出しサービスが判断します。必要な参照が未解決なら停止します。同一 JSON ファイル内の選択していない無関係な定義や、使用していない素材まで単純に ZIP へコピーする方式ではありません。成果物を置換する場合だけ `--force` を追加してください。元 ZIP、セッション、アプリ本体は `--force` を指定しても成果物の出力先にできません。

### パック名・説明・バージョン・作者・アイコン

`--pack-options` で次の形式の UTF-8 JSON を指定します。省略した項目は共通書出しサービスの既定値を使います。設定ファイルは 64 KiB 以下にしてください。

```json
{
  "name": "自分の UI パック",
  "description": "選択した画面の配置を調整しました",
  "version": [1, 0, 0],
  "authors": ["作者名"]
}
```

`--pack-icon` は PNG ファイルを指定します。入力上限は 1 MiB です。PNG の内容と寸法はサイトと同じ Node API で検証・正規化し、`pack_icon.png` に保存します。原本画像は変更しません。

コマンドプロンプトでの例です。

```cmd
node local-node/cli.mjs export --file ui/example.json --definition example.screen --pack-options outputs/pack-options.json --pack-icon outputs/icon.png --out outputs/selected.mcpack --session outputs/work-session.json
```

`--plan` でもパック情報とアイコンの検証を行います。UUID は新規生成し、必要な `min_engine_version` は依存関係から決定します。この 2 項目を設定ファイルから上書きする機能はありません。設定ファイル・アイコンを出力先と同じファイルに指定することも拒否します。

### コマンド実行の診断を保存する

```cmd
node local-node/cli.mjs diagnostics --out outputs/diagnostics.json --session outputs/work-session.json
```

`diagnostics` はサイトの一括ログと同じ形式の JSON を保存します。Node の処理・メモリ・パック件数・最近のイベントと、CLI の選択・編集履歴件数・設定を含みます。認証値、機密フィールド、端末の絶対パスは共通処理で伏せます。原文の編集差分やパック全体は診断ファイルへ含めません。

複数操作を `workflow` で実行し、最後に `diagnostics` を置くと、その workflow の同じサーバーで起きた処理を確認できます。単独で起動した `diagnostics` は新しいサーバーで現在のセッションを読み直すため、以前に終了した CLI やブラウザのイベントは復元できません。診断範囲は `current_cli_invocation` として記録します。API の失敗では、終了 JSON の `error.context.response` に秘匿処理済みの詳細、`http_status` と `route` に発生元が記録されます。

API が返した要求 ID は `error.correlation_id` に保存します。同じ値を Node の診断記録で探すと、HTTP エラーと処理内容を対応付けられます。API 側の応答自体に詳細が含まれない場合は、CLI で原因を推測して補いません。

## 複数操作をまとめる

大型パックをコマンドごとに再読込すると時間がかかるため、連続作業には `workflow` を使用します。1 回のサーバー起動と読込を共有します。各成功した変更は都度セッションに保存します。途中のコマンドが失敗すると、完了済みの結果を JSON に含めて停止します。

後続コマンドで読む既存ファイルも、workflow の開始前から入力として保護します。`--force` を指定しても、後で読む設定・パック情報・アイコン・元パックを先行コマンドの出力で上書きできません。途中でパックを交換しても、その呼出しで使った元パックの保護は続きます。開始時に存在しない別名ファイルへ新規に書き出し、その成果物を後続コマンドで取り込む操作は可能です。

`workflow.json` の例です。ディスク上の相対パスは workflow ファイルの場所を基準に解決します。UI の `file` はパック内のパスなので、ディスク上のパスとは扱いが異なります。

```json
{
  "schema": "jsonui-cli-workflow-v1",
  "commands": [
    { "command": "import", "options": { "vanilla": "vanilla.zip" } },
    { "command": "definitions", "options": { "file": "ui/example.json" } },
    { "command": "edit", "options": { "operation": "operation.json" } },
    { "command": "preview", "options": {
      "file": "ui/example.json", "definition": "example.screen",
      "frame": "30", "fps": "60", "out": "frame.json"
    } },
    { "command": "export", "options": {
      "file": "ui/example.json", "definition": "example.screen", "out": "selected.mcpack"
    } }
  ]
}
```

```powershell
node .\local-node\cli.mjs workflow --file ".\outputs\workflow.json" --session ".\outputs\work-session.json"
```

`options` の通常の値は CLI 引数と同じ文字列にします。`force`、`plan`、`cascade`、`live` は JSON の真偽値です。最大 100 コマンドです。入れ子の workflow、シェルコマンド実行、workflow 内で別セッションへ切り替える操作は受理しません。

## 終了・失敗・再開

原文編集の undo / redo とプロセス間の履歴保存に対応しています。API の `interact()` は既知の `activate` / `escape` とローカルトグルの状態更新に対応します。CLI にネイティブのイベントループ・ドラッグ等の操作列再生、音声の実再生、ブラウザのパネル配置設定はありません。詳しくは [現行説明書](../docs/release/manual/USER_GUIDE_JA.md) と [仕様書](../docs/release/manual/TECHNICAL_SPEC_JA.md) を参照してください。CLI の `settings` で変更できるのは、上記に列挙したレンダラー用の設定と代表実行時データです。

通常の `stdout` は `jsonui-cli-result-v1` の JSON 1 件です。`ok: true` は終了コード 0、`ok: false` は非ゼロです。`help` だけは人向けの日本語テキストを表示し、`help --json` では JSON を返します。

元 ZIP の内容が変化した場合は `CLI_SOURCE_CHANGED`、セッションの同時使用は `CLI_SESSION_LOCKED` です。同じ元 ZIP を戻せばセッションを再利用できます。新しいパックへ明示的に切り替える場合は `import` を実行します。

Ctrl+C または通常の終了要求を受けた場合は要求を取り消し、所有サーバーとロックを後始末します。OS による強制終了や電源断では後始末できないことがあります。`.lock` が残った場合、記載 PID の処理が終了し、同じセッションをほかで使用していないことを確認したうえで、その `.lock` だけを削除してください。PID の再利用を誤判定しないため、CLI は古そうに見えるロックを自動破棄しません。

出力は同じディレクトリの一時ファイルに書き、同期要求後に公開します。通常ファイルの保存成功を確認しますが、電源断に対するディレクトリ操作の完全な永続化までは保証しません。新規出力の同名競合を防ぐためハードリンクによる公開を使用します。ハードリンク非対応のファイルシステムでは保存を安全に停止します。

セッションファイルは最大 16 MiB、編集テキストは 8 MiB、ZIP は既存サーバーの 768 MiB 制限に従います。パック内の件数・展開容量・圧縮率・パストラバーサル検査も既存のディスク ZIP 読取経路を使用します。セッションと入力を同時に別プロセスから変更しないでください。


### 投影診断と限定継承観測（R37）

`validate` と `preview` の結果には `stage_diagnostics.projection` を追加します。
JSON 形式の保存成果物にも同じ投影診断を保存します。投影後の検査・描画・保存で
失敗した場合は `error.context.stage_diagnostics.projection` に保持します。
投影 API 自体が失敗した場合は従来の `error.context.result` または
`error.context.response` を確認してください。

`scope:selected_projection` は今回選んだ UI の投影処理が出した診断であり、
パック全体の診断ではありません。ただし現行 resolver の `provenance` は
参照レコードの集合で、条件分岐と依存経路を完全に証明しません。
`dependency_trace` は選択UIの継承処理が実際に試みた辺を記録します。
静的・動的な定義継承、子継承、下位パック参照を区別し、条件付き変数の
再試行で破棄した辺は残しません。`observed_edges` は破棄分も含む実際の試行数です。
各項目が現在のフレームに必須かは、この出力だけから断定しません。
`availability:reported` は配列の取得成功だけを
意味し、診断打切りがないことや、意味論の完了を保証しません。

継承観測は最大2,048辺、JSON化した辺の合計524,288文字、各文字列512文字までです。
省略や切詰めは `capture_complete:false` と件数へ記録します。
factory/gridの全分岐、各生成行の出現位置、フレーム必要性を完全追跡していないため、
`trace_complete` は常にfalseです。`semantic_gate.status:not_evaluated` と
`enforcement:none` は、P02の厳格な意味論ゲートを実装していないことを示します。
GUIでも投影metadataとデバッグ資料の `runtime.resolverDependencyTrace` に保持します。

この追加は観測用です。既存の PNG `diagnostics`、`complete`、終了コード、
`--allow-partial` の意味は変更しません。`complete:true` と投影 error の併存は
引き続き可能であり、「意味論まで合格」と読まないでください。
別の意味論ゲート P02 は依存経路と状態の受入契約を満たしてから導入します。
既存の v1 結果は追加フィールドを受理する読み手に対して互換ですが、
未知フィールドを拒否する読み手は採用前に互換性の確認が必要です。

## 検査コマンド

```powershell
node --test .\local-node\tests\cli13.test.mjs .\local-node\tests\cli-history13.test.mjs .\local-node\tests\cli-raster13.test.mjs
```

この検査は本物の CLI 子プロセス、HTTP、Node Worker、セッション保存、限定 ZIP 書出しを使用します。Windows の実機配送・ZIP 展開・画面操作の実行証拠を代用するものではありません。
