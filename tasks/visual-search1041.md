# Local visual search — 1041

## Contract and criteria before implementation

Reference: VVD changelog13September2026 describes image search by content (castle/desert with an unhelpful filename). Filename/tag matching is already present and does not satisfy this contract.

Implement optional on-device visual embeddings in the existing Gallery. Preserve text/tag/album filters and add a distinct content-search mode. Images and queries stay on the computer. A normal first-use preparation action downloads fixed model assets; subsequent indexing/search must work with network unavailable. Use a CPU worker, no text-generating LLM or global model service. Reuse embeddings by image-byte hash and invalidate them when bytes or model revision change. Do not persist derived vectors inside authored project backups.

Models: original CLIP ViT-B/32 vision encoder, aligned multilingual Sentence Transformers text encoder and its512-dimensional projection. Verify actual output dimensions and original dense layer before using a third-party ONNX conversion. Preserve licenses and pinned revisions. Quantized inference is acceptable only after a real image/query ranking test in Spanish and English.

Success criteria: two unrelated images with opaque filenames and empty tags rank by actual pixels in Spanish/English; replacing bytes invalidates the old embedding; restart/search without network or provider access passes; native Gallery at1440/640 shows working status/results and existing filters; registered MCP setup/status/search use the same service; native IPC role checks, failure/retry, packaged dependency resolution and normal build pass. No claim of perfect recognition or accuracy equivalence from a small fixture.

## Status

- [ ] Verify model output/projection with actual CPU inference.
- [ ] Implement worker + normal IPC/MCP + Gallery mode.
- [ ] Test scoped ranking/invalidation/offline restart, UI and packaged resolution.
- [ ] Independent review and final documentation.
