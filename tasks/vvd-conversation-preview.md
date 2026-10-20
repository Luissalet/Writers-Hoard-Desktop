# Offline conversation playback

- [x] Build a read-only chronological projection of the existing scene blocks and cast, including explicit parallel dialogue groups.
- [x] Add conversation bubbles, optional narration/stage directions, cast filtering, step/back/restart, timed auto-play/pause and responsive phone preview.
- [x] Integrate with SceneEditor after flushing buffered edits; source blocks and manuscript remain authoritative.
- [x] Test playback ordering/filtering, timer/keyboard/pane cleanup, unchanged source rows and the actual UI; inspect current-CSS screenshots.

This implements a locally authored conversation presentation. No equivalence to unobserved VVD behavior is claimed; there is no model generation or network dependency.

Source: VVD's official [Tools help article](https://vvd.crisp.help/en/article/tools-ttd107/) lists Conversation among its tools, but provides no detailed playback specification. Writer's implementation above is independently designed around its existing authored scenes.

Validation: `testConversationPreview` passes four groups covering model/ownership, real controls, timed playback/Space/arrows/Home/End, pause on hidden pane or browser window, timer cleanup, cast/type filters, simultaneous groups, literal untrusted markup and fresh flush-before-open with failure/retry. Current CSS and trusted pointer Next interactions verified by `scripts/run-conversation-preview-qa.cjs`; screenshots inspected at `work/conversation-preview-phone.png`, `work/conversation-preview-wide.png`, `work/conversation-preview-narrow.png`. Scoped ESLint passes. Renderer typecheck reports concurrent tool-block/genealogy work only; root owns final integration check.
