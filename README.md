# VantSide Meta

**Your experience. Ready when you need it.**

VantSide turns a resume and ongoing voice conversations into a growing, personal Career Memory. It helps people prepare for specific opportunities and recall their own experience through clear, timely visual cues.

Built as a new desktop prototype for the **Meta Global AI Developer Hackathon (October 26–November 4, 2026)**.

## How it works

1. **Your Resume** — Add a PDF or Word resume. VantSide identifies your professional background.
2. **Let's Talk** — Have a natural, profession-aware voice interview. Return whenever you like to add more depth to your Career Memory.
3. **The Opportunity** — Add a job description. VantSide connects the role to your experience and asks relevant follow-up questions.
4. **Your Interview** — Practice for each round with contextual visual reminders. What you learn can strengthen future preparation.

Career Memory carries forward between opportunities. Job-specific information stays with the relevant opportunity. The user reviews proposed career facts before they become approved memory.

## What we're building for the hackathon

A new Tauri 2 desktop experience using Meta's models for resume understanding, adaptive voice transcription and reasoning, and evidence-grounded visual cues. **The live build is still evolving; not every part of the experience above is implemented.** Earlier text and sample-data experiments are development tests, not the product.

- **Platforms:** Windows x64 first; macOS Intel and Apple Silicon build targets.
- **AI:** Meta Model API, including Muse Spark and Muse Voice Transcribe.
- **Experience:** Practice sessions only, with clear microphone controls and no covert interview assistance.
- **Future direction:** Open-source, provider-independent BYOK (bring your own key).

## Responsible use

VantSide is for interview preparation and practice—not cheating. It helps people recall and explain their own verified professional experience. It does not secretly assist during real employer interviews, answer coding challenges or legal or medical competency assessments, or complete evaluations on anyone's behalf.

Microphone capture requires explicit consent and visible controls. Career facts must be grounded in user-approved information. These boundaries apply to the activity, not the profession: engineers, legal professionals, and healthcare workers can all use VantSide for legitimate practice.

See [GUARDRAILS.md](GUARDRAILS.md) for the full responsible-use requirements.

## Run locally

Requires Node.js and the Tauri 2 toolchain for desktop development.

```powershell
npm install
npm run backend:dev
```

In a second terminal:

```powershell
npm run tauri -- dev
```

Copy `.env.example` to `.env.local` and configure your own API credentials first. Never commit `.env.local`. The current backend is local to your machine; it is **not** a secured public API service.

## Project documentation

- [PRODUCT.md](PRODUCT.md) — product journey and priorities
- [DESIGN.md](DESIGN.md) — interface and motion
- [ARCHITECTURE.md](ARCHITECTURE.md) — models, services, memory architecture
- [GUARDRAILS.md](GUARDRAILS.md) — consent, evidence, and interview boundaries
- [AGENTS.md](AGENTS.md) — development instructions

## Hackathon disclosure

The VantSide concept predates the event. This repository contains a newly authored hackathon implementation, not the original application's code. The final demo will distinguish the new work from the earlier concept. Submission deadline: November 4, 2026, 9 PM Eastern.
