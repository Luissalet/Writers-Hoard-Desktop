# C04 image crop/rotation verification

The inventory locates crop/zoom/rotation code but does not prove their output.
Before changing it, run the real overlay against an asymmetric synthetic raster,
rotate and confirm without dragging a crop. Verify output dimensions and corner
pixels against the requested orientation, while original bytes remain exact.
Also check a crop after rotation, zoom and reset, with actual native pointer
input at1440/640. Preserve any original failure; do not certify from CSS transform.

If a defect is reproduced, correct the existing transform/crop pipeline only,
retain the current onConfirm(cropped,original) contract and callers, and rerun
the unchanged oracle plus shell overlay/Escape regression. UI and normal Codex
storage/reading/MCP need a concrete bounded check before closure. No remote
upload or user image is needed.

Original native oracle failed Rotate→Attach: saved240×160 instead of160×240.
First driver attempt used the wrong Attach label; that QA failure is separate.
The existing canvas now preserves a complete transform without a selection and
maps selected coordinates through its centred rotated/zoomed origin. Confirmation
uses the current controlled crop, avoiding a stale zero-size completed snapshot.
Original rotation oracle passes2; native selection/zoom pixel oracle passes4.
The initial selection diagnostic and driver-key failures remain in projectless
logs; they are not all asserted to be product defects.

C02/C10 exact follow-up found that the category selector was gated to new cards.
The unchanged original UI test fails on an existing card. Removing that gate
exposes the existing preserving handler, with pressed-state semantics. Native
Base/era form Save/reopen/MCP full read passes2 including Unicode card-only field
and normalized collision, incompatible authored fields/references, rotated avatar
plus exact original. JSON clone and settled recapture are the final added checks.
Two earlier screenshots have old native frames/loading references despite newer
DOM; retain them as invalid visual evidence. No independent review yet.
