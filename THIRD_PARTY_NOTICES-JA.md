# 第三者の権利表示 — JSON UI Workbench 0.16.1

[English](THIRD_PARTY_NOTICES.md) · [本体のライセンス](LICENSE.md)

この文書は使用部品と由来を記録します。各ライセンス本文の代わりではなく、元のファイルに新たな条件を付けるものでもありません。

| 部品 | 版 | ライセンス | 出典・保持している本文 |
|---|---|---|---|
| zip.js | 2.8.16 | BSD-3-Clause | [公式](https://github.com/gildas-lormeau/zip.js)、`editor-core/vendor/zip.js-2.8.16/LICENSE` |
| jsonc-parser | 3.3.1 | MIT | [公式](https://github.com/microsoft/node-jsonc-parser)、`editor-core/vendor/jsonc-parser-3.3.1/LICENSE.md` |
| pngjs | 7.0.0 | MIT | [公式](https://github.com/pngjs/pngjs)、`local-node/vendor/pngjs/LICENSE` |
| @napi-rs/canvas | 0.1.100 | パッケージは MIT | [公式](https://github.com/Brooooooklyn/canvas)。npm で導入し、公開ソース ZIP にネイティブバイナリは含めない |

ブラウザー用依存の固定版とハッシュは `editor-core/vendor/THIRD_PARTY_LOCK.tsv` に残っています。これらは r41 由来の記録で、配布物のハッシュは `PUBLIC-DISTRIBUTION.json` が別に記録します。canvas 本体の MIT 表示だけで、その内部・依存するネイティブ部品の条件を置き換えることはできません。将来インストーラーやバイナリを配布する場合は、実際に組み込む依存の本文と表示を収集してください。

## Minecraft の互換性情報

レンダラーには、互換性のための識別子、アイテムとテクスチャの対応、プロパティ名、利用可能な数値 ID、ハッシュ、自作の解釈処理があります。外部形式についての情報であり、ゲームのテクスチャや Minecraft 全体の実行環境ではありません。

既存の表には Mojang/bedrock-samples のコミット `736072450c26a7c67f07b1661f29d9a5ebaa14b1` を出典として記載するものがあります。ほかの表はそれぞれ固定した出典版を示します。出典コメントを保持してください。ある版との互換性で、すべてのゲーム版との互換性を証明したことにはなりません。

[Mojang/bedrock-samples の条件](https://github.com/Mojang/bedrock-samples/blob/main/LICENSE.md)は Mojang の権利を保持し、[Minecraft EULA](https://www.minecraft.net/en-us/eula)を参照しています。MIT ではありません。公開配布には、提供された実機プレイヤーモデル・スキン、コピーされたネイティブ UI・controller の試験データ、バニラパック、ゲームフォント、過去のゲーム画像を含めません。必要な参照パックは利用者が正規に用意します。

## 自作のデモ素材

`examples/revision12/pack` と `examples/revision13/pack` の小さな例は、付属の `CREDITS-ja.md` に自作の試験画像、限定的な試験字形、合成音声と記録されています。公開ビルダーは、由来が記録された素材経路だけを使います。この記録自体は追加の包括的な利用許諾ではなく、プロジェクトの条件が適用されます。由来不明の過去の試験 ZIP はそのまま配布せず、記録された自作素材から再構築します。

`docs/release/manual/examples/build-demo.mjs` は、自作 JSON 定義と単色の試験画像を生成し、由来が記録された合成 OGG を再利用します。ゲームのフォントやテクスチャをコピーしません。これらのプロジェクト独自部分には `LICENSE.md` の範囲で本体の条件が適用されます。

## 本体のソース

元の r41 は、完全な著作者記録や全体のライセンスを含んでいませんでした。0.16.1 で、公開者が所有するか許諾する権限を持つ独自部分に PolyForm Noncommercial License 1.0.0 を採用しました。第三者部品、元の条件が適用される互換性データ、ゲーム素材、ユーザー提供データを再ライセンスしません。非商用のソース公開ソフトウェアとして説明してください。
