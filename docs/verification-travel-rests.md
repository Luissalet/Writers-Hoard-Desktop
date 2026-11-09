# Configurable hard-pace rests — task2319

Source `a76ba8d31543331863274c4211247c205e792221` was independently approved at submission revision1 and integrated over `e634c65a82f861924ea633fc9c1e212ea7cae168`. The fast-forward held `merge:Writers hoard desktop`, matched13 approved blobs and preserved4681 other tracked paths and all remote refs. No push.

## Product behavior

`TravelProfile.hardRestEvery` accepts a positive safe integer. Absence and explicit six keep the legacy six-day interval; normalization omits six. Only hard pace adds rests. The solver counts the entire journey after joining legs, avoids an extra rest after arrival exactly at the interval, and supplies the same interval to arrival clocks and playback. Older route results without interval metadata retain six.

The normal Travel settings input merges this scalar into the stored world profile. Saved itineraries retain their own profile and opening one does not write it into the world. Reset restores six and built-in factors while retaining named ways. The existing MCP get/set/plan tools use the same normalizer and planner. MCP `profile` replaces the whole profile: clients preserving other factors or ways must read and resend it with `expectedRevision`. Undo retains the existing whole-profile/pace contract; this increment does not add field-level profile Undo.

## Independent checks

- Root executed the focused profile suite:17 checks, process EOF and exit0. A separate source-only peer read all13 frozen paths, the consumer map and evidence; that peer did not execute tests or Browser.
- In real Brave on a private origin, Root created a finite map and a named flying way at25% speed, with two moving hours per day. Hard interval3 produced5days2hours including one rest, arrival day6 at08:59. Interval6 produced4days2hours with no rest, arrival day5 at08:59. The route was124km/116km direct with62km over water; these are one synthetic case, not reference-map equivalence.
- Root saved an itinerary with interval3, closed it, changed the world to5, reloaded the page and reopened both world and itinerary. The itinerary restored3 and one rest; closing it returned to world5. An immediate snapshot still showed the preceding React state; a settled read confirmed5 without another edit. Playback at3.35 showed day4 as a rest day. Evidence: `brave-cold-itinerary-three.txt`, `brave-cold-world-after-close.txt`, `brave-cold-replay.txt`, `writer-rest-saved.jpg`.
- The real product bridge ran stdio → authenticated HTTP → IPC → dispatcher → renderer/Dexie/core using two distinct keys.11MCP calls and12IPC replies covered set/get/plan, interval3 versus legacy6, invalid0 and stale-CAS rejection without row changes. Normal authenticated HTTP `/api/undo` restored the profile while preserving a later pace edit. Both keys were revoked and then returned401; both stdio adapters exited0 with no stderr. This does not establish a named MCP tool `wh_undo` or two collaborative human authors.
- The Native fixture's interval3 plan was86.28days/21rests and legacy6 was75.28days/10rests. Its own projects/worlds ended at0/0; this is not a claim that all database tables were empty. The hidden renderer, port and adapters closed. Brave's separate Vite process and tab also closed.

## Other attributed evidence and preserved failures

The author executed41 area checks: profile17, playback3, route words7, journeys5, worker4 and named ways5, plus `verify:quick` exit0. Those include normal mounted input/save/open/reset, Base/era ownership, CAS/Undo, JSON, real ZIP import and duplication. They are not fresh executions by the source-only peer or by this documentation change.

Native preparation failures remain recorded: asset/raw URL loading, a virtual compiler-input record, and selecting the oldest audit event in the fixture. Only the final corrected harness passed; no product failure was concealed or asserted from those setup errors. Two initial Brave foot destinations were lake cells. A bounded diagnosis reproduced the complete NoRoute result identically in the previous source, delivered source, real worker and MCP; dry controls succeeded. The accepted Brave rest test used the author's flying way instead. No router fix was required.

Evidence root: `E:/Development/IA/Research/writer-parity-20261109/travel-rest2319`. The review, `CUT.json`, `INTEGRATION.json`, `root-profile-r1.log`, `root-native-r4.log`, `root-native-receipt.json`, `PRE-REVIEW.md`, author results and `finite-debug/REPORT.md` retain their separate scopes. Automatic approval review rejected deletion of the later finite-debug private profile/bundles with “blocked by policy” and no more specific reason. Their cleanup remains recorded as pending, with no live workers and no attempt through another route.

## Reference boundary and continuity

The live reference showed a fixed rest after three moving days and the same414km horse leg changing from Steady16½days to Hard16¾days. The first next-leg-only pace change did not affect that existing leg and is excluded as acceptance evidence. No editable rest interval was observed. This configurable feature is an independent improvement; no equality of route physics or complete parity is claimed. External APIs and paid capabilities are not required.

Task2324 updates the manual's existing Worldgen paragraph using a required Google revision and one readback. It preserves the current797 paragraphs, lists, styles and all unrelated content. Memory is append-only; one new Writer concept uses the existing Store API with embeddings disabled and previous graph rows/edges intact. The text-only SDK graph is outside this feature's scope. The full parity inventory and the100ms performance objective remain open.
