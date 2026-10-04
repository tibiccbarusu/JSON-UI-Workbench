# 自作デモの出典

UI定義と翻訳は今回の0.9.0デモ用に作成しました。画像3枚と2枚の小さい字形シートは、同梱の `examples/revision12/pack` から必要分を無変更でコピーした自作素材です。unused.png は自作button.pngの複製です。元字形の定義は `examples/revision12/glyph-patterns.mjs`、画像生成は同じ版の `build-pack.mjs` にあります。英大文字と一部のカタカナだけの検証用字形で、Minecraftの原字体・公式フォント・汎用日本語フォントではありません。

click.ogg はrevision12から無変更でコピーした人工音で、880 Hz、0.12秒、Vorbis、48 kHz、monoです。unused.oggはその複製です。元音源のSHA-256は b7d74fa60fc9799f0ab352a7c47acc5bbda2d6697f922254ac105eba10d228e6。ゲーム音源・第三者の録音は含みません。

このパックを `--vanilla` に渡す例は、下位層へ単体で取り込む処理の確認用です。実際のMojang公式バニラパックという意味ではありません。元版の全フォルダーは実行に不要で、このデモZIPのみで必要素材を読めます。
