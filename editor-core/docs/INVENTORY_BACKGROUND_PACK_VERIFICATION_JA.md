# Inventory Background Pack 検証記録

検証日: 2026-09-02 UTC
対象: `inventory-background.zip`
対象プロファイル: Minecraft Bedrock Classic UI

## 1. 結論

本パックは破損した単体UI一式ではなく、Minecraft BedrockのVanilla JSON UIへ重ねる疎なClassic用オーバーレイである。添付パックを上位、対象ゲーム版と一致するMojang公式Vanilla Resource Packの`full` ZIPを下位に置いた構成では、通常インベントリ、全画面Creative、製図台、ビーコン、ホッパーの5画面について、静的な定義解決、空スロット骨格、背景クラスおよび安全なlayout box生成が最終smokeを通過した。

判定は次のように限定する。

- `PASS`: 添付ZIPの完全性、静的依存グラフ、上記5画面のClassic設計時プレビュー。
- `CONDITIONAL`: 対象版と一致する公式Vanilla `full` ZIPが必須であり、パック単体または`min` ZIPでは同じ判定にならない。
- `NOT CLAIMED`: Minecraft本体のruntime binding、collection内容、factory、custom renderer、入力状態、animation、font metricおよび全pixel一致。
- `UNSUPPORTED`: Pocket UI。本パックはPocket用JSON UIを登録せず、ゲーム本体の標準UIへフォールバックする設計である。

したがって、ブラウザーの5画面smokeを「Minecraft実機と完全一致した」または「U01〜U20をすべて検証した」と読み替えてはならない。最終権威は、同一build、channel、pack順、Classic profile、GUI scale、解像度、localeで取得したゲーム本体のContent Logとスクリーンショットである。

## 2. 証拠の区分

この文書では、結論の強さを次の区分で固定する。

| 区分 | 意味 | 本文での例 |
|---|---|---|
| `observed` | ファイルまたは実行結果から再計算した値 | SHA-256、entry数、依存数、smoke数値 |
| `pack-declared` | パック同梱metadataの自己申告 | 対象sample版、builder版、Classic/Pocket方針 |
| `device-verified` | 添付された実機画像で目視できる範囲 | C01〜C05の画面対応、背景と枠の合成 |
| `official-confirmed` | Microsoft LearnまたはMojang公式配布で確認 | pack stacking、UI catalog、公式`full` asset |
| `approximation` | Preview Studioが設計確認用に補う挙動 | collection-backed gridの空スロット展開 |
| `runtime-boundary` | Minecraftの実行時状態なしでは確定できない範囲 | 実アイテム、選択状態、factory、map/player renderer |

## 3. 入力の同一性と完全性

### 3.1 ZIP識別子

| 項目 | 観測値 | 判定 |
|---|---:|---|
| ファイル名 | `inventory-background.zip` | 対象固定 |
| SHA-256 | `c1e0fb70e750ebe468c20e1fbe67ebb5adff819a7ea82046adfdb1c029da6cb9` | 一致 |
| ZIPファイルサイズ | 20,394,426 bytes | 参考値 |
| entry数 | 101 files | 一致 |
| 宣言展開サイズ合計 | 20,564,896 bytes | 一致 |
| ZIP CRC検査 | 全entry `OK` | PASS |

SHA-256、entry数および展開サイズはローカルの添付ZIPから独立に再計算した。別のZIP、再圧縮物、または同名ファイルへ本記録を流用してはならない。

### 3.2 内容カタログ

| 種別 | 数 | 数え方 |
|---|---:|---|
| UI JSON | 19 | `ui/*.json`。`ui/_ui_defs.json`を含む |
| `_ui_defs`登録UI JSON | 18 | `ui/_ui_defs.json`の`ui_defs`配列 |
| texture関連entry | 75 | `textures/`以下のPNGおよびsidecar JSON |
| その他entry | 7 | manifest、icon、README、receipt、checksum、context map等 |
| top-level UI定義 | 103 | 登録18 UI JSONのうち、`namespace`以外のobject値 |

19 UI JSONと103定義は同じ母集団ではない。`ui/_ui_defs.json`の`ui_defs`は配列であり、top-level UI定義103件には含めていない。

### 3.3 パック自己申告の対象版

同梱`manifest.json`は`min_engine_version: [1, 26, 40]`、`build-info.json`は次を宣言している。

- builder: `inventory_background_builder 2.9.0-v29-site`
- 公式固定sample: `1.26.40.5`
- sample commit: `7844835b6baad4c0010f46901a4accf87413a022`
- Classic構造: `USER_ACCEPTED_V19_BASELINE`
- 5比率: `USER_CONFIRMED_V21_FIVE_CLASS_GEOMETRY`
- Pocket: `UNSUPPORTED_VANILLA_PASSTHROUGH`

これらは`pack-declared`であり、同梱metadataだけではVanilla ZIPの公式配布元やdigestを証明しない。プレビューへ追加するVanilla ZIPは、Mojang公式releaseの対象tag、stable/preview channel、およびローカルSHA-256を別途固定する。

## 4. 根本原因

### 4.1 パック単体を完全なUIとして扱ったこと

Microsoft Learnは全UIファイルをcatalog fileに分類し、Vanillaファイル全体を複製せず、必要なsnippetだけをカスタムパックへ置くよう案内している。[S2] 本パックもこの疎な上書き方式であり、共通panel、screen root、slot template、toolbar、language、fontおよび多くの標準textureを意図的に同梱しない。

具体例は次のとおりである。

- `ui/inventory_screen.json`の`crafting.inventory_screen`はVanillaの`crafting.inventory_screen_base`を必要とする。
- パック側`ui/cartography_screen.json`は主に`cartography_panel`と`cartography_item_slot`を置換し、画面rootの`cartography.cartography_screen`はVanilla側から得る。
- パック側`ui/beacon_screen.json`も画面rootの`beacon.beacon_screen`と多数の`common.*` / `beacon.*`部品をVanillaへ依存する。
- `ui/redstone_screen.json`のホッパーは`common.inventory_screen_common`、`common.screen_background`等を必要とする。

この構造をパック単体で開けば、背景画像が存在していても、基底定義または子controlが欠け、空画面、断片表示、誤った寸法、missing textureになる。これはZIP破損ではなく、入力stack不足である。

### 4.2 物理ファイル単位で下位Vanillaを捨てたこと

同じpathのUI JSONが上位パックに存在しても、そのファイル内の全symbolが上位に再定義されるとは限らない。必要な合成規則は次のとおりである。

1. `_ui_defs.json`の登録pathは有効なpack stack全体で扱う。
2. 同じ完全修飾symbolが複数層にある場合は上位パックをwinnerにする。
3. 上位ファイルに存在しない別symbolは、同じpathの下位Vanillaから保持する。
4. `name@base`で明示された継承は解決するが、重複symbolの内容を無条件にproperty単位でdeep mergeしない。
5. 上位定義が同名の下位定義を明示的に基底として使う場合は、自分自身へ循環させず、次の低いprecedence候補を選ぶ。

Microsoft Learnが説明するpack stackingでは、同名contentは後から適用されたpackで上書きされる。[S1] 一方、JSON UI内部の全merge文法は一次資料だけで完全には規定されていない。このためPreview Studioはwinner、fallbackおよびprovenanceを表示し、推測した結合を実機事実として扱わない。

### 4.3 collection生成を静的`controls`だけで判定したこと

インベントリやホッパーのgridは、Minecraft runtimeのcollectionと`grid_item_template`からslot instanceを生成する。静的JSONに子slotが列挙されていないことを「スロットがない」と解釈すると、構造が正しく解決できても空のプレビューになる。

smokeでは、宣言された`grid_dimensions`、`maximum_grid_items`および解決済みtemplateから、上限付きの空slotを`approximation`としてmaterializeした。さらに、Vanillaが固定`grid_dimensions`を持たずruntime件数で生成するClassicの`recipe_book`だけは、1つの静的に有効なdesktop branchへ最大136件の代表slotを生成し、viewportとtemplate寸法から17列×8行を推定した。これはslot geometryを確認するための骨格であり、Minecraftの実アイテムcollectionを合成するものではない。件数不明の他collectionは自動生成しない。

Vanillaのscroll panelには、`$scroll_view_name@...`という変数control名と、`$scroll_view_name: "$scroll_view_name"`という呼出し元変数の自己転送がある。最終版はこの名前をcontrol map内だけで解決し、既に具体化した呼出し元の値を自己循環で消さない。また、`$touch: false`と`$scroll_bar_contained: false`から静的に無効と断定でき、かつbindingで`visible` / `ignored`を書き換えないbranchは、代表slotを生成せずbudgetを温存する。

### 4.4 線形式、制約、未解決visibilityの扱い

製図台rootの`100% - 44px`、各画面の`max_size`、96%背景を順に評価できないと、rootがviewport幅へ膨張し、背景クラスの寸法も誤る。最終smokeでは、加減算だけの安全な線形式と`min_size` / `max_size`を適用した結果、C03背景は`168.96 × 211.20`、配置は`(555.52, 254.40)`となった。

また、値を持たないruntime bindingを楽観的に可視とすると、CreativeとSurvivalのpanelを同時に描く。safe visibilityでは未解決状態を未解決のまま保持し、明示したmock状態に一致する枝だけを数える必要がある。

## 5. Vanilla依存監査

### 5.1 判定方法

母集団は、パックの`_ui_defs`が登録する18 UI JSONにある103 top-level object定義である。各定義を起点に、次を有向edgeとして抽出した。

1. top-level keyの`name@base`
2. 子孫`controls`等のkeyにある`child@base`
3. screen/template等を指定する、`@`を伴わない完全修飾string `namespace.symbol`

未修飾参照は参照元定義のnamespaceで修飾した。参照先がパック内symbolならパック内edge、パックになく固定Vanilla corpusにあるsymbolならVanilla直接依存とした。パック内edgeを推移追跡し、最終的にVanillaへ到達する定義もVanilla依存へ含めた。同名Vanilla symbolが存在するだけでは依存と数えていない。`control_name: "@..."`の3件はdefinition dependencyではないため、完全修飾property参照から除外した。

### 5.2 結果

| 項目 | 観測値 |
|---|---:|
| top-level定義 | 103 |
| Vanillaへ直接到達する定義 | 69 |
| パック内edge経由だけでVanillaへ到達する定義 | 3 |
| Vanilla依存合計 | **72 / 103** |
| 自己完結定義 | 31 / 103 |
| object key内の`@` occurrence | 371 |
| └ パック内参照 | 73 |
| └ 動的`$...`参照 | 3 |
| └ パック外かつVanillaで解決 | 295 occurrence / 78 unique |
| 完全修飾propertyのVanilla直接参照 | 40 occurrence / 29 unique |

直接依存69定義の参照形態は重複を許すと、top-level baseが34定義、nested baseが46定義、完全修飾propertyが21定義である。排他的な組合せは次のとおりである。

| 組合せ | 定義数 |
|---|---:|
| nested baseのみ | 28 |
| nested base + property | 7 |
| top-level base + property | 13 |
| top-level baseのみ | 10 |
| top-level base + nested base | 10 |
| 3種すべて | 1 |
| 合計 | 69 |

パック内edge経由だけでVanillaへ到達する3定義は次である。

- `invbg_662db7c61e5f.creative_recipe_book_scroll_panel`
- `invbg_662db7c61e5f.transparent_pocket_tab_close_button`
- `invbg_662db7c61e5f.transparent_close_holder`

動的base 3 occurrenceは静的な参照先判定から外している。したがって「Vanilla参照がすべて実行時にも解決する」という意味ではなく、「静的に確定できたパック外参照は固定Vanilla corpusに存在し、103定義中72定義が直接または推移的にVanillaを必要とする」という判定である。

## 6. 実機5画像とC01〜C05の対応

パック同梱`ui-context-map.csv`、背景PNG寸法、および添付画像の見た目を突合した。

| 添付画像 | 画像px | 画面 | UI ID | 背景class | 論理root | 背景PNG px | 目視できる主要要素 |
|---|---:|---|---|---|---:|---:|---|
| `スクリーンショット-2026-08-26-215630.webp` | 711×762 | 通常インベントリ／2×2クラフト | U11 | C01 | 176×166 | 880×830 | player preview、armor/offhand、craft grid、36 inventory slots |
| `スクリーンショット-2026-08-26-215652.webp` | 1310×855 | 全画面Creative | U12 | C02 | 326×166 | 1630×830 | category tabs、catalog、scrollbar、独立Vanilla hotbar |
| `スクリーンショット-2026-08-26-215916.webp` | 794×883 | 製図台 | U04 | C03 | 176×220 | 880×1100 | map name、input/output、map preview、inventory |
| `スクリーンショット-2026-08-26-215932.webp` | 1026×883 | ビーコン | U02 | C04 | 256×219 | 1280×1095 | primary/secondary effect、payment、confirm/cancel |
| `スクリーンショット-2026-08-26-215942.webp` | 709×539 | ホッパー | U19 | C05 | 176×133 | 880×665 | hopper 5 slots、inventory 36 slots |

5画像が直接支えるのは、各Classic画面へ対応する背景比率、背景が透明化されたpanel/slotの背後に見えること、Vanilla由来controlとカスタム背景の大まかな合成である。画像だけでは、非表示branch、hover/pressed/focus、全collection内容、他15画面、別解像度、別GUI scale、別locale、Pocketまたは別buildを検証できない。

## 7. 正しい利用手順

### 7.1 必須入力

1. 実機のMinecraft Bedrock版、stable/preview channel、Classic UI profileを先に記録する。
2. 添付パックのtargetは`1.26.40.5` / commit `7844835...`と自己申告されているため、同じ系列を検証する場合はMojang公式`v1.26.40.05` releaseから`full` assetを取得する。[S5]
3. `min` assetはtext中心でbinary assetを除くため、texture/fontを含む本プレビューの基底として使わない。Mojang release画面でも`full`は全texture、model、soundを含み、`min`はbinary除外と区別されている。[S5]
4. Vanilla ZIPの取得URL、release tag、channel、SHA-256、取得時刻を記録する。最新版であることを、対象buildとの一致と読み替えない。

### 7.2 Preview Studioへの追加順

1. 左側の「パック構成」で`inventory-background.zip`を「プレビュー用パック」へ追加する。
2. 同じカードの「Vanilla基底」に、上記のmatching official Vanilla `full` ZIPを追加する。
3. source順が「プレビュー用パック → Vanilla基底」であることを確認する。resolver上のprecedenceは添付パックが上、Vanillaが下でなければならない。
4. Vanilla readinessが構造不足または明示した版/channelとの不一致なら停止する。版情報を入力していない`READY_UNVERIFIED_VERSION`は表示には使えても、公式版一致の証拠にはしない。
5. Diagnosticsで`UI_BASE_NOT_FOUND`、`UI_CONTROL_BASE_NOT_FOUND`、`UI_GRID_TEMPLATE_NOT_FOUND`、missing texture/font/lang、truncationおよびlayout warningを確認する。
6. Previewを実機証拠と同じClassic profile、localeおよび可能な限り同じ画面条件へ合わせる。

### 7.3 5画面の選択

| 画面 | path | 選択symbol | 必要な状態 |
|---|---|---|---|
| 通常インベントリ | `ui/inventory_screen.json` | `crafting.inventory_screen` | Survival相当mock |
| 全画面Creative | `ui/inventory_screen.json` | `crafting.inventory_screen` | Creative全画面相当mock |
| 製図台 | `ui/cartography_screen.json` | `cartography.cartography_screen` | Classic desktop |
| ビーコン | `ui/beacon_screen.json` | `beacon.beacon_screen` | Classic desktop |
| ホッパー | `ui/redstone_screen.json` | `redstone.hopper_screen` | Classic desktop |

通常インベントリと全画面Creativeは同じscreen symbolを異なるruntime条件で表示する。ファイルまたはsymbolだけを切り替え、状態を切り替えなければ、両方のスクリーンショットへ一致しない。

## 8. 最終smoke

### 8.1 実行条件

smokeは次のread-only pipelineで実施した。

1. Vanillaをprecedence `10`、添付パックをprecedence `20`として`buildUiCatalog`へ投入。
2. `_ui_defs`をstack全体で合成。登録pathはpack `18` + Vanilla `204` − 重複 `17` = 実効 `205` path。
3. 7.3のsymbolを`resolveEffectiveUi`で解決。Classic desktop代表値として`$touch: false`、`$scroll_bar_contained: false`と、`recipe_book`最大136件を明示。InventoryのみSurvival/Creativeの2 mock状態で評価。
4. `buildUiScreenModelFromJson` → `buildTreeFromUiScreenModel` → `evaluateBindingsForUiModel` → `computeLayoutBoxesForFile`の順に実行。
5. canvasは`DEFAULT_CANVAS_PRESET`の1280×720、`visibilityMode: "safe"`、`maxBoxes: 5000`。

表の指標は次の意味である。

- `defs`: そのlogical pathについて`listEffectiveDefinitionsForPath`が返した実効定義数。選択rootのprovenance件数ではない。
- `slots 生成/可視`: resolverが設計時にmaterializeした`preview_slot_*`数 / safe layoutにboxが残った数。実アイテム数ではない。
- `safe boxes`: 非有限値、負寸法、上限超過等を除いた`layout.stats.renderedBoxes`。
- `背景box`: `backgrounds/classic/classes/Cxx`をtextureに持つ唯一のsafe image boxの論理寸法。元PNG pixel寸法ではない。

### 8.2 結果表

| 画面 | defs | 静的missing | slots 生成/可視 | safe boxes | drawable | 背景class | 背景box | 判定 |
|---|---:|---:|---:|---:|---:|---|---:|---|
| Inventory / Survival | 89 | 0 | 181 / 36 | 654 | 71 | C01 | 168.96×159.36 | PASS |
| Inventory / Creative | 89 | 0 | 181 / 145 | 2,143 | 194 | C02 | 312.96×159.36 | PASS |
| Cartography | 15 | 0 | 36 / 36 | 483 | 57 | C03 | 168.96×211.20 | PASS |
| Beacon | 40 | 0 | 36 / 36 | 468 | 51 | C04 | 245.76×210.24 | PASS |
| Hopper | 21 | 0 | 41 / 41 | 470 | 45 | C05 | 168.96×127.68 | PASS |

全5ケースで次も確認した。

- `UI_BASE_NOT_FOUND`、`UI_CONTROL_BASE_NOT_FOUND`、`UI_GRID_TEMPLATE_NOT_FOUND`: 0
- `UI_DYNAMIC_BASE_TARGET_NOT_FOUND`、`UI_DYNAMIC_BASE_UNRESOLVED`: 0
- Creativeの寸法なし代表gridに`GRID_DIMENSIONS_INFERRED`が1件。推定結果は17列×8行、各slot 18×18、x/y間隔18で、136件すべてclip内
- 上記の明示的な近似通知を除くlayout warning: 0
- `truncated`: false
- Inventoryのeffective modelは8,925 nodeだが、生成collectionと200 descendants超の非root subtreeを初期折り畳みし、Creativeを開いた直後のTree DOMは2行。検索または明示操作による展開は可能
- 対象class背景box: 1個だけ存在
- 背景寸法: 各logical rootの96%と一致

Creativeの可視slot 145は、設計時の空recipe slot 136と独立hotbar 9の合計である。136は実際のCreative catalogのアイテム数を意味せず、アイテム画像・stack数・category・検索結果は生成していない。ユーザーmockで`#recipe_book_total_items`を0にするとrecipe slot 0＋hotbar 9、18にすると17列×2行のrecipe slot 18＋hotbar 9となり、いずれも18px間隔で重ならず、0件を誤warningにしない。同様に、CartographyとBeaconの36はplayer inventory骨格の確認値であり、操作slotやeffect buttonのruntime内容を表さない。

以前は`$toggle_image → $checked_image`のような多段変数参照を1段で止め、Inventoryで`UI_DYNAMIC_BASE_TARGET_NOT_FOUND`を40件出していた。最終版は循環・深度上限付きで参照終端まで解決し、40件を0件にした。また`requires: "(not $is_full_screen_layout)"`のように安全な単純条件を外側括弧で囲むVanilla表現も評価し、5画面のdynamic warningを0件にした。未定義、非文字列、循環、複合条件または上限超過は引き続き推測せずwarningにするため、runtime状態を完全再現した証拠ではない。

## 9. 残るruntime境界

### 9.1 画面別に不足する実データ

| 画面 | 設計時smokeが確認するもの | Minecraft runtimeまたは明示mockが必要なもの |
|---|---|---|
| Inventory | panel、armor/craft/inventory gridの骨格、C01/C02 | player skin/model、armor/offhand、craft input/output、item stack/count、Survival/Creative条件 |
| Creative | 全画面branch、136件までの空catalog slot骨格、独立hotbar、C02 | 実item画像・件数、category、検索結果、group展開、scroll位置、hover item、tooltip |
| Cartography | 制約後root、inventory骨格、C03 | map名、2入力、出力、operation可否、map preview renderer、進捗 |
| Beacon | effect/payment領域、inventory骨格、C04 | beacon level、unlock、primary/secondary選択、payment item、confirm可否 |
| Hopper | 5 + 36 slot骨格、C05 | hopper内容、player inventory内容、搬送中item、選択/focus |

### 9.2 共通境界

- `#...` binding providerとMinecraft内部のcollection lifecycle
- factoryが生成するcontrol、item renderer、player renderer、map renderer、custom renderer
- controller、keyboard、mouse、touchのfocus graph、hover、pressed、drag/drop、tooltip、音
- animationの時間補間、scroll viewport、祖先clip、複雑なlayer/input優先順位
- `%c` / `%cm`、乗除算・関数を含む寸法式、複合min/max、実機pixel rounding
- Minecraft標準bitmap glyph、locale別font fallback、正確なtext wrapとfont metric
- atlas、shader、material、およびpalette/interleave TGA等のMinecraft固有描画
- denseなVanilla継承画面のresolverは同期処理であり、本検証環境のInventoryでは約5〜6秒を要した。開始前に読み込み表示を描画し、連続選択はgeneration guardで旧要求を破棄するが、解決中の細粒度cancel/progressは未対応
- 他のUI変更パックとの競合と実ゲーム側の最終pack順

Microsoftはcooperative Add-Onの指針でUIファイルのoverrideを避けるよう明記している。[S7] 独自namespaceは名前衝突を減らすが、共有Vanilla screenを複数パックが変更した時の協調mergeを保証しない。競合試験は実際のpack組合せと順序で行う。

JSON UIにはファイル単位のversioning概念がないと公式guidanceに記載されている。[S8] そのため、別Bedrock版のVanilla ZIPで静的参照が偶然解決しても、対象版相当とは認定しない。ゲーム更新後はmatching Vanillaを差し替え、smokeと実機比較を再実行する。

## 10. 合否gate

| Gate | PASS条件 | 本検証 |
|---|---|---|
| G1 ZIP完全性 | SHA-256一致、101 files、20,564,896展開bytes、CRC error 0 | PASS |
| G2 Catalog | 19 UI JSON、18登録path、75 textures、103 top-level defs | PASS |
| G3 Vanilla依存 | 固定corpusで静的外部参照を解決し、72/103の依存を追跡可能 | PASS |
| G4 5画面resolver | 静的missing 0、非truncate | PASS |
| G5 Slot骨格 | 上表の生成/可視数と一致 | PASS（approximation） |
| G6 Layout | safe boxes、唯一の背景class、96%背景寸法が一致 | PASS |
| G7 実機画像 | 添付5画像とC01〜C05の対応が確認可能 | PASS（限定条件） |
| G8 runtime完全一致 | binding、collection、factory、renderer、入力、fontを実機比較 | NOT_RUN |
| G9 Pocket | Pocket専用UIの実機・preview検証 | UNSUPPORTED |
| G10 U01〜U20全画面 | 同一条件で20画面を実機再確認 | NOT_RUN |

次のいずれかがあれば、本記録の5画面静的PASSを再利用せず、停止して再監査する。

- 添付パックのSHA-256が異なる。
- パック単体、`min` asset、非公式または対象版不一致のVanillaを使う。
- packとVanillaのprecedenceが逆である。
- Classic以外のprofileを対象にする。
- 静的missing、missing asset、layout warning、truncation、複数または欠落したclass背景が出る。
- renderer、resolver、binding evaluator、catalog、mock条件またはcanvas presetを変更する。
- Minecraft本体、stable/preview channel、GUI scale、解像度、locale、併用packを変更する。

## 11. 一次資料

- [S1: Microsoft Learn — An Introduction to Resource Packs（pack stacking）](https://learn.microsoft.com/en-us/minecraft/creator/documents/resourcepack?view=minecraft-bedrock-stable)
- [S2: Microsoft Learn — Overwriting Vanilla Assets（UI catalogと疎なsnippet）](https://learn.microsoft.com/en-us/minecraft/creator/documents/overwritingassets?view=minecraft-bedrock-stable)
- [S3: Microsoft Learn — JSON UI Documentation: `minecraft:ui_defs`](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/jsonuireference/examples/jsonuicomponents/ui_defs?view=minecraft-bedrock-stable)
- [S4: Microsoft Learn — JSON UI Documentation: `minecraft:ui_screen`](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/jsonuireference/examples/jsonuicomponents/ui_screen?view=minecraft-bedrock-stable)
- [S5: Mojang `bedrock-samples` — release `v1.26.40.05`](https://github.com/Mojang/bedrock-samples/releases/tag/v1.26.40.05)
- [S6: Mojang `bedrock-samples` — `v1.26.40.05`の公式UI tree](https://github.com/Mojang/bedrock-samples/tree/v1.26.40.05/resource_pack/ui)
- [S7: Microsoft Learn — Guidelines for Building Cooperative Add-Ons](https://learn.microsoft.com/en-us/minecraft/creator/documents/practices/guidelinesforbuildingcooperativeaddons?view=minecraft-bedrock-stable)
- [S8: Microsoft Learn — Latest Platform Version Guidance](https://learn.microsoft.com/en-us/minecraft/creator/documents/practices/latestplatformversion?view=minecraft-bedrock-stable)
