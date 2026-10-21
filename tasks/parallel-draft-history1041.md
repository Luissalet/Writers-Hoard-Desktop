# Per-draft history and publication selection — 1041

## Contract before implementation

The reference chapter/draft documentation establishes distinct alternatives per
chapter. The reconciled Q05/Q16 audit found that Writer's mutable parallel draft
rows have no history of their own and publication always takes canonical prose.

Reuse writingSnapshots with an additive `parallel-draft-history` discriminator,
sourceDraftId and sourceDraftVersion. Every successful prose replacement records
the prior alternative inside the same transaction, including empty text; identical
text does not add history. Failed CAS and aborted transactions do not add history.
Renames preserve identity. Ordinary chapter history excludes these rows. Lists
project only metadata; bodies are read on explicit selection. Restore checks exact
project/era/chapter/draft identity and current version, then uses normal draft save
so the replaced text is itself recoverable. Never promote a draft implicitly.

Publication accepts an optional chapterDraftIds map. Capture alternatives in the
same consistent R snapshot, substitute only selected chapter prose, record source
draft identity/name/version and freeze the usual Reader artifact. Commit rechecks
the source fingerprint. Foreign, deleted, wrong-chapter and non-parallel rows fail.
Legacy editions and callers remain valid. UI provides explicit per-chapter draft
selection and restores selection on republish. JSON/ZIP/clone remap semantic draft
references and retain immutable artifact bytes.

## Success criteria

- [x] Two divergent alternatives retain independent history across save/rename/restore.
- [x] CAS, outer rollback, wrong draft/project/era and empty content behave correctly.
- [x] Ordinary history remains separate; metadata lists do not retain bodies.
- [x] Publish one alternative without promotion; canonical and other draft unchanged.
- [x] Snapshot race refuses stale publication; frozen edition survives source deletion.
- [x] Base/era and JSON/full/ZIP/clone preserve/remap identities.
- [x] Normal 1440/640 UI, MCP external transport and relevant regressions pass.

Root owns this slice. Wiki agent reads but does not edit the shared publication
snapshot provider; it receives notice before these additive snapshot changes.

## Verification

Own functional5, UI2, external native7 and existing draft9/publication3 groups pass. Independent seven exports plus native transport pass after two reproduced P2 fixes: failed-CAS recovery does not add committed alternative history, and canonical restore refuses alternative-history rows. Reports preserve the failed runs. Generic-CSS screenshots require the task-wide corrected-loader replay before visual closure.
