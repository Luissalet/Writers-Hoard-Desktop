---
version: 1
slug: fiction
primary_target: src/engines/fiction/FictionEngine.tsx
related_targets: ["route:/fiction", "src/engines/fiction/NativeSurface.tsx", "src/engines/fiction/native/styles.css"]
---

# Interactive fiction in Writer

## Mode

Operate. The user selects which optional functions run, opens a world and manages its story state.

## Scope and authority

Local extension of Writer's existing interface. Luis requested all functions and data be preserved, optional functions be independently controlled, everything begin disabled, and Hoard aesthetics and icons remain coherent. This is the confirmed brief; it introduces no redesign or unconfirmed product claims.

## Existing visual language

Use Writer's existing charcoal surfaces, gold accent, Cinzel title stack, Source Sans 3 UI stack and Lucide navigation. src/index.css is the current token authority. Fiction's internal navigation adopts those tokens through its isolated stylesheet. Faustus uses the shared canonical SVG and coral accent. Keep prose legible and controls consistent with the incumbent editor.

## Required states

Four visible OFF switches and clear explanation on first open; worlds/play can be enabled without narration, voice or illustrations. Changing the data directory requires worlds/play OFF. Loading, errors and disabled controls remain explicit. The native twelve-section world interface appears after enabling fiction. Faustus connects only from its explicit button.

## Preservation constraints

Keep the full native story UI and its public form context, existing world data path, undo, exports and compatibility tool names. No iframe to an old server, automatic model loading, background polling or new startup service. The worker closes after disabling fiction and when the app exits.

## Verification boundaries

Desktop Electron captures and synthetic API/MCP tests cover this merger. No mobile redesign, real profile opening, Sparks execution, provider benchmarking or accessibility certification is claimed. Independent finish review is coordinated before integration.
