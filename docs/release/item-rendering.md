# インベントリアイコンのプレビュー仕様

JSON UI Workbench 0.14.0 は、r41 で使われていた 5 品目だけの古い数値 ID と、現在のアイテム ID を区別します。アイコンが描けたことを、Minecraft 実機での画素一致やクラフト動作の合格とは扱いません。

## 修正した問題

- `#item_id_aux` の上位 16 bit を符号付きで読みます。アカシアの板材 `-742` や避雷針 `-312` が、無関係な正の番号へ変化する問題を修正しました。符号付き値と同じビット列の符号なし値は同じ品目になります。
- `property_bag` に静的な `#item_id_aux` がある `inventory_item_renderer` を、`collection_details` がなくても解決します。インベントリの `@common.item_renderer` を継承して別のスロットの状態を借りる必要はありません。
- 看板は専用アイテムスプライトへ解決します。アカシアの看板を板材の面テクスチャで代用しません。
- ブロックの面、避雷針の材質、盾などのエンティティ UV 展開画像を、完成したアイテムアイコンと誤認しません。必要なモデル描画が実装されていない場合は `NATIVE_ITEM_MODEL_REQUIRED` を返します。**本リリースであらゆるブロックや盾を完全に 3D 描画できるという意味ではありません。**
- 不透明なネイティブ値 `#item_renderer_data` が与えられている場合を、空スロットと誤判定しません。表示用の品目情報が不足していれば、未対応入力として診断します。
- プレビュー状態の `slots` / `inventory` も同じ現在の数値表を使用します。独自アイテムや実行時に ID が変わる品目は識別子のまま保持します。

## バージョン別の数値プロファイル

既定値は `bedrock-v1.26.50.4` です。Mojang の公開サンプル **v1.26.50.4** のメタデータを基に、1,545 件の組み込み品目について識別子と数値の対応を保持します。BP で定義される品目は、追加パックによって実行時 ID がずれる可能性があるため除外しています。これはゲームの全バージョンに通用する表ではありません。

| 品目 | このプロファイルの raw ID | aux = 0 の値 |
| --- | ---: | ---: |
| アカシアの看板 | 589 | 38600704 |
| アカシアの板材 | -742 | -48627712 |
| 避雷針 | -312 | -20447232 |
| 盾 | 358 | 23461888 |
| エメラルド | 523 | 34275328 |
| ネザライトインゴット | 624 | 40894464 |

現在の数値プロファイルでは補助データが `0` の場合だけを扱います。非ゼロの補助データには状態や損傷値が含まれ得るため、アトラスの配列番号とは決めつけません。明示的なプレビューで配列要素を選ぶ場合は `__jsonui_preview_item_atlas_key` と `__jsonui_preview_item_variant` を使います。

過去の r41 の 5 品目を再現する場合は `r41-legacy-five` を明示選択します。これは過去の挙動を再現する互換モードで、現行 Minecraft の ID 表ではありません。

共有 JavaScript API の例:

```js
resolveNativeRendererTexture(control, {
  ...loadedAtlasContext,
  itemIdProfile: 'bedrock-v1.26.50.4',
});
```

特定の検証用コントロールだけを旧形式で評価するときは `__jsonui_preview_item_id_profile: 'r41-legacy-five'` も指定できます。この `__jsonui_preview_*` 系は Workbench の検証用データであり、Minecraft ネイティブの JSON UI プロパティではありません。共有・公開用のゲーム UI に動作条件として組み込まないでください。

## インポートした独自アイテムとブロック

独自アイテムの明示的な `minecraft:icon` を優先し、選択したパックの `textures/item_texture.json` を通じて画像を解決します。対応する `items/*.json` を読み込めるパックに含めてください。独自名前空間を取り除いてバニラの同名アイテムを表示することはありません。

`blocks/*.json` の `minecraft:item_visual` はジオメトリと材質の設定です。そこにあるテクスチャを 2D アイコンとして流用しません。同じ識別子のアイテムに明示的な `minecraft:icon` があり、`minecraft:block_placer` でブロックアイテムを置き換える構成なら、そのスプライトをプレビューできます。ブロック定義の存在だけから、Minecraft 側での置換設定まで検証済みとはしません。

数値 ID、NBT、エンチャント、染色、装飾、動的なアニメーション等の全状態は再現していません。必要な入力やモデルがない場合は診断が残り、別の品目画像で穴埋めしません。

## 検証と権利区分

回帰テストは、符号付き ID、現行／旧形式の分離、看板と板材の取り違え、モデル UV の誤表示、独自ブロックと明示アイコンの優先順位、補助データ、未解決のネイティブ入力を検査します。描画テストの画像は単色の合成画像です。Minecraft クライアントでの画素比較は未実施です。

この対応表には数値と識別子の互換情報だけを含め、Minecraft のテクスチャ、モデル、フォント、翻訳、ゲーム本体は含めていません。実際の素材は利用者が適切な権利を持つリソースパックから読み込みます。公式サンプルの素材が本プロジェクトのソースコード用ライセンスへ変更されることはありません。全体の権利区分は配布物のライセンス文書も確認してください。

参照した一次資料:

- [Mojang の品目メタデータ（固定タグ）](https://github.com/Mojang/bedrock-samples/blob/v1.26.50.4/metadata/vanilladata_modules/mojang-items.json) — SHA-256 `329bdc4c07b8cf710dc7ee0b3b7cd2d1431d56cee10c2a0416658d5443a00e8e`
- [同じタグの Behavior Pack 品目定義](https://github.com/Mojang/bedrock-samples/tree/v1.26.50.4/behavior_pack/items) — 実行時 ID に依存する品目の除外に使用
- [Microsoft Learn: minecraft:icon](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_icon?view=minecraft-bedrock-stable)
- [Microsoft Learn: minecraft:item_visual](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_item_visual?view=minecraft-bedrock-stable)
- [公式 Beacon UI の静的 inventory_item_renderer 使用例](https://github.com/Mojang/bedrock-samples/blob/v1.26.50.4/resource_pack/ui/beacon_screen_pocket.json)
