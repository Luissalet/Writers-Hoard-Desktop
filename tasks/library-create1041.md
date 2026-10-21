# Create a card inside a library folder

The current Library creates folders and moves existing documents, but cannot
create a Codex card directly inside the selected folder. The reference documents
describe creating a document nested under a sidebar item; this is a concrete
offline workflow, separate from whole-project duplication.

- Reuse the normal Codex form, its templates, recovery and Save/Cancel behavior.
- Offer New card inside Library, keeping the selected folder as an explicit
  destination. Load the form lazily; no second editor implementation.
- Save card and placement atomically with the observed library revision, in Base
  or the explicit named era. A removed/moved destination or stale library must
  retain the form and create no orphan card.
- Extend the existing create-card MCP capability with optional folder placement;
  existing calls keep their existing behavior. Composite audit Undo removes its
  own unchanged card and placement without reverting unrelated library edits.
- Verify normal UI at 1440/640, template blocks copied independently, named-era
  isolation, conflict/rollback/engine-off and MCP/Undo. Do not infer guided NLP
  restructuring or every tool's creation workflow from this card workflow.

Author verification: core4, actual external MCP/HTTP Undo2 and native UI4 pass.
The808-tool contract, renderer and Electron typechecks pass. Detector once:[];
scoped lint passes. Original QA registration-path FAIL and the first scrolled
form captures remain historical. The capture-only second round shows the
destination field; it does not change behavioral assertions. Final UI emits one
React act warning from a live query; all four scoped workflows pass.

Packet: .impeccable/review/library-create1041/PACKET.md and provenance.json.
Independent functional/finish review: SHIP within this card-creation contract.
Report: `D:/LocalAI/projectlesswork/library-independent-review.md`, SHA256
`d639f1858c9c35384624f2516fdb612a6bec6d48785ef9f2f796af5615cc408d`;
proof: `D:/LocalAI/projectlesswork/library-independent-proof.json`, SHA256
`5677c3d74cc61527733131431ecaf6a6c55bfe044bc3eeb42f5f90ce7b7e065f`.
Final integration and global QA remain separate and open; this verdict does not
certify unrelated map corrections, renderer budget or an installed release.
