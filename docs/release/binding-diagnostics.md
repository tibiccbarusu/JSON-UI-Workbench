# Binding と collection の改修

r41 に対するこの変更は、提供された Drawned 技術総括の K06 / K11 / K17 / K23、P05 / P06 / P17 / P18 を回帰条件へ落とし込んだものです。Minecraft 本体の入力処理を再実装・実機検証したという意味ではありません。

## 変更内容

- **誤った別部品の読取りを防止**：要求された兄弟／子の名前が存在していても、その部品が無効だった場合に、別の枝の同名部品へ読み替えないよう修正しました。生成された collection の外から、その内部の一意な候補を全体検索で借りることも防ぎます。
- **名前解決の経路を記録**：各 view binding の診断に `sourceResolution` を追加します。値は `self` / `sibling` / `local_child` / `ancestor` / `global_fallback` です。全体検索は従来のプレビュー機能として残しますが、`VIEW_SOURCE_GLOBAL_FALLBACK` を報告し、`binding_quality.source_scope` を `unknown` とします。計算済みプレビューの成否とネイティブでの名前探索保証は別の軸です。
- **親の collection 文脈不足を限定的に警告**：`panel` が `custom_dropdown` の `#custom_radio_text` を追加読取りし、自身の bindings に有効な `collection_details` がない場合、`COLLECTION_DETAILS_LOCAL_CONTEXT_UNCONFIRMED` を出します。子のラベルに指定があっても、この警告は消えません。すべての collection 読取りを一律に禁止したり、ソースへ指定を自動追加したりはしません。
- **既知のプロパティ拒否を診断**：受動的な `panel` / `image` の `focus_enabled` を `LAYOUT_NATIVE_PROPERTY_UNSUPPORTED` として報告します。`false` でもプロパティ自体は存在します。`button` / `toggle` / `input_panel` / `dropdown` は、この限定規則の対象外です。
- **打切りを合格にしない**：ノード走査、view binding 件数・演算数、変数・property bag 等の走査上限を `observationCaptureComplete=false` へ反映します。collection 品質もこの値を引き継ぎます。ちょうど上限件数で全走査が終わった場合は、誤って打切り扱いしません。
- **非表示候補の番号を維持**：見える候補が 1 個でも、元の collection index を保持する既存の動作を回帰検査しました。表示の詰め直しと、入力が返す選択番号の詰め直しは別です。

## 診断の読み方

| 表示 | 意味 |
|---|---|
| `bindings.status=passed` | 与えた状態から対象プロパティを計算できた |
| `source_scope.status=unknown` | 全体検索など、実機同等と保証できない探索を使用した |
| `collections.status=unknown` | 文脈不足の注意、あるいは走査打切りがある |
| `observation_capture_complete=false` | 全体に対する評価が未完了 |
| `native_parity_verified=false` | Minecraft 実機との一致はこの検査では証明していない |

`source_scope` の注意だけで編集用プレビューを禁止することはありません。明示した模擬状態の表示、ローカル toggle の変更、実機のクリック／フォーム返却を、同じ成功とは扱わないでください。

## 検証

新規 `editor-core/tests/binding-evidence42.node.test.mjs` は外部素材を含まない独自の最小 fixture です。

```sh
node --test editor-core/tests/binding-evidence42.node.test.mjs editor-core/tests/collection-context39.node.test.mjs
node --test local-node/tests/binding-quality40.test.mjs
```

確認結果：新規 9 件、既存 collection 26 件、既存 binding 品質／PNG／CLI 116 件が通過。既存 evaluator suite 54 件も通過しています。品質試験の focus 対象を実機で有効な button に変更し、上限打切りは対象が非表示でも「全体を観測できた」としない期待値へ修正しました。

## 限界

- `collection_details` の規則は実際に失敗／改善が比較された形に限定した互換性注意です。すべてのクラッシュ原因を断定する規則ではありません。
- `global_fallback` の利用は実機で失敗するという断定ではありません。外部参照が実機で成立した Drawned の例もあるため、未確認として区別しています。
- FPS、ネイティブ UI メモリ、入力遅延を今回実測したものではありません。
- 利用者のソースファイルや collection index をこれらの診断で書き換えません。
