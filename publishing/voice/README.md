# Local voice memos

Writer's Media engine includes a Voice memos view. A memo groups local audio recordings without changing their original bytes. Recording writes a durable checkpoint every MediaRecorder chunk, pauses after a minute of silence, and releases the microphone when the view closes. A recovered clip retains the fragments saved before interruption; final fragments still held by the operating system cannot survive a process crash.

Select a recording to play, drag its waveform, seek with the arrow keys, change speed, or expand the player. Local recognition produces timed segments and word anchors. Editing a segment keeps its original recognition and timing anchors; edited text is not presented as newly aligned speech. Draft text survives closing the view. TXT, SRT, WebVTT, JSON and original audio exports use the same core operations as MCP.

The selected world era controls the effective media collection, transcript edits and Codex names supplied to recognition. Base remains available independently. The era store deduplicates unchanged audio bytes across metadata versions.

## Runtime

`npm run voice:setup` prepares dependencies in the product's existing `publishing/.venv`. `npm run voice:bundle` builds the private PyInstaller runtime at `publishing/runtime/voice/writer-voice-worker`. Desktop builds include that directory as a resource; installed users do not need Python. The normal **Set up local speech** button prepares the official speech model if it is absent. That explicit preparation may need a connection. Subsequent recognition uses local files only.

Recognition uses SYSTRAN faster-whisper, CTranslate2 CPU int8 and the multilingual tiny model. It runs in one private process at a time, without a listening server, another Hoard, a text LLM or GPU. Existing Hugging Face cache models may be read; the product model directory is the other supported location. Status checks do not load the model. Cancellation terminates only this runtime's own job. Recognition quality depends on the recording, language and the tiny model; words and timestamps remain editable.

`VoiceRuntimeAPI` in `src/engines/media/voiceTypes.ts` is the renderer/main contract. `electron/media/register.ts` exports `registerVoiceIpc(assertSender)`, `configureVoice` and `closeVoice`. Thirteen `wh_voice_*` tools expose the normal product workflows, including memo and transcript revision checks and explicit reconciliation when recognition finishes after a concurrent text edit.

## Provenance and tests

The worker and product integration are original Writer code using the documented [faster-whisper API](https://github.com/SYSTRAN/faster-whisper), licensed under MIT. The explicitly downloaded model is [SYSTRAN/faster-whisper-tiny](https://huggingface.co/Systran/faster-whisper-tiny). PyInstaller packaging retains dependency distribution metadata and license files. PyAV is pinned to 16.0.1 because later decoder API changes are incompatible with faster-whisper 1.2.1.

`node tests/voice-runtime.mjs` tests development and frozen runtimes against a Windows SAPI file fixture. `tests/voice-depth.runner.cjs`, run with Electron and `ELECTRON_RUN_AS_NODE` unset, tests registered MCP dispatch, real IPC recognition, IndexedDB, actual Media UI, native pointer/keyboard seeking, recovery and era isolation in a temporary profile. Only capture is synthetic; these tests never open a real microphone or output sound.
