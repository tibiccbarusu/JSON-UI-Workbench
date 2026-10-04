# 小さな検証パックの素材

UI定義、翻訳文、3枚のtexture、限られた英大文字とカタカナの8×8字形は、このデモ用に新規作成したものです。MojangのUI・画像・フォントは含めていません。字形の元データは完成品内の `examples/revision12/glyph-patterns.mjs`、画像とZIPの生成処理は同じ場所の `build-pack.mjs` にあります。

`sounds/demo/click.ogg` は完成品内の `local-node/tests/audio-fixtures/click.ogg` をそのままコピーしています。音声担当の `docs/revision12/reviews/audio/implementation-ja.md` による生成由来は、880 Hz、0.12秒の人工正弦波、Vorbis、48 kHz、monoです。第三者の録音やゲーム音源は含みません。ffmpegは元fixtureの作成時だけに使用され、このデモのZIP再生成や製品起動には不要です。

音声は3,825 bytes、SHA-256は `b7d74fa60fc9799f0ab352a7c47acc5bbda2d6697f922254ac105eba10d228e6` です。実際の音量・聞こえ方はブラウザと出力機器で確認してください。
