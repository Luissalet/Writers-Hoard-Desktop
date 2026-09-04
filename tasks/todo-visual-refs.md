# Visual references — the character who looks the same in chapter 30

Branch `wh-visualref`. Contract W-B.

## Plan

- [x] `src/types/visualRef.ts` — `VisualRef` (every field optional but id/name/kind/dialect),
      the resolver's input/output shapes.
- [x] Dexie v29 — `visualRefs` table, additive, with the version comment the file
      already uses for every other version.
- [x] `src/services/visualRef/resolve.ts` — the pure resolver. No I/O, no clock,
      no dice: the caller rolls the seed and hands it in, so the same inputs
      always give the same `ResolvedGeneration` and a test can diff two.
- [x] `src/services/visualRef/dialect.ts` — tag ↔ prose adaptation.
- [x] `src/services/visualRef/mentions.ts` — `@Name` → ref, pure.
- [x] `src/services/visualRef/dataset.ts` — captions drafted from the codex entry,
      the image/caption pairs, the ai-toolkit YAML and the musubi-tuner TOML.
- [x] `src/engines/image-studio/` — refs CRUD, backup strategy, the three-column
      composer, the resolved-prompt disclosure, the actions.
- [x] Locale keys, en + es.
- [x] Tests in `tests/visual-ref.ts`, run from the critical harness.

## Order of work

The no-backend state first: a ref with a name, a fragment and an uploaded
portrait must be useful before a single pixel is generated.

## Review

**What is live today.** The whole resolver runs: the LoRA branch (family
matched against the model, trigger word first), the fragment splice with the
tag ↔ prose adaptation, the cfg-1 negative refusal, the hero-seed / explore /
manual seed choice, and every refusal line in the disclosure. The store, the
migration, the backup strategy, the composer, the results grid, the recipe
diff, "where does she appear?" and the training-set export are all live.

**What is waiting on the AI-runtime branch.** Three resolver branches can be
*reached* but nothing reports the capability yet, so they never fire:
reference images (needs a model to report `image-editing` or the widened
`identityAdapters`), PhotoMaker (`identityAdapters`), and ControlNet
(`controlNets`). Each is tested against a synthetic model that does report it,
so they are proven, not hypothetical. On the request side, `REQUEST_SUPPORTS`
in `operations.ts` is a TYPE, not a comment: the day `AiImageRequest` grows
`sampler`, `scheduler`, `referenceImages` or `controlNets`, the `false` in that
table stops compiling and names the line to flip.

**Deliberate choices worth a second reader.**

* Parameter fields the model cannot honour are shown **disabled with a reason**
  rather than removed. The contract asks for both ("fields hide themselves" and
  "never hidden, always with a reason"); disabled-with-a-reason satisfies the
  stricter half, and a removed cfg slider teaches the writer this program has
  no cfg slider rather than that this model has a fixed one.
* The dataset export goes out as a ZIP. Writing a folder straight to disk would
  need a new door in the main process, which belongs to another branch.
* `deleteVisualRef` never deletes the Gallery rows a reference points at. They
  were the writer's pictures before any reference named them.
