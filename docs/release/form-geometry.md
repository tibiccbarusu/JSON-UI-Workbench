# フォーム入力と画像・操作領域の検査

JSON UI Workbench 0.14.0 では、Drawned の報告書にあった「フォーム自体が空」「候補の表示番号と元の番号の混同」「見えるマスと操作領域のずれ」を別々に検査します。Minecraft の入力処理を実行する機能ではありません。

## 1. 明示した空の ModalForm を受け付けない

次の状態 JSON は `PREVIEW_STATE_MODAL_EMPTY_CONTENT:form.elements` になります。

```json
{"form":{"type":"modal","elements":[]}}
```

報告書の SHELL0 は、UI 部品を描画する前の空 content の問題でした。その状態を「画像を作れたから有効」と扱わないための入力検査です。説明だけのフォームは、入力を持たない label を一つ以上設定できます。

```json
{
  "form": {
    "type": "modal",
    "title": "確認",
    "elements": [{"type":"label","text":"内容を確認してください。"}]
  }
}
```

状態を一切指定しない `{}` は引き続き有効です。低水準の `collectionData.custom_form: []` も、空コレクションを調査する用途として維持しています。これはゲームへ送る ModalForm payload が妥当であるという認定ではありません。ActionForm の空ボタン列まで一律に禁止していません。

要素配列・選択肢配列の途中の穴も拒否します。選択肢を隠すときは、候補コレクションの配列を削って番号を詰めず、UI の表示条件で制御してください。レシピ表示の空欄詰めと、ネイティブ dropdown の選択番号の保持は異なる契約です。

## 2. 入力領域と描画領域を数値で比較する

既存の PNG 出力へ `--draw-evidence` を指定すると、描画する画像に最も近い入力型の祖先がある場合、`nodes[].input_geometry` が追加されます。

```sh
node local-node/cli.mjs preview --session session.json --file ui/example.json --definition example.screen --width 1280 --height 720 --ui-scale 4 --out preview.png --draw-evidence --json
```

この出力は既存の CLI JSON 応答の `result.draw_evidence` に含まれます。`--out` は PNG の保存先です。診断用の不完全なプレビューも必要な場合だけ、既存の `--allow-partial` を追加してください。

| 出力項目 | 意味 |
|---|---|
| `input_node_id` / `input_type` | 比較した入力型の祖先 |
| `input_layout_rect` | Workbench が解決した入力要素の矩形 |
| `input_clipped_rect` | その矩形に親のクリップと画面境界を適用した範囲 |
| `visual_destination_rect` | アスペクト比維持等を反映した画像描画先 |
| `visual_visible_rect` | 画像のクリップを反映した表示範囲 |
| `visual_minus_input` | 画像から入力要素を引いた x・y・幅・高さの差 |
| `relation` / `visible_relation` | クリップ前／後の矩形関係 |

例えば入力が 36×36、画像だけ `[2,1]` ずれていると、差分は `{"x":2,"y":1,"w":0,"h":0}` になります。関係の値は `aligned`、`input_contains_visual`、`visual_contains_input`、`partial_overlap`、`disjoint`、`empty`、`unavailable` です。

画像よりボタンが大きい設計には、意図した余白もあります。この差分だけをエラーにしたり、勝手に位置を修正したりしません。別の親に属する兄弟の透明入力面、実機のフォーカス・入力 mapping・押下可否は推測しません。3D 描画や複数画像レイヤーで一つの描画矩形を確定できない場合は `unavailable` と記録します。数値の一致もクリック試験の成功ではなく、`native_input_verified` は常に `false` です。

## 3. 長い部品 ID を復元できる形で保持する

従来の描画記録は、長い ID の先頭 4,096 文字だけを残していました。同じ祖先を持つ深い部品では、その先頭だけでは区別できません。

上限を超える ID は `sha256:<64桁のハッシュ>` に置換し、同じ `draw_evidence.node_id_map` に元の完全な ID を保存します。入力祖先の ID も同じ方式です。通常の短い ID は変わりません。元の ID が `sha256:` で始まる場合もハッシュ化し、キーの衝突を避けます。

復元表も既存の 1 MiB の描画記録予算に含めます。上限で記録を省略した場合は `complete:false`、`omitted_nodes`、`DRAW_EVIDENCE_JSON_LIMIT` を出し、欠けた記録を完全な結果と扱いません。

## 検証と根拠

```sh
node --test local-node/tests/release-form-geometry.test.mjs local-node/tests/frame-draw-evidence39.test.mjs local-node/tests/form-state37.test.mjs local-node/tests/raw-message38.test.mjs
```

回帰テストはゼロ内容／未指定の区別、候補を一つだけ表示したときの元の番号、独立した二つの dropdown、矩形の一致・ずれ・余白・クリップ、長い ID の復元、記録上限、CLI の PNG 出力を含みます。画像用テスト素材は単色 1 ピクセルをその場で生成したもので、Minecraft の画像を含みません。

不具合の根拠は利用者提供の Drawned 回顧報告の P04、K10、K17 と第12章です。入力 API の現在の公開仕様は [Microsoft Learn の ModalFormData](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-ui/modalformdata?view=minecraft-bedrock-stable) を参照してください。今回の自動テストは Workbench 内部と CLI の検証であり、Minecraft クライアントでの操作・描画の一致を証明するものではありません。
