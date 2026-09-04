# Visual references — the character who looks the same in chapter 30

Branch `wh-visualref`. Contract W-B.

## Plan

- [ ] `src/types/visualRef.ts` — `VisualRef` (every field optional but id/name/kind/dialect),
      the resolver's input/output shapes.
- [ ] Dexie v29 — `visualRefs` table, additive, with the version comment the file
      already uses for every other version.
- [ ] `src/services/visualRef/resolve.ts` — the pure resolver. No I/O, no clock,
      no dice: the caller rolls the seed and hands it in, so the same inputs
      always give the same `ResolvedGeneration` and a test can diff two.
- [ ] `src/services/visualRef/dialect.ts` — tag ↔ prose adaptation.
- [ ] `src/services/visualRef/mentions.ts` — `@Name` → ref, pure.
- [ ] `src/services/visualRef/dataset.ts` — captions drafted from the codex entry,
      the image/caption pairs, the ai-toolkit YAML and the musubi-tuner TOML.
- [ ] `src/engines/image-studio/` — refs CRUD, backup strategy, the three-column
      composer, the resolved-prompt disclosure, the actions.
- [ ] Locale keys, en + es.
- [ ] Tests in `tests/visual-ref.ts`, run from the critical harness.

## Order of work

The no-backend state first: a ref with a name, a fragment and an uploaded
portrait must be useful before a single pixel is generated.
