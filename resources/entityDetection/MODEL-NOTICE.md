# Local named entity classifier

Model: `Xenova/bert-base-multilingual-cased-ner-hrl`, revision
`263e82c06569c8c2ac46238a7ae5107598934234`.

Upstream model: [Davlan/bert-base-multilingual-cased-ner-hrl](https://huggingface.co/Davlan/bert-base-multilingual-cased-ner-hrl),
model-card revision `e756de7f7b8f64fea0c3d7c3872f1322fab747b1`.
The upstream model card declares Academic Free License 3.0 (AFL-3.0),
reproduced in LICENSE-AFL-3.0.txt. The Xenova repository supplies ONNX
conversion/quantization for Transformers.js. Writer does not modify these
weights. Original attribution and model information are available at both
repository links; model assets are downloaded separately at explicit preparation.

The classifier labels people (PER), locations (LOC), and organizations (ORG).
It was fine-tuned from multilingual BERT on news datasets in Arabic, German,
English, Spanish, French, Italian, Latvian, Dutch, Portuguese and Chinese.
Its news training domain does not establish accuracy for fictional worlds.
It can miss names and produce incorrect suggestions. All cards require an
explicit author action; no biography or other facts are inferred.

Preparation downloads four files with exact sizes and SHA-256 digests declared
in `electron/entityDetection/models.ts`. Inference loads only that local
directory, with remote model loading disabled, using CPU int8 ONNX weights.
No prose is sent to an inference service. The classifier is not a generative
language model. Name/alias links to existing cards use the separate local matcher.

Transformers.js 4.3.1 does not provide offsets in token-classification output.
Writer verifies the raw WordPiece token stream against exact source units
before mapping BIO labels to UTF-16 source spans. Unsupported alignment is
reported as an error instead of guessing a location from a decoded name.
Long documents use overlapping chunks bounded by actual tokenizer counts.
