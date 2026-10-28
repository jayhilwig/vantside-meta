# VantSide Meta

**Your experience. Ready when you need it.**

VantSide is a living professional Career Memory: a place to build a source-grounded understanding of your work through a resume and conversations, then recall relevant experience while preparing for a specific opportunity. The intended product supports growth across sessions and opportunities.

Built as a new desktop prototype for the **Meta Global AI Developer Hackathon (October 26–November 4, 2026)**.

## How it works

1. **Your Resume** — Add a resume and review proposed career facts.
2. **Let's Talk** — Build an approved Career Memory through a foundational conversation; return to deepen it.
3. **The Opportunity** — Add a job description and confirm the company and role.
4. **Your Interview** — Practice with compact reminders grounded in your approved experience.

In the intended product, Career Memory carries forward between opportunities, while job-specific information stays with the relevant opportunity. Proposed career facts require user review before approval.

## What we're building for the hackathon

A new Tauri 2 desktop experience using Meta models for resume understanding and evidence-grounded visual cues. The current static Next.js build has four steps: PDF fact proposals and approval; a resume-led foundational interview with microphone answers or a text fallback; pasted or PDF job-description identification and confirmation; and personalized text-to-cue practice. The loopback-only Node backend keeps the Meta key server-side. Personal PDF, microphone, and packaged desktop calls still need live verification.

Step 2 records one answer at a time and sends a short WAV clip to Meta Muse Voice Transcribe after **Finish answer**. The user can correct the transcript before Muse Spark selects a follow-up. Questions currently display as text; Meta Voice Transcribe does not generate speech. Cross-restart Career Memory, multi-opportunity and round history, and company/interviewer research are **not implemented**. Career Memory and job context exist only during the active app session.

- **Platforms:** Windows x64 first; macOS Intel and Apple Silicon build targets.
- **AI:** Muse Spark for questions and memory proposals; Muse Voice Transcribe for completed microphone answers.
- **Experience:** Practice sessions only, with explicit microphone controls and no covert interview assistance.
- **Future direction:** Open-source, provider-independent BYOK (bring your own key).

## Run locally

Requires Node.js 20.9 or newer and the Tauri 2 toolchain for desktop development. Copy `.env.example` to `.env.local` and configure the Meta variables first. Keep `NEXT_PUBLIC_CUE_API_BASE_URL` on loopback; it is a public build-time address, not a credential. The backend binds to `127.0.0.1:8787` by default.

```powershell
npm install
npm run backend:dev
```

In a second terminal:

```powershell
npm run tauri -- dev
```

Never commit `.env.local`. The current backend is local to your machine; it is **not** a secured public API service. A public deployment needs real authentication, durable request quotas, and a spending cap.

To test on Windows: approve a resume PDF, open **Let's Talk**, acknowledge the practice and consent statement, start the interview, record one answer, select **Finish answer**, review the transcript, then continue. Use **Pause** to discard a recording or **Stop interview** to end capture and cancel pending interview requests. No audio or transcript is saved to disk.

## Project documentation

- [PRODUCT.md](PRODUCT.md) — product journey and priorities
- [DESIGN.md](DESIGN.md) — interface and motion
- [ARCHITECTURE.md](ARCHITECTURE.md) — models, services, memory architecture
- [GUARDRAILS.md](GUARDRAILS.md) — consent, evidence, and interview boundaries
- [AGENTS.md](AGENTS.md) — development instructions

## Hackathon disclosure

The VantSide concept predates the event. This repository contains a newly authored hackathon implementation, not the original application's code. The final demo will distinguish the new work from the earlier concept. Submission deadline: November 4, 2026, 9 PM Eastern.
