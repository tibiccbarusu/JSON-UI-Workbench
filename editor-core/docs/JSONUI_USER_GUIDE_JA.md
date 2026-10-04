# JSON UI Preview Studio — 利用手順

## 1. 対応入力

`manifest.json`に`resources` moduleを持つMinecraft Bedrock Resource Packの`.zip`を使う。ZIP直下、または単一の最上位folder配下にpackがあってもよい。

推奨構成:

```text
manifest.json
ui/_ui_defs.json
ui/_global_variables.json
ui/*.json
texts/en_US.lang
texts/ja_JP.lang
textures/ui/*.{tga,png,jpg,jpeg}
font/*
```

UI JSONだけのpackも解析できるが、対応する文字列・texture・fontがpackにもVanilla referenceにもなければ、実機相当の見た目にはならない。

## 2. 基本操作

1. 左側の「パック構成」で、編集・プレビュー対象のZIPを「プレビュー用パック」に選ぶ。
2. ZIP索引、asset path索引、UI catalogの進捗を確認する。
3. 標準UIを省略しているパックでは、同じ欄の「Vanilla基底」に対象buildと一致する公式Vanilla `full` ZIPを追加する。
4. 「UI定義を選択してプレビュー」でJSONファイルを選ぶ。
5. 次のselectで、そのファイル内のトップレベル定義を一つ選ぶ。
6. 「選択したUIを開く」を押す。
7. Previewのlocaleを実機と同じ値へ合わせる。
8. Diagnosticsでmissing asset、未解決base、近似profileを確認する。

同じJSONファイルに複数screen/componentがあっても、同時に重ねず一つずつ開く。

同名symbolへ`modifications`だけを記述するoverlayは、下位Vanillaの同名symbolを基底として扱う。現在プレビューで適用するのは`controls`配列の`insert_front` / `insert_back` / `remove` / `replace`に限る。未対応操作や安全上限を超えた操作は推測せずDiagnosticsへ残す。

## 3. 別ファイル継承

たとえば`ui/custom.json`に`main@common.base_screen`があり、`common.base_screen`が別ファイルまたはVanillaにあっても、catalog全体から検索する。imported packの同名symbolがVanillaより優先される。同じUIファイルを両パックが持つ場合も、imported側が省略した別symbolは下位Vanillaから残す。重複symbolの中身を無条件にdeep mergeするものではない。

結果には利用したfileとsymbolのprovenanceが保存される。`UI_BASE_NOT_FOUND`がある場合、形を推測して埋めないため、該当箇所は不完全になる。

## 4. Pocket

Pocketファイルは読込・索引・raw確認までは可能だが、プレビューbuttonは無効になる。これは故障ではなく、未検証profileをClassicとして誤表示しないための安全策である。

## 5. 大きなpack

- 数百MBのZIPは、全entryを展開せずpath索引から処理する。
- 進捗は`index`、`manifest`、asset index、UI catalogの各段階で表示される。
- 停止したい場合は「安全に停止」を使う。
- 中断後はReaderを閉じ、同じZIPを再選択できる。
- OSやbrowserのmemory不足、600 MiB超過、12万entry超過、zip bomb疑いはfail closedする。

巨大packで最初から全UIを開く必要はない。目的のJSONと定義を選び、texture/fontは画面内で必要になったものだけ遅延読込する。

## 6. Vanilla reference

対象Minecraft buildと公式release tagを先に固定する。最新版だから一致するとは限らない。

左の「パック構成」から公式`full` ZIPを選ぶ。完全なUI、texture、font、languageを含む構造が確認でき、版情報を入力していない場合は「版未照合」のwarning付きで基底として使用する。明示した対象版と配布元版が不一致の場合、または必須構造が不足する場合は有効化しない。

監査証跡が必要な場合はDebugの入力欄で次を指定する。

- target Bedrock version
- official source release
- target channel: stable / preview
- source channel: stable / preview

構造が一致しても、ブラウザーだけでは公式配布元とSHA-256 receiptを証明しないためwarningとする。これは表示に利用できるという意味であり、実機一致の証明ではない。

## 7. 文字列がkeyのまま表示される場合

1. Preview localeを確認する。
2. imported packの`texts/<locale>.lang`を確認する。
3. Vanilla由来keyなら、対象buildのVanilla referenceを追加する。
4. `localize: false`ならliteral扱いであることを確認する。
5. Diagnosticsのmissing language keyを確認する。

存在しない翻訳は自動生成しない。

## 8. textureが出ない場合

1. JSONの`texture` referenceと実pathを確認する。
2. `.tga` / `.png` / `.jpg` / `.jpeg`の拡張子と大文字小文字を確認する。同一名なら実機同様にこの順で優先される。
3. `texture_file_system`が対応範囲か確認する。
4. UV領域が画像範囲内か確認する。
5. sidecar JSONまたはnine-slice値を確認する。
6. imported packとVanillaのどちらがwinnerになったかDiagnosticsで確認する。

missing textureに別assetを推測適用しないため、欠落表示は入力不足を示す。

## 9. 判定の読み方

- `official-confirmed`: 公開一次資料で確認できる
- `device-verified`: 記録されたbuild・解像度・profileの範囲のみ
- `approximation`: プレビュー用規則であり、Bedrock保証ではない
- `policy`: 安全上の拒否または上限
- `observed`: 入力や実行で実際に観測した結果

自動testのPASSをMinecraft実機の全画面一致と読み替えない。最終確認が必要なUIは、同じpack stack、build、profile、GUI scale、resolution、languageで実機比較する。

## 10. 現在の忠実度上限

数値、単純な`%`、`100% - 44px`のような加減算だけの線形式、`min_size` / `max_size`、基本anchor、stack/grid、TGA/PNG/JPG/JPEG、UV、限定的nine-slice、基本labelを主対象とする。TGAは上限付きの非palette true-color/grayscale（raw/RLE）だけを安全に復号し、color map・interleaveなど未対応の形式は推測せず拒否する。collection-backed gridは宣言された寸法とtemplateから空スロットを上限付きで設計時展開する。寸法を宣言しないClassicの`recipe_book`だけは、実アイテムを捏造せず、最大136件の空スロット骨格とviewport・template寸法から行列を近似する。136はVanillaが宣言する固定`grid_dimensions`ではなく、標準的な17列×8行相当も覆うための設計時件数上限であり、実際の行列は表示領域によって変わる。表示件数に関するユーザーmock dataは代表値より優先し、0件も保持する。その他のcollectionを件数不明のまま自動展開せず、実アイテム内容もMinecraftのruntime dataがないため再現しない。`%c` / `%cm`、乗除算・関数を含む寸法式、祖先clipとscroll viewport、複数行text wrap、Minecraft標準bitmap glyph、factory、animation、入力状態、custom rendererは未実装または限定対応である。これらを含む画面ではDiagnosticsと実機比較を必須とし、サイトの近似表示だけを合格根拠にしない。
