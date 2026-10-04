# Public asset policy / 公開資材の方針

## 配布するもの

公開用 ZIP は、レンダラーのコード、テスト、現在の説明書、出典とライセンスが
確認できるライブラリ、自作と明記された小型デモを収録します。`r41` は元版の
識別名として履歴に残し、製品名は **JSON UI Workbench** に統一しています。

## 配布しないもの

- Minecraft / Mojang のテクスチャ、スキン、モデル、フォント、音声、完全な UI。
- 元版の `editor-core/assets/native-default-player`（Steve の資料）。
- コピーされた実機 fixture: horse controller、settings UI、official action excerpts。
- ユーザーがアップロードしたパック・報告書・スクリーンショット・ログ・検証結果。
- 過去の `docs/r*` / `docs/revision*`、端末固有の情報、キャッシュ、セッション。
- Node.js 本体、canvas のネイティブバイナリ、`node_modules`、作業用の ZIP。

これは、配布権を確認できない素材を公開 ZIP に混入させないための区分です。
元のアーカイブを書き換えたり、手元の素材を削除したりする処理ではありません。

## バニラ素材を使う

必要な素材は、対象の Minecraft 版に対応する
[Mojang の配布元](https://github.com/Mojang/bedrock-samples/releases)から取得し、
その配布条件を確認したうえで、アプリのバニラ参照パックとして読み込みます。
編集するパックは編集対象として別に読み込みます。`full` と `min` では画像や
フォントの収録内容が異なります。ゲーム版・配布タグ・ファイルのハッシュを
記録してください。

任意のアドオンを読み込めることは、そのアドオンを再配布できることを意味しません。
公開する UI のエクスポートにも、自分のコードや許諾済み素材だけを含めてください。
取り込んだ素材は、公開リポジトリの外側か、除外済みの `private-assets/` に置きます。

原版の Steve 自動補完は、公開版には素材を同梱しません。モデル・スキンの入った
参照パックを読み込んでください。素材がない場合は未解決として扱い、別のモデルを
本物と称して描画しません。

未導入の既定参照を架空のファイル候補として扱わないため、読み込んだ有効な独自
player定義が、欠けたSteve素材に巻き込まれて失敗することを防ぎます。Node経路と
ブラウザー経路の両方を対象にしています。手元で任意の既定素材を変更した場合は、
ローカルサーバーを再起動し、ブラウザーも再読込みしてください。

## License boundaries

Game data and third-party add-ons keep their own terms. Compatibility identifiers
and source hashes in the code are not a redistribution of the corresponding
asset files. Excluding assets does not establish ownership of all inherited
renderer code; [LICENSE.md](../../LICENSE.md) separately records that limitation.

This is an independent tool. It is not an official Minecraft product and is not
approved by or associated with Mojang or Microsoft.

Sources: [Minecraft EULA](https://www.minecraft.net/en-us/eula),
[Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines),
[bedrock-samples license](https://github.com/Mojang/bedrock-samples/blob/main/LICENSE.md).
Checked 2026-09-28. Review current upstream terms when publishing new assets.
