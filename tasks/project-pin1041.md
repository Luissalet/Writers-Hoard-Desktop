# W01 project pinning

Authenticated Worlds menu21October offers Pin to front (alongside Duplicate and
Delete). Writer getAllProjects currently orders only updatedAt and ProjectCard
has no pin action. Earlier inventory said favourites existed without evidence;
that assertion is withdrawn. This is a concrete gap.

Add optional pinned metadata, an always reachable card pin/unpin action and
pinned-first project order preserving updatedAt within each group. Existing
project listing reports pinned. One normal core mutation uses field CAS and the
ordinary audit Undo path; it must preserve unrelated project fields, reject a
stale expected flag, notify only after outer commit and retain retry after abort.
Legacy absence means false; import absence preserves existing metadata, explicit
false clears. Project/full JSON/ZIP/clone carry the pin.

Success: normal UI1440/640 pin/refresh/unpin/reopen (no project navigation from
the action), MCP/Undo/CAS/outer rollback and portable checks. Do not claim a
general Duplicate project operation from the older partial JSON clone. Existing
dirty project-switch guards require their own exact check; no parity certificate.
