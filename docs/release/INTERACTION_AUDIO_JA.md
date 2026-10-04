# 0.16.0 操作・音声APIガイド

CLIを既定の入口、Node APIと認証付きループバックHTTPを反復処理の入口とします。未完成のGUIは `npm run gui` で明示的に起動する実験機能です。共通エンジンを削除した別実装は作っていません。

## ローカル操作を引き継ぐ

`interact()` は指定したUI・フォームデータ・ローカル状態から入力を評価し、対応するローカルトグルの差分を適用します。新しいフォームを作成する処理や、MinecraftのScript APIを実行する処理は含みません。

Node APIでは次の順序で呼び出します。`selector` と `nodeId` は、読み込んだパックの `definitions()` とJSONプレビューのノードIDから指定します。フォームの `state.form` を使用する場合は全要求で同じ値を渡します。

```javascript
// renderer は createRenderer() と import() を済ませたインスタンス。
// selector は { file, definition, state?, width?, height?, uiScale? }。
const uiInstanceId = 'inspection-1';
const initial = await renderer.render({
  ...selector, format: 'json', frame: 0, uiInstanceId,
  strictSemantics: true,
});
let localToggleState = initial.frame.bindings.localToggleState;
const nodeId = targetNodeId; // 現在のJSONフレームにある操作対象ID

const changed = await renderer.interact({
  ...selector, uiInstanceId, localToggleState,
  expectedRevision: localToggleState.revision,
  nodeId, event: 'activate', inputSource: 'mouse', frame: 0,
});
localToggleState = changed.localToggleState;

const next = await renderer.render({
  ...selector, format: 'png', frame: 0,
  uiInstanceId, localToggleState, strictSemantics: true,
});
// next.png はPNG Buffer。保存先の保護は呼出し側が行います。
// changed.audioIntent は再生要求の記述。ここでは発音しません。
```

`uiInstanceId` は別のUIインスタンスからの状態を混ぜないためのIDです。`expectedRevision` は要求に渡した状態の更新番号との一致を検査します。サーバーが最新版を保存している方式ではないため、過去の状態とその番号を一緒に渡せば再評価できます。多人数の同時操作で最新状態を保証する必要がある場合は、呼出し側で状態保管と競合管理を行ってください。

未知・非トグル・外部bindingが所有するIDは操作用の保存状態に使用できません。厳格な描画でも未解決bindingとして拒否します。操作APIの `LOCAL_TOGGLE_NODE_UNKNOWN` への変換は、その不整合だけが原因と確認できた場合に限定し、他のbindingエラーを隠しません。

評価する入力は `event: 'activate' | 'escape'` と `inputSource: 'mouse' | 'keyboard'` です。非表示・無効な対象や、現在の描画に存在しない対象は操作しません。音声要求はGUIと同じマウスのactivate経路で評価します。キーボードやescapeをマウスクリック扱いにはしません。

`interaction.effects` のうち実行するのは `localTogglePatch` だけです。ナビゲーション、フォーム送信、クリップボード等は記述として返します。`effects_executed`、`playback: 'not_executed'`、`native_equivalence: 'not_evaluated'` を確認してください。

## OGG等の音源を調べる

ボタンの評価で返された `audioIntent.soundName`、またはパック内に登録されたサウンドIDを使います。

```javascript
if (changed.audioIntent) {
  const resolved = await renderer.resolveSound({
    soundId: changed.audioIntent.soundName,
    selectionSeed: 'inspection-1',
    contextSampleRate: 44100,
  });
  console.log(resolved.sound);
}
```

`resolveSound()` は登録された音源だけを解決します。任意のOSファイルを読むAPIではありません。参照先、ファイルSHA-256、形式の事前検査、音量・pitch等のメタデータと診断を返します。音声バイト列の返却やスピーカー再生は行いません。GUIの既存の音声プレーヤーは、共有された音声要求と解決結果を使ってブラウザー再生を試みます。

未解決の `sound_name` / 音量 / pitch のbindingや、観測不完全な音声bindingから、残存した古い値で音声要求を発行しません。Minecraftのカテゴリ別音量と位置音響はブラウザーの同等機能として再現していないため、その制限を解決結果とプレーヤーの診断に残します。音源解決やOGGの復号成功は、実機またはブラウザーで聞こえたことの証明にはなりません。

## HTTPとCLI

HTTPは既存のBearer認証を付け、`POST /api/renderer/v1/interact` と `POST /api/renderer/v1/sound` を使用します。要求本体は上記のNode APIと同じJSONです。接続ファイルの扱いは[入口ガイド](ENTRYPOINTS_JA.md)を参照してください。

CLIでは読込済みセッションと要求JSONを指定します。

```sh
node local-node/cli.mjs interact --request-file inputs/interaction.json --session outputs/session.json
node local-node/cli.mjs resolve-sound --request-file inputs/sound.json --session outputs/session.json
```

操作結果の `localToggleState` を次の要求JSONへ明示的に渡します。この2コマンドは入力パック、要求ファイル、セッションへ操作結果を自動保存しません。`interact` は返す状態を呼出し側が管理する方式です。

## 検査結果の読み方

`quality.native_properties` は、記録済みの非対応プロパティに対する検査軸です。全Minecraft JSON UIスキーマや全プロパティを検証したという意味ではありません。既知の非対応があれば `failed`、観測が欠ければ `unknown` とします。

`--strict-semantics` / `strictSemantics: true` のvalidate・JSON・SVGと、既定の厳格PNGでこの検査を適用します。部分描画を明示的に許可した場合も診断を残します。`preview_complete` は対応範囲の検査の完了を表し、実機一致・動作・発音の合格証ではありません。0.15.1からの `collection_index` と `offset` の `looping` の診断も保持しています。
