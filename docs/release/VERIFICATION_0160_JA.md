# 0.16.0 修正・検査範囲

2026-10-04。0.15.1公開ソースを基準として、Expedition Controlの作成・実機比較・ローカル操作・OGG音源検査で発見した問題を反映しました。以前の版と検査記録は変更していません。

## 根拠と修正

提供されたContent LogにはUIエラー792件（`collection_index` 748件、`looping` 44件）がありました。Scriptingのverbose 13件はAPIの互換性情報です。このログにwarning行はありません。0.15.1で追加済みのcollection・offset診断は保持し、今回新たに直した不具合とは区別します。

| 再現できた問題 | 0.16.0の対応 |
|---|---|
| 既知の非対応プロパティが厳格JSON・SVG・validateで合格になる | 選択投影の検査に診断を追加し、`native_properties`を全出力で共有 |
| 非表示の親の内側の不整合が既定PNGをすり抜ける | 宣言の検査も既定PNGに適用。部分描画は`preview_complete: false` |
| 保存状態の未知IDを黙って除去しbindingを成功扱いする | 原因付き診断。厳格JSON・PNGと操作APIで拒否 |
| 未解決の音声bindingから古い音源値を使う | GUI・APIで音声要求の判定を共有し、未解決時は発行しない |
| APIからフォームを維持したローカル操作を検査できない | 呼出し側が状態を引き継ぐ`interact()`を追加 |
| APIから登録OGGの参照・形式を検査できない | メタデータを返す`resolveSound()`を追加 |
| 公開監査の作業パス検出が過去の特定IDに限定される | 一般化した検出と独立した回帰検査を追加 |

## 実施する検査

検査手順はNode.js 22.14.0での公開版テスト、共有コア検査、ブラウザー静的依存グラフ、公開配布物の再展開とハッシュ・同梱範囲の監査です。全体検査の件数・成否は同時に提出する最終検査報告を正本とします。この文書では実測前の予想件数を合格として掲載しません。

実アドオンを使う検査は28状態の厳格PNG（通常11、同一インスタンスの操作13、native-entry経路4）と18操作です。音声は同梱OGGの参照・ハッシュ・Vorbis事前検査、全ファイル復号を調べます。公開APIはフォーム記述ハッシュとインスタンスIDの維持、ローカル状態の更新、無効入力の拒否も検査します。

## 実施していない確認

Minecraft実機の再比較、Windows起動、ブラウザーの実音出力は今回の検査に含みません。画像の一致は以前のレンダラー証拠との回帰比較です。実機との全ピクセル一致を意味しません。レイヤー順・フォント・ゲーム側状態の一致を、この版で完了したと主張しません。

APIの`interact()`はステートレスな投影であり、過去の状態の再送をサーバーが全面的に防ぐ設計ではありません。`resolveSound()`は発音しません。共有コアを含む実験GUIは保持しますが、GUI編集全体の完成を示すものではありません。

## 再実行

```sh
npm ci --ignore-scripts
npm run test:release
npm run check:package
node --experimental-vm-modules scripts/verify-browser-static-graph.mjs ../jsonui-browser-static-evidence.json
node scripts/release/audit-public.mjs --verify-manifest
```

公開配布に必要なMinecraft素材は同梱せず、権利を確認した参照パックを必要に応じて読み込んでください。素材依存で公開版から除外された検査や、skipされた検査は成功件数に含めません。[操作・音声ガイド](INTERACTION_AUDIO_JA.md)も参照してください。
