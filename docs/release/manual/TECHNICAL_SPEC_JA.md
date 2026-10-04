# JSON UI Workbench 0.16.1 技術仕様書

[English](TECHNICAL_SPEC_EN.md) · [日本語説明書](USER_GUIDE_JA.md) · [制限・注意事項](LIMITATIONS_JA.md)

本書は配布版 0.16.1 の公開入出力と実装境界を定義します。0.16.1 は 0.16.0 の実行処理を維持したドキュメント・ライセンス整備版です。将来の機能案は現在の仕様に含めません。各種 `passed` は、その検査の対象範囲で確認できたという意味です。

## 1. 対象と入口

対象は Minecraft Bedrock の **Classic JSON UI** です。パックを読み込み、定義を選択し、明示した状態でレイアウト・描画・診断を計算します。Minecraft 本体、Behavior Pack、Script API、screen controller は実行しません。

Pocket JSON UI は一覧・原文参照・編集の対象にできますが、プレビューは禁止します。OreUI、DDUI、スマートフォン向け Pocket/touch UI の再現は対象外です。Classic という描画プロファイルへの対応を、スマートフォン上での利用対応と読み替えないでください。

| 入口 | 状態 | 実行・状態の寿命 |
|---|---|---|
| CLI `local-node/cli.mjs` / `npm start` | 既定 | 1 回の起動で専用 loopback server/Worker を所有。終了時に停止。状態・原文編集はセッション JSON に保存 |
| Node SDK `local-node/api.mjs` | 対応 | `createRenderer()` で server/Worker を作成し、`import()` または `close()` までパックを保持 |
| HTTP `local-node/api-server.mjs` / `npm run api` | 対応 | 認証付きの常駐 loopback API。内部で 1 個の SDK renderer を共有 |
| ブラウザー GUI `npm run gui` | 実験機能 | 明示起動。編集・ポインター操作・ブラウザー音声等の UI アダプターを持つが、ネイティブ実行の証明にはしない |

Node.js は **22.14.0 以降**、公開モジュールは ESM です。PNG には任意依存 `@napi-rs/canvas` 0.1.100 と必要なパック素材が必要です。SDK import 自体はブラウザーや subprocess を起動せず、ファイルを編集・保存しません。

## 2. パックと定義の入力

入力はローカルの ZIP、MCPACK、MCADDON です。MCADDON から選択した Resource Pack を読み込み、Behavior Pack を実行しません。複数 RP があれば RP の manifest UUID を指定します。任意 URL のダウンロード、ディレクトリの直接読込み、ゲームからの状態取得は公開 SDK の import 入力にありません。

スタックは `vanilla` と `imported` の最大 2 層です。同じ定義・素材の優先順位は imported が上です。パック内の UI 定義、グローバル変数、参照・素材をカタログ化してから、選択した定義を投影します。`file` は `ui/example.json` のような **パック内パス**、`pack` は OS 上の **入力アーカイブパス**です。

| selector | 型・制約 | 使用箇所 |
|---|---|---|
| `file` | 空でない文字列、最大 1,024 文字、制御文字なし | definitions / validate / render / interact |
| `definition` | 同上。`id` / `rawKey` / `localName` / `qualifiedName` のいずれかへの一致 | 同上 |
| `kind` | `imported` または `vanilla` | list / definitions / validate / render / interact |

`definitions()` は一覧取得であり、絞込み結果が 0 件・複数件でも `count` / `items` を返します。次の画面選択規則は `validate` / `render` / `interact` に適用します。候補がちょうど 1 個なら selector の一部を省略できます。複数候補は `CLI_DEFINITION_AMBIGUOUS`、候補なしは `UI_DEFINITION_NOT_FOUND` です。名前の雰囲気で画面を選びません。`kind` がなければ同一ファイル・同一 qualifiedName の上位層を優先します。`state` 内の推奨定義は診断用であり、任意の定義を自動追加しません。

## 3. Node SDK の共通契約

```javascript
import { createRenderer, JsonUiApiError } from './local-node/api.mjs';
const renderer = await createRenderer({ language: 'ja' });
try {
  await renderer.import({ pack: 'C:\\packs\\example.mcpack' });
  const result = await renderer.render({
    file: 'ui/example.json', definition: 'example.screen',
    format: 'json', frame: 0, strictSemantics: true,
  });
  console.log(result.quality);
} finally {
  await renderer.close();
}
```

全メソッドは Promise を返します。`close()` 以外の第二引数は任意の `{ signal: AbortSignal }` です。`createRenderer()` に渡した signal は初期化のみ、各処理はその処理用の signal を渡します。`close()` に要求・signal を渡す契約はありません。

要求は通常の JSON 相当オブジェクトです。unknown field、`undefined`、関数、非有限数、循環参照、getter、symbol key、疎配列、独自配列プロパティ、通常オブジェクトでないインスタンス、`__proto__` / `prototype` / `constructor` key を拒否します。要求は受付時にコピーされ、受付後に元オブジェクトを変更しても処理内容は変わりません。

| 公開メソッド | 受理する第一引数のフィールド（列挙以外は拒否） |
|---|---|
| `createRenderer()` | `settings`, `language` |
| `import()` | `pack`, `vanilla`, `resourcePack` |
| `list()` | `kind` |
| `definitions()` | `file`, `definition`, `kind` |
| `status()` | なし / `{}` |
| `validate()` | selector + `settings`, `state`, `strictSemantics` |
| `render()` | selector + `settings`, `state`, `format`, `width`, `height`, `uiScale`, `fps`, `frame`, `allowPartial`, `strictSemantics`, `strictAnimation`, `drawEvidence`, `frameSummary`, `uiInstanceId`, `localToggleState` |
| `interact()` | selector + `settings`, `state`, `width`, `height`, `uiScale`, `fps`, `frame`, `uiInstanceId`, `localToggleState`, `expectedRevision`, `nodeId`, `event`, `inputSource` |
| `resolveSound()` | `soundId`, `selectionSeed`, `contextSampleRate` |
| `close()` | なし |

`strictAnimation` は **render 専用**です。interact は内部で意味論の厳格検査を要求するため `strictSemantics` field 自体を受理しません。`resolveSound()` に任意のファイルパス、`settings`、音声バイト列を渡す契約はありません。

### 作成・読込み・一覧

`language` は `ja` / `en`、既定 `ja`。`settings` は次節の設定です。import は `pack` / `vanilla` の少なくとも一方が必須で、SDK では OS の絶対パス文字列、最大 32,768 文字を指定します。`resourcePack` は `pack` と併用する RP の UUID です。

**SDK の import はスタック全体を交換します。** `import({pack})` は以前の vanilla を引き継ぎません。両方が必要なら毎回両方を指定します。これに対し CLI import は指定した層だけを交換し、指定しない層を保持します。

成功結果の schema は `jsonui-api-import-v1` / `jsonui-api-list-v1` / `jsonui-api-definitions-v1` / `jsonui-api-status-v1` です。import は `sources`（kind/name/size_bytes/checksum_sha256、必要なら resource_pack_uuid）、`file_count`、`definition_count`、`diagnostics` を返します。一覧は `count` / `items` / `diagnostics`。status はパック読込み、処理待ち数、Worker 情報、機能、PNG backend の availability を返します。status の `pending` は実行中の status 要求自体も含みます。

## 4. 設定と CLI の対応

`createRenderer({settings})` はインスタンスの既定値です。validate/render/interact の `settings` はその呼出しだけにマージします。後続要求に保存しません。CLI `settings --file` はセッションにマージ保存します。トップレベルの幅・高さ等の要求値は、対応する settings 値に優先します。

| settings key | 既定 | 受理内容・役割 | SDK / CLI の上書き |
|---|---|---|---|
| `width`, `height` | 1920, 1080 | 出力 pixels、整数 1～16,384。PNG にはさらに小さい上限 | `width`, `height` / `--width`, `--height` |
| `ui_scale` | `auto` | `auto` または整数 1～8。論理座標から出力 pixels への倍率 | `uiScale` / `--ui-scale` |
| `target_engine_version` | `1.26.40` | 妥当な engine version。vanilla 単体の 3D 対象版。imported RP は manifest min_engine_version を優先 | settings のみ |
| `fps` | 60 | 有限数 1～240。frame の秒換算用であり動画エンコード指定ではない | `fps` / `--fps` |
| `locale` | `ja_JP` | `[a-z]{2}_[A-Z]{2}`。パックの文字列とフォント | settings のみ |
| `language` | `ja` | `ja` / `en`。説明・診断の表示言語 | 作成 options / CLI `--language` |
| `visibility` | `safe` | `safe` / `structure`。表示評価または構造調査。structure は実機表示の合格ではない | settings のみ |
| `mock_data` | `{}` | binding に与える値。通常 object、最大 1 MiB | settings のみ |
| `collections` | `{}` | collection の行データ。通常 object、最大 1 MiB | settings のみ |
| `variables` | `{}` | resolver に与える `$` 変数。通常 object、最大 1 MiB | settings のみ |
| `scroll` | `{}` | node ID を key とする明示スクロール状態。最大 1 MiB | settings のみ |
| `event_factory_selections` | `{}` | factory 名と control_ids key の対応。最大 32 件、名称は安全な文字で 1～128 文字 | settings のみ |
| `ui_instance_id` | `jsonui-cli` | 空でない ID、最大 256 文字、制御文字・危険 key 禁止 | `uiInstanceId` / settings のみ |
| `local_toggle_state` | `null` | 次節の local state。最大 1 MiB | `localToggleState` / settings のみ |
| `animation_event` | `screen.entrance_push` | 解析するイベント名、最大 256 文字、制御文字なし | settings のみ |
| `font_profile` | `bitmap` | `bitmap` / `observed-smooth` | settings または state.font_profile |

settings の数値チェックでは数値文字列も数値化します。一方、SDK のトップレベル `width` / `height` / `fps` / `frame` 等は JSON number が必要です。未知の settings key を受理しません。各 runtime map が 1 MiB 以下でも、組合せたフレーム状態の 1 MiB 上限を別途満たす必要があります。

`uiScale: 'auto'` は RP の `build-info.json` の校正値、または Classic 既定 4 倍を使います。width/height は物理出力サイズ、logical_width/logical_height は倍率適用前の canvas サイズです。スマートフォンの GUI scale/touch レイアウトを検出する機能ではありません。

## 5. 型付き state

`state` はプレビュー用 JSON です。ゲーム内状態ではありません。正規化は全体を検査し、不正入力を途中まで適用しません。トップレベルで受理する key は次のとおりです。

`mockData`, `collectionData`, `furnace`, `brewing`, `trade`, `form`, `messageContext`, `inventory`, `slots`, `anvil`, `enchanting`, `horse`, `book`, `font_profile`, `eventFactorySelections`。

**命名が異なります。** state の raw 値は `mockData` / `collectionData`、settings の raw 値は `mock_data` / `collections` です。state を指定すると既定 runtime 値を置換し、variables/scroll/local state を初期化します。同じ要求の settings に `mock_data`, `collections`, `variables`, `scroll`, `event_factory_selections`, `local_toggle_state` があれば空でも `API_STATE_CONFLICT` です。サイズ・言語等の非 runtime 設定は併用できます。

state と明示 `uiInstanceId` / `localToggleState` の併用は可能です。型付き state の正規化後にその local state を適用します。明示 field と settings 内の `ui_instance_id` / `local_toggle_state` を同時指定すると競合です。

| state branch | 入力の構造・範囲 |
|---|---|
| `mockData` | binding 値の object。`__collections` は禁止し collectionData を使う |
| `collectionData` | collection 名 → row object の配列。row 内の `__collections` は nested collection |
| `inventory` | `main` 最大 27、`hotbar` 9、`armor` 4、`offhand` 1、`container` containerSize 件。containerSize は 1～256、既定 27 |
| `slots` | 任意 collection 名 → item/null 配列。最大 128 collections、各 256 rows |
| `furnace` | `progress`, `fuel` は 0～1。`input`, `fuelItem`, `output` は item |
| `brewing` | `progress`, `fuel`, `bubbles` は 0～1。input/fuelItem と outputs 最大 3 items |
| `anvil` | input/material/output は item/null。name/costText は string。costRed/costGreen/invalid は boolean |
| `enchanting` | input/lapis は item/null。offers 最大 3、各 runes/cost/hoverText string、available boolean |
| `horse` | equipment/container は item/null 配列。equipmentSize/containerSize は 1～256、既定 2/15 |
| `book` | title/author string、pages 最大 256 strings、editable boolean |
| `trade` | offers 最大 256、各 input/output 必須 item、secondInput 任意 item/null、unlocked/available boolean。title/tierName string、selected は範囲内の 0 始まり整数、既定 0。offers が空の場合は selected:0 |
| `form` | 下記 ActionForm / ModalForm |
| `messageContext` | form と併用。locale 識別子と明示 translations object |
| `font_profile` | `bitmap` / `observed-smooth` |
| `eventFactorySelections` | settings 相当の明示 factory 分岐 |

item の受理 key は `id`, `count`, `name`, `texture`, `atlasKey`, `variant`, `selected`。count は整数 0～999（既定 1）、selected は boolean。texture は安全な `textures/...` パック相対参照。texture と atlasKey は排他、variant は atlasKey と併用する整数 0～4,095。未知 ID を任意の既存アイテムに置換せず診断します。空スロットを受理する branch では null または省略末尾を空行に正規化します。表示できるアイテムを入力できることは、実機の投入許可・レシピ処理の証明ではありません。

共通上限は UTF-8 JSON 1 MiB、深さ 24、20,000 要素、単一 string 65,536 文字、各 collection 256 rows、各 map 128 collections、nested を含む全体 2,048 rows です。raw `mockData` / `collectionData` は型付き branch による生成値の後に適用するため、同じ key を明示上書きできます。

### フォーム状態

| 種類 | 仕様 |
|---|---|
| ActionForm | `type:'action'`（type 省略も action）、title/body は文字列または対応 RawMessage、buttons は `{text,icon?}` 配列。buttons と elements は排他 |
| ActionForm elements | `{type:'button',text,icon?}`, `{type:'header',text}`, `{type:'label',text}`, `{type:'divider'}`。最大 256 行。selection は button のみ数え、表示行番号と区別 |
| ModalForm | `type:'modal'`, title、submitText、submitVisible:boolean、elements 必須 1～256 行。空 content は拒否 |
| Modal elements | label/header/divider/toggle/slider/step_slider/dropdown/input。共通 text/tooltip は対応 RawMessage |
| toggle | value:boolean、enabled:boolean。既定 false/true |
| input | value:string、placeholder、enabled:boolean。既定空/空/true |
| slider | 従来の value:0～1、または range:{min,max,current,step?}。両者排他。range は min<max、current は範囲内、step>0（既定 1）。range と併用して valueText/displayText を指定可能 |
| step_slider | options 1～256、selected は範囲内の整数、enabled 任意 |
| dropdown | options 1～256、selected は範囲内の整数 |

slider の current/上端が step に一致しなくても勝手に丸めず警告します。ドラッグ操作・実機の丸め処理は別です。既定の推奨定義は ActionForm `server_form.long_form`、ModalForm `server_form.custom_form`。`eventFactorySelections.server_form_factory` に long_form/custom_form を明示した場合は、対応する祖先 `server_form.main_screen_content` の選択を推奨します。

RawMessage は `text`、`rawtext`、`translate` と `with` の対応部分です。translate は明示 messageContext.translations だけを使い、ゲームの翻訳・score を取得しません。対応置換は `%s` / `%%1` 等。未定義訳・不足引数・未対応構文を拒否します。単一展開 64 KiB、総出力 1 MiB、深さ 24、4,096 nodes を別に制限します。

## 6. validate / render と出力形式

validate は投影後の UI model を検査します。render はさらにフレームを評価します。validate は collection の実行時行・表示入力 binding・資産描画を評価しません。静的な記録済み非対応プロパティは validate でも診断します。

| render field | 既定・制約 |
|---|---|
| `format` | `json`、`svg`、`png`。既定 json |
| `width`, `height` | settings に従う。JSON number の整数 1～16,384 |
| `uiScale` | settings に従う。auto / 整数 1～8 |
| `fps` | settings に従う。有限 number 1～240 |
| `frame` | 0 始まり整数。API 受付上限 864,000、さらに pipeline 上限 fps×3,600。JSON/SVG は既定 0、PNG は既定 round(fps) |
| `strictSemantics` | boolean、既定 false。意味論・評価・行参照・表示入力 binding・記録済み非対応プロパティの非 passed で停止 |
| `strictAnimation` | boolean、既定 false。animation quality の非 passed で停止 |
| `allowPartial` | boolean、既定 false、PNG 専用。調査用の不完全 PNG を許可。strict 判定に優先しない |
| `drawEvidence` | boolean、既定 false、PNG 専用。最終描画入力を上限付きで追加 |
| `frameSummary` | boolean、既定 false。JSON 専用、strictAnimation と併用不可。件数・打切り情報のみ、renderable:false |
| `uiInstanceId` | local state の instance ID。省略時 settings 値 |
| `localToggleState` | 明示する場合 uiInstanceId が必須 |

時刻は `frame/fps` 秒であり、PNG 既定は入口アニメーション開始約 1 秒後です。開始瞬間には frame:0 を明示します。API の fps に小数を指定できても frame 自体は整数です。

| 形式 | SDK 結果と意味 | CLI / HTTP |
|---|---|---|
| JSON | `schema:'jsonui-api-render-v1'`, ok:true, format:'json'。viewport、time、selected、投影 document、validation、frame IR、quality、stage_diagnostics を含む。描画 pixels は含まない | CLI は stdout または .json。HTTP は result 内の object |
| SVG | 同じ render schema、format:'svg'、`svg:string` と metadata。実レイアウトの矩形境界図。テクスチャ・glyph・3D の完成画像ではない | CLI は --out .svg 必須。HTTP result.svg は string |
| PNG | 同じ render schema、format:'png'、`png:Buffer` と metadata。素材・フォントの測定後に再配置し最終画面を描画 | CLI は --out .png 必須。HTTP は下記 base64 object |
| validate | `schema:'jsonui-api-validation-v1'`, ok:true、validation・quality・stage_diagnostics 等。検査 error は例外 | CLI は JSON。HTTP は result 内 |

PNG metadata は `complete`, `preview_complete`, `draft`, `diagnostics`, `native_equivalence`, `provenance`, `final_frame_summary`、animation/binding/collection quality を含みます。`final_frame_summary` は実資産測定後の件数・frame/hash・box digest・再配置回数の有界情報です。全 frame の sidecar ではありません。JSON の座標は測定前、PNG の最終座標は測定後です。

## 7. 品質と失敗の意味

| quality axis | 判定対象 |
|---|---|
| `semantic` | 選択した投影の継承・参照・解決。無関係な catalog 全体の合否ではない |
| `native_properties` | 実機記録で確認した非対応プロパティ。全 JSON UI schema の保証ではない |
| `evaluation` | 有界な展開・走査・評価の完了 |
| `collection` | collection_panel / stack_panel / grid の行所有・行番号・参照 |
| `bindings` | 表示・入力の状態、保存 local state を含む解決 |
| `animation` | 明示時刻における対応 animation と観測範囲 |
| `state` | 型付き状態の正規化。ゲーム状態の完全さではない |
| `assets` | PNG で用意した素材。JSON/SVG では not_evaluated |
| `interaction` | 通常描画では Script API / ゲーム入力を実行しないため not_evaluated |
| `native_comparison` | Minecraft pixels の比較。通常 not_evaluated |

`complete` は raster の資産描画、`preview_complete` は対応範囲の資産・評価・collection・表示入力 binding・記録済みプロパティの完了です。animation は独立した strictAnimation 軸です。`ok:true`、`passed`、`preview_complete:true` のどれも、実機の全画素・全入力・発音との一致認定ではありません。

代表的な失敗 code は `CLI_SEMANTIC_GATE_FAILED`, `CLI_EVALUATION_INCOMPLETE`, `CLI_COLLECTION_GATE_FAILED`, `CLI_NATIVE_PROPERTY_GATE_FAILED`, `CLI_BINDING_GATE_FAILED`, `CLI_ANIMATION_GATE_FAILED`, `RASTER_BACKEND_UNAVAILABLE`, `NODE_FRAME_REPLY_LIMIT`。code は安定した識別用、message は表示用です。

記録済み非対応には label の `vertical_alignment`、受動 panel/image の `focus_enabled`、通常の直近親に置いた `collection_index` を含みます。未知の将来 field を一律削除・禁止する仕組みではありません。animation の offset/size/uv にある `looping` は別の animation 診断です。診断を打ち切った場合は complete な観測とせず unknown 等を示します。

## 8. interact と local state

interact は **呼出し側が状態を保管する stateless projection** です。server に最新の UI session を保存せず、毎回指定された定義・state・local state を投影して入力を評価します。必要な field は uiInstanceId/nodeId/expectedRevision と、候補を一意にする selector です。

| field | 仕様 |
|---|---|
| `uiInstanceId` | 空でない安全な ID、最大 256 文字 |
| `nodeId` | 現在の JSON frame に実在する node ID、最大 1,024 文字。caption や配列 index ではない |
| `expectedRevision` | 非負 safe integer。渡した local state の revision と一致する必要あり |
| `localToggleState` | 任意。省略時はその UI の初期状態を評価 |
| `event` | activate / escape、既定 activate |
| `inputSource` | mouse / keyboard。既定は activate→mouse、escape→keyboard |

local state の形式:

```json
{
  "version": 1,
  "instanceId": "inspection-1",
  "revision": 0,
  "values": { "current-node-id": false }
}
```

values は現在の UI の writable local toggle ID → boolean、最大 20,000 件。現在の全 local ID は JSON render の `frame.bindings.localToggleState` から取得します。外部 binding が所有する toggle は local state で上書きできません。radio は同じ親の明示 group に限って排他選択を扱います。

入力 mapping は mouse activate に対する `button.menu_select` の pressed と、keyboard escape に対する menu_cancel/menu_exit の global を確認します。`input_mode_condition` は省略または not_gamepad だけを扱い、touch/gamepad/gaze を推測しません。複数 action の実行順が不明なら実行しません。hidden/disabled/ignored/描画外の対象は blocked、未知 action は unsupported と診断します。

結果は `schema:'jsonui-api-interaction-v1'`, ok:true、`execution:'stateless_preview_projection'`、selected/node_id/ui_instance_id/previous_revision、projection/form_descriptor の SHA-256、interaction/status/effects/diagnostics、localToggleState、audioIntent、quality、stage_diagnostics、effects_executed、playback/native_equivalence です。blocked/unsupported は API 処理成功の結果として返る場合があるため、ok だけで操作成功としません。

適用する effect は **localTogglePatch だけ**です。正常適用ごとに revision が 1 増えます。mockPatch/collectionPatch/close/navigate/chooseNavigate/clipboard 等は有限アダプターの記述であり、SDK は実行しません。フォーム応答の送信、フォームの閉開、BP への保存もありません。返された local state を次の interact/render に渡すことで同じ UI instance の見え方を変更できます。

別 instance、revision 不一致、未知/readonly ID を拒否します。ただし **古い snapshot と一致する古い expectedRevision を一緒に渡す再評価は可能**です。これはサーバー保存式の完全な stale 操作防止ではありません。複数クライアントの最新性・排他は利用側が実装します。

音声 intent は mouse activate の有効な対象に限定します。keyboard/escape は発音要求にしません。未解決 sound_name/volume/pitch binding、capture 不完全、無効・非表示状態から古い値を使った要求を生成しません。soundName/soundVolume/soundPitch/originScreenId/interactionId は要求の記述です。音声要求と action の対応可否は独立しているため、未知 action が unsupported でも有効な sound_name があれば intent を返す場合があります。intent は音源解決・再生完了の結果ではありません。

## 9. resolveSound と音声

soundId は登録された sounds/sound_definitions.json の ID（最大 256 文字、制御文字・`$`/`#` 禁止）。selectionSeed は任意 string 最大 256、既定空。contextSampleRate は整数 8,000～192,000、既定 48,000 です。

解決順は上位の imported 定義、その ID がなければ vanilla 定義です。音声ファイルは別に imported → vanilla の順で探索します。上位層に参照先の候補ファイルがない場合は、下位層の同じ参照先を探します。上位層にあるファイルの形式競合・曖昧さ・非対応形式・事前検査失敗は、下位音源への切替で回避しません。定義とファイルの所有層が異なる場合があり、結果には両方を記録します。拡張子明示はその形式、拡張子なしは同じ stem の OGG/WAV が一意なときだけ解決します。

対応は短い **Ogg Vorbis** と **WAV PCM16**。音源最大 4 MiB、10 秒、mono/stereo、8,000～192,000 Hz、PCM 予約上限 8 MiB。定義最大 8 MiB、50,000 sound IDs、1 定義 64 候補。stream:true、FSB、MP3、Opus、chained OGG 等は非対応です。候補 pitch は 0.5～2、volume は非負有限数、weight は整数 1～1,000,000。definition 直下 volume/pitch はこの resolver では非対応です。

複数候補は soundId と selectionSeed の SHA-256 による安定した weight 選択 `sha256-weighted-v1` です。Bedrock の乱数選択との一致を主張しません。OGG は header/page/CRC/sequence/packet/EOS/長さ/PCM 予約を事前検査します。**完全な Vorbis decoder ではなく**、ネイティブ decoder のメモリをハード上限で拘束するものでもありません。

結果は `schema:'jsonui-api-sound-v1'`, ok:true、sound object（`jsonui-sound-v2`）と playback:'not_executed' / native_equivalence:'not_evaluated'。sound には定義・ファイルのパック/パス、codec/container、channels/sampleRate/duration、encodedBytes、contentRevision（ファイル SHA-256）、候補/index/選択 policy、音量/pitch/category/is3D、warnings 等を返します。**音声バイト列は返さず、SDK/HTTP/CLI はスピーカー再生しません。**

GUI の音声 player は別途 browser decode/play を試みます。category 別ゲーム mixer・position/distance は適用せず warning を残します。audibleVerified/nativeVerified/gameMixerVerified は false。形式検査・復号成功だけで聞こえたことを認定しません。

## 10. HTTP transport

`createRendererServer({port?,signal?})` は `local-node/api-server.mjs` の公開 factory。port は整数 0～65,535、既定 0（自動割当）、bind は 127.0.0.1 固定。返す connection は schema/base_url/token/pid、close は冪等な終了 Promise です。JSON 要求に signal を埋め込みません。

| route | 認証・本文 |
|---|---|
| GET /health | token 不要、本文なし。稼働確認のみ |
| POST /api/renderer/v1/import | SDK import object |
| POST /api/renderer/v1/list | SDK list object / {} |
| POST /api/renderer/v1/definitions | SDK definitions object |
| POST /api/renderer/v1/validate | SDK validate object |
| POST /api/renderer/v1/render | SDK render object |
| POST /api/renderer/v1/interact | SDK interact object |
| POST /api/renderer/v1/sound | SDK resolveSound object |
| POST /api/renderer/v1/status | {} |

health 以外は `Authorization: Bearer <64桁hex token>`、`Content-Type: application/json` を要求します。Host は割当済み `127.0.0.1:port` と厳密一致。Origin 付き要求または sec-fetch-site が none 以外の browser 要求を拒否します。CORS/remote 公開を提供する endpoint ではありません。

成功は `{schema:'jsonui-renderer-http-v1',ok:true,correlation_id,result}`、失敗は同じ schema の ok:false/error、非 2xx status。error は code/message/category/retryable/correlation_id/details/context。SDK は result を二重に包みません。

PNG の result.png は `{encoding:'base64',media_type:'image/png',size_bytes,checksum_sha256,data}`。SVG は result.svg の string。HTTP に保存先を渡す API はありません。8 同時要求、32 接続、要求 JSON 16 MiB、応答 JSON 64 MiB、本文受信 30 秒。base64 で容量が増えるため大きな PNG は HTTP 応答上限で失敗し得ます。応答は no-store / nosniff、要求 ID header、Connection:close を付けます。

代表 status は未認証 401、Host/Origin 拒否 403、route 不明 404、method 違い 405、content type 415、容量 413、過負荷 429、本文 timeout 408、処理 timeout 504、cancel 499。全 code の固定分類表ではなく、実応答 code/context を確認します。

CLI server 起動の connection-file は新規作成専用。停止後も descriptor を残し、token は server 停止とともに失効します。file の存在を server 生存の証明としません。再起動には別パスか、停止済みの自分の旧 descriptor を確認して削除します。Unix mode 0600 が Windows ACL を完全制御するという保証はありません。

## 11. CLI 操作と永続状態

CLI 成功・失敗 envelope は `jsonui-cli-result-v1`、通常 stdout は JSON 1 件。help は人向け text、`help --json` は JSON。失敗は非ゼロ終了します。標準 session は `.jsonui-cli/session.json`、`--session` で変更可能。`--language` → JSONUI_LANGUAGE → 保存 language → ja の順で表示言語を選びます。

| command | 入力・動作・主な出力 |
|---|---|
| import | --pack / --vanilla / --resource-pack。指定層を交換、原文差分・履歴をリセット |
| list / definitions / read | 層/定義一覧、原文 read。read の --out は .json/.jsonc |
| settings | --file の raw 設定を保存、または --state-file の typed state を保存。両者排他。既存 runtime 置換には --replace-state |
| validate / preview | selector + 厳格 flag。preview は --format json/svg/png、--out、frame/fps/size/scale |
| interact / resolve-sound | --request-file に SDK と同じ JSON。返した操作状態を session に自動保存しない。--out は JSON |
| draft | --operation と selector。未確定 frame JSON を計算。原文・session・履歴を変更せず、草稿 PNG は未提供 |
| edit | --operation、直接 --text-file 置換、または set/move/add/inherit/planDelete/delete の原文操作。変更は session 差分に保存 |
| undo / redo | 保存履歴を復元。source revision が一致しない場合は拒否 |
| export | --file/--definition/--kind または --selections。依存計画・検査を実施し、--out .mcpack/.zip で生成。--plan は計画のみ |
| diagnostics / status | 現呼出しの診断、保存状態。status --live は source hash と作業領域も確認 |
| workflow | --file の commands を順に処理。server を共有し、成功変更を都度保存。途中失敗時は completed/failed_index を報告 |
| features / help | 機能境界 / 説明 |

原文編集の pointer は JSON Pointer。set の value は JSON、move の value は offset、add/inherit の parent-pointer/name/base-ref/index を明示します。画面限定操作は生成要素・未解決参照・継承の安全条件を検査します。delete では事前 plan と必要な cascade を使用し、未確認の広範な削除を行いません。詳細な operation object の版付き契約は既存の [CLI 詳細](../../../local-node/CLI-ja.md) も参照してください。

export selections は 1～256 件。pack-options は name 120 文字、description 1,024、version は 3 個の整数 0～65,535、authors 最大 16×80 文字。pack-icon は PNG 最大 1 MiB/2,048 辺で、CRC を確認し透明余白付き 256×256 に変換します。未解決の依存参照を黙って落として成功としません。

session は元 archive の絶対パス・SHA-256・size、原文 overrides、設定、選択、履歴を保存します。原本の内容が変われば復元を停止します。履歴は最大 64 件/8 MiB、古い履歴の除去は status に報告。session lock は同じファイルの同時利用を拒否します。

## 12. 内部処理と描画対象

1. archive のサイズ・entry・path・CRC 等を検査し、処理用の登録を作成。
2. UI/変数/素材の catalog を構築、上位層と一意な定義を選択。
3. 継承、controls、変数/default/conditional、対応 modifications、明示 factory branch を投影し、原文由来と依存診断を保持。
4. model validation と記録済み native property 検査を実施。
5. 明示 mock/collection/local state と animation の絶対時刻を評価し、layout boxes/frame IR を生成。
6. JSON は IR、SVG はその境界図。PNG はパック素材/localization/font を取得・測定して必要な再配置後に raster 描画。
7. 最終 quality/diagnostics/digest を返却。ファイル保存・session 更新は CLI/呼出し側の別責務。

通常 palette は screen/panel/collection_panel/label/button/dropdown/image/input_panel/stack_panel/grid/scroll_view/edit_box/toggle/scroll_track/scrollbar_box。custom/factory/tooltip_trigger は保持・認識しても、全 runtime を一般描画できるという意味ではありません。未知 field は model に保持しますが、未対応描画機能の忠実な再現は保証しません。JSONC を parse した model は comment を保持しないため、投影・生成結果を原本と byte 同一とは扱いません。

binding は公開 JSON UI の global/collection/view 等の対応部分と明示状態を評価します。ゲームの不透明な renderer data、Molang 全体、controller による値の生成は実行しません。collection_index は直近の collection owner と行 context を確認し、panel だけを挟んだ場合にも任意の祖先へ飛ばして正当化しません。

画像は対応するパック内 PNG/JPEG 等の resource と texture sidecar、UV・nine-slice 等の対応 drawing contract を使います。実フォントが足りなければ厳格 PNG を停止し、OS フォントで不足を黙って補いません。bitmap profile と observed-smooth profile は明示選択し、後者は観測近似です。公開配布版に proprietary な Minecraft font/texture/model 一式は含めません。

native renderer は限定された item/progress/モデル等の安全な surrogate を持ちます。player/horse/book 等の資産に基づく 3D 表示は deterministic な orthographic snapshot であり、Bedrock の shader/lighting/Molang/render pipeline 全体ではありません。geometry/texture の不足・未知機能・上限超過を検出します。

animation は alpha/offset/size/uv/color/wait/flip_book の対応部分、有限な next chain、絶対時刻 sample を計算します。easing は linear と in/out/in_out の quad/cubic/quart/quint/sine/expo/circ/back/elastic/bounce。定義/track 最大各 2,048、chain 64、定義総量 2 MiB。イベント副作用、activation/reset、描画される瞬間の native clock 等は別途非対応診断です。

## 13. 主要上限とライフサイクル

上限は保証する処理容量ではなく拒否境界です。異なる層の上限が併存し、先に到達した上限で失敗します。これらの値を超える UI が実機で不正という意味でもありません。

| 対象 | 現行の主な上限 |
|---|---|
| SDK JSON | 16 MiB、20,000 要素、深さ 32 |
| SDK 受付済み処理 | 実行中を含む 8 件、1 renderer 内は直列 |
| ZIP | 入力 768 MiB、120,000 entries、central directory 128 MiB、展開総量 2,048 MiB、1 entry の展開後 64 MiB / 圧縮時 128 MiB |
| 展開比率 | 展開後 8 MiB 以上の entry で 200 倍超を読込み拒否。圧縮爆弾対策に使う |
| 内部登録・upload | 登録 pack 最大 4（公開 stack は最大 2 層）、作業 disk bytes 2,304 MiB、upload 300 秒 |
| Worker 処理 | 通常 job 120 秒、projection 30 秒。batch 等は別の上限 |
| 共通 screen model | 既定 20,000 nodes/depth 200。validate / interact の model 検査に適用し、frame 側の上限だけを満たせばよいとはしない |
| frame | model 50,000 nodes/depth 256、layout 5,000 boxes、組合せ state 1 MiB、reply 24 MiB |
| PNG | 各辺 8,192、16,777,216 pixels、decoded resources 128 MiB、512 assets、64 font sheets、131,072 文字、120 秒、encoded PNG 96 MiB |
| 3D surrogate | 256 bones、2,048 cubes、2,048 draw faces/work units、bone depth 64、motion mesh 2 MiB |
| 記録済み property 診断 | 生成診断 256、quality 証拠は最大 64 件。省略数・capture 完了を別記 |

SDK/HTTP のパックは無操作 30 分で自動削除しません。import/close まで保持します。通常の worker/cache 上限、容量制限は維持します。Worker が復旧し接続 token/generation が変われば stack を無効化し `API_REIMPORT_REQUIRED` 等を返します。以前の projection ID を再利用せず import し直します。

取消 signal は受付・待機・処理の各境界で検査します。待機要求は prompt に拒否されても、予約された queue slot は直列 task がそこへ到達してから解放します。同期処理・OS 操作を即座に停止できる保証ではありません。close は新規受付を止め、所有処理を cancel、server/Worker と queue の終了を待ちます。複数 close は同じ Promise にまとまります。

import 失敗時は新規登録を片付け、通常は旧 stack を保持します。cleanup が失敗して登録を安全に追跡できなければ renderer を閉じ、context に recreate_renderer_required/import_cleanup 等を返します。取消の通知が cleanup 完了より早く返ることがあります。

HTTP の複数 clients は **同じ stack** を共有します。一人の import が他の client にも影響します。独立したパックの処理には別 renderer/server を用意します。TCP 接続切断はその要求の取消、server close は全体終了です。

## 14. ファイル保護・errors・検証根拠

CLI の出力は拡張子/通常 file/path を検査し、元 archive、要求 file、アプリ本体への上書きを拒否します。新規作成が既定、成果物だけ --force で置換。兄弟 temporary file を sync してから final 名を公開し、親 directory の電源断 durability までは保証しません。SDK/HTTP は保存を行わないので、利用者の writeFile は利用者が原本保護・上書き policy を実装します。

SDK は JsonUiApiError を throw し、code/message/category/retryable/correlation_id/details/context を持ちます。内部 error は non-enumerable cause。公開診断は sanitize しますが、入力内の private 情報を無条件に公開共有してよいという意味ではありません。HTTP token と connection descriptor は認証情報です。

0.16.0 の既存検証記録は Node 3,163 success・39 skip、共有 core 533 success、28 状態の strict PNG、39 操作、サンプル OGG 全復号です。これらは **0.16.0 の履歴**であり、0.16.1 の新規検査数や Minecraft/browser の実行結果として計上しません。現配布版の文書・package 検査結果はリリース報告を参照してください。

本書の実装参照は `local-node/api.mjs`, `api-request.mjs`, `api-server.mjs`, `api-interaction.mjs`, `preview-settings.mjs`, `preview-pipeline.mjs`, `cli.mjs`, `cli-files.mjs`, `limits.mjs`, `frame-ir.mjs`, `frame-raster-assets13.mjs`, `sound-resolver.mjs`, `audio-preflight.mjs`、および `editor-core/src` の preview-state / preview-animation / local-toggle-state / native-property-diagnostics / native-model-preview です。
