# Vanilla Resource Packの準備と検証

このエディターでVanilla系JSON UIを目的に近い状態でプレビューするには、対象Minecraft Bedrock版に対応するVanilla Resource Packが原則必要です。カスタムPackだけでは、継承元UI、グローバル変数、UI texture、font、langが不足することがあります。

## 取得

1. Microsoft Learnの「Comprehensive List of Pack Contents」から公式Vanilla Resource Packリンクを開きます。
2. Mojang公式`bedrock-samples`のreleaseで、実機Minecraft Bedrockと同じstable/preview系列を選びます。
3. `full` assetを取得します。`min`はbinary assetを含まないため、texture/font previewの基準には不十分です。
4. ダウンロードしたZIPの配布条件はリポジトリのMinecraft EULA参照に従います。本成果物にはVanilla Pack本体を再配布しません。

## 版の固定

次を同じ実機セッション記録に残してください。

- Minecraft Bedrockの表示版
- stableまたはPreview
- Mojang release tag
- `full` assetの正確な`browser_download_url`
- Vanilla ZIPのSHA-256
- 取得時刻

manifestのPack versionだけからBedrock releaseを推測しません。release tagと実機版を別入力として照合します。

## 構造監査

Node.js 24以降で次を実行します。ローカルpath、元filename、asset URL自体はJSONへ出力しません。例の変数は実際の公式release画面から転記してください。

```powershell
$assetUrl = "https://github.com/Mojang/bedrock-samples/releases/download/<tag>/<full-asset-name>.zip"
$sessionId = "<copied-site-diagnostic-session-id>"
npm run --silent audit:vanilla -- "C:\path\to\vanilla.zip" `
  --expected-bedrock-version 1.26.40.5 --expected-channel stable `
  --source-release v1.26.40.05 --source-channel stable `
  --source-asset-url $assetUrl --session-id $sessionId |
  Out-File -Encoding utf8 vanilla-audit.json
```

`validation_status=PASS`には、Resource Pack manifest、`ui/_ui_defs.json`、`ui/_global_variables.json`、`ui/hud_screen.json`、`ui/ui_common.json`のJSON parse、`texts/en_US.lang`の非空entry、UI texture、font、完全な版・channel照合に加え、GitHub Releases API上の同一assetの`digest`とローカルZIPのSHA-256一致が必要です。URLの形だけ、または自己計算SHAとの一致だけではPASSになりません。APIへ接続できない、asset digestが公開されていない、版が不明、patch系列だけ一致、不一致、一部不足のいずれかは`WARN`です。

GitHub APIのrelease assetには`browser_download_url`とSHA-256 `digest`が含まれます。CLIは正確なURLでassetを特定し、オンライン取得したdigestへローカルZIPを結合します。API応答を取得できない環境では真正性を断定しません。

## サイトでの使用

1. 左の「パック構成」で、編集対象Resource Packを「プレビュー用パック」に追加します。
2. 同じカードの「Vanilla基底」に、対応する公式`full` ZIPを追加します。プレビュー用パックが上位、Vanillaが下位です。
3. 必須UI、texture、font、languageが揃っていれば、版情報を入力していないZIPも`READY_UNVERIFIED_VERSION`としてwarning付きで使用できます。明示した版・channelが不一致のZIP、または構造不足のZIPは使用しません。
4. 「表示するUI」でファイルと定義を選び、source表示が「プレビュー用 → Vanilla基底」になったことを確認します。

正式な監査証跡が必要な場合は、サイト診断session ID、CLIの`READY_VERIFIED_INPUT`記録、site診断JSONを同一sessionへ結合します。Debugで対象版、release tag、双方のchannelを設定し、ブラウザー側でも`READY_DECLARED_VERSION_MATCH`を確認してください。版未照合のまま利用できることを、公式入力または実機一致の証明と読み替えてはいけません。

構造監査のPASSはMinecraft Bedrock本体での正しい描画を証明しません。ゲーム本体のContent Logと対象画面スクリーンショットを別gateで提出してください。
