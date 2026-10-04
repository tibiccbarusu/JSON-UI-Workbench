# 0.15.1 の変更・検証記録

## 修正の理由

Expedition Control 1.0.1 の利用者実機ログ
`ContentLog2026-10-04_15-31-49_1.txt` では、`collection_index` の不明プロパティ
748 件と、`sweep_move` の `looping` の不明プロパティ 44 件が記録されました。
旧プレビューは祖先まで行番号を伝播して参照でき、`offset` の `looping` を
数値で再現できたため、これらの品質軸を合格としてしまいました。

## 対応範囲

- 明示 `collection_index` の直近の親が `collection_panel` / `stack_panel` /
  `grid` 以外の場合、`COLLECTION_INDEX_NATIVE_CONTEXT_INVALID` を報告します。
  遠い祖先に collection があっても、この診断は解除しません。
- 旧形式の参考値の評価は保全します。品質の collection 軸は `failed` となり、
  `strictSemantics: true` / `--strict-semantics` は JSON 出力前に停止します。
  PNG の既定厳格出力も拒否し、`allowPartial` / `--allow-partial` は
  `draft: true`、`preview_complete: false` の参考画像としてのみ利用できます。
- 内部 grid / factory 展開が生成する行 marker は別の設計時証拠として扱います。
  既存の合法的な `grid_dimensions` / `grid_item_template` による行展開、
  `grid_position` での固定行解決は保全します。
- `anim_type: offset` に `looping` がある場合、
  `ANIMATION_LOOPING_NATIVE_REJECTED` を報告し、animation 軸を `unknown` にします。
  正の duration の `next` 循環は既存サンプラーで評価します。元の宣言は変更しません。
- 警告を 256 行まで記録し、以降は打切りを明示します。省略があれば観測を完全とは扱いません。

## 根拠と限界

[Mojang の store_common.json](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/ui/store_common.json)
では `screenshots_grid` が `collection_panel` で、直下の要素に固定の
`collection_index` を記述しています。
[Mojang の server_form.json](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/ui/server_form.json)
は `form_buttons` / `custom_form` の collection と factory の構成例です。
[Mojang の hud_screen.json](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/ui/hud_screen.json)
には `next` で次の animation を接続する例があります。
[Mojang の chest_screen.json](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/ui/chest_screen.json)
では container の grid を `grid_dimensions`、`grid_item_template`、
`collection_name` で構成しています。

これらは完全な native schema ではありません。直近親の限定規則は公式例と今回の
実機拒否の観測に基づく互換性診断です。未観測の型・将来のプロパティを一般的に
無効と判断する whitelist は追加していません。

layer の既存プレビューは祖先の layer と局所 layer の和を使います。
今回、layer の native 計算を断定できる一次資料が不足しているため、その規則を
変更していません。付属アドオン側は文字・背景・メーターの layer を明示します。
プレビュー用の Noto bitmap 参照は Minecraft 内の ASCII font と異なるため、
文字形状の画素一致を保証しません。

API で `strictAnimation: true`、CLI で `--strict-animation` を指定すると、
animation 軸が非合格なら停止します。数値描画の成功と Minecraft での表示成功、
通常フォームの入口・ユーザー入力の成功は独立です。

## 今回の検査

関連試験 46 件を Node 24.19.0 / Linux x64 で実行し、46 件成功・失敗 0 件・
スキップ 0 件でした。新規の 6 件は、即時親の文脈・過去形式の保全・生成 grid 行・
厳格 JSON 出力拒否・証拠上限・offset の `next` 循環を検査します。

同じ関連 46 件を公式 Node 22.14.0 / Linux x64 でも実行し、46 件成功・失敗 0 件・
スキップ 0 件でした。core engine 専用検査は 533 件成功・失敗 0 件でした。
preflight は 350 ファイル・欠落 0 件、browser 静的依存検査は 159 module / 270 import
edge / 173 resource・失敗 0 件でした。

全公開回帰は Node 24.19.0 / Linux x64 で 3,166 件を実行し、3,127 件成功・
失敗 0 件・スキップ 39 件でした。core 533 件と同じ試験の関連再実行を加算して
全体件数にはしません。スキップ理由は TAP に保持しています。

配布 allowlist の新規 source ZIP を生成し、770 ファイルの公開ポリシー・
権利通知保持・既知の秘密情報パターンの監査で失敗 0 件でした。
配布側 preflight は再生成した一覧の 357 ファイル・欠落 0 件でした。これは権利の包括的な
確認でも実機動作の検査でもありません。

配布済み 1.0.1 と修正版 1.0.2 を同じ明示フォーム状態で実際に SDK へ入力した
設計時検査では、動作 ON の旧版は collection 軸 `failed` / animation 軸 `unknown`、
修正版は両軸 `passed` となりました。旧版への strict 要求は
`CLI_COLLECTION_GATE_FAILED` で拒否し、修正版は通過しました。
Minecraft の実機描画、Windows / macOS の実機起動は今回この環境で実行していません。
