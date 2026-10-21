# Local visual search models

Writer uses compatible CLIP image/text embeddings for local Gallery ranking.
Model weights are unchanged and downloaded only through explicit preparation.

- Image encoder: Xenova/clip-vit-base-patch32, revision
  `d15189d7028b43f1d3e65039190477f6af591c2a`, ONNX int8 vision model.
  [Conversion](https://huggingface.co/Xenova/clip-vit-base-patch32), based on
  [OpenAI CLIP](https://github.com/openai/CLIP), Copyright (c) 2021 OpenAI,
  MIT license reproduced in LICENSE-CLIP-MIT.txt.
- Text encoder: sentence-transformers/clip-ViT-B-32-multilingual-v1,
  revision `58edf8cada9e398793dca955574a48cbb7f18be2`, ONNX int8 AVX2 model
  and its original dense projection. [Model and authors](https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1).
  Apache License 2.0 reproduced in LICENSE-TEXT-APACHE-2.0.txt.

The multilingual text encoder uses attention-mask mean pooling and its original
768-to-512 dense projection. Image and text embeddings are normalized before
cosine comparison. Scores are ranking similarities, not probabilities or factual
descriptions of an image. The model can rank poorly for unusual illustrations,
fictional subjects and languages outside its training coverage.

Eight assets total 228,035,598 bytes. Exact sizes, SHA-256 hashes and pinned
download URLs live in electron/visualSearch/assets.ts. Downloads are atomic and
validated before loading. Inference loads only local paths with remote loading
disabled, using the CPU. No image or query is uploaded. Derived image vectors
are cached by model revision and image-byte SHA-256 outside authored project data.

Runtime libraries retain their own licenses in production dependencies:
Transformers.js (Apache-2.0), ONNX Runtime (MIT), Sharp (Apache-2.0) and its
packaged native libraries. No model weights are included in the application installer.
