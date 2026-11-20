---
name: production-dossier
description: Compile a chapter's story context and approved visual references for production, or send it as a studio draft.
---

# Production dossier

1. Use `wh_list_projects` and `wh_list_writings` to resolve the project and chapter IDs. Use `wh_create_project` when asked to start a new project.
2. Save the author’s exact visual style with `wh_update_project_details` and the local hour and requested continuity details with `wh_update_writing`. Record carried objects and the setting in the chapter's state ledger and use the Image Studio to choose references.
3. Call `wh_production_dossier` once with the chapter and the subject. Use `kind: "character"` or `"place"` with the relevant Codex ID, or `kind: "scene"` with an optional scene ID. Inspect missing fields and reference availability. Use `wh_view_image` to look at the listed image IDs when needed.
4. For a studio draft, call `wh_production_to_prospero` with the same scope. Read the received dossier and asset IDs with `studio_production`. Carry `preserveDetails` into later illustration, video and 3D work and check each item against the result.
5. To undo, use the bridge’s returned undo handle. Changes made in the studio after import are kept.

For narrative production, register an `editorial-dossier` from the
`production-brief`, then a `manuscript` from the dossier. Reread the writing
and its `wh_state_ledger` against the dossier. Return a continuity defect with
`hub_agora_piece_defect` to the writing job, with the passage and the expected
state. Recheck the revised manuscript and close resolved defects against that
revision. Register the reviewed DOCX or text as `reviewed-manuscript` with the
current manuscript as material.

Use `wh_document_pdf` for document layout or `wh_publishing_export` for a
project EPUB. Link the PDF to the reviewed manuscript as material and call
`hub_piece_validate_record` with `profile: "narrative"` and the target length
and page count. Put a note under each outstanding native defect ID in
`continuity_declarations` when it needs to appear with the export. The
declaration leaves the defect open for review.
