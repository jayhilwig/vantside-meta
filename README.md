# VantSide Meta

**A live visual memory interface for interview practice.**

VantSide Meta is a new, standalone Indie Developer entry for the Meta Global AI Developer Hackathon, October 26–November 4, 2026. The Milestone 1 demo accepts simulated interviewer questions as text and surfaces compact cues from clearly labeled synthetic examples. Voice capture and personal career materials are not implemented yet.

## The experience
1. Type or choose a simulated interviewer question.
2. Muse Spark matches it to a small set of clearly labeled synthetic examples.
3. Review a concise visual cue and expand its cited synthetic source notes.

## The one thing the demo must prove
An interview question causes a relevant, source-backed cue to appear, and a follow-up changes the cue appropriately. Milestone 1 exercises this loop with text input and synthetic examples; voice integration remains future work.

## Hackathon boundary
- This is a **fresh implementation**, not a fork or repackaging of the pre-hackathon VantSide codebase.
- Pre-existing VantSide concepts and visual references are disclosed. No pre-hackathon source files, custom assets, or configuration are imported into this submission.
- The submitted repository contains only work created during the hackathon (plus clearly identified third-party dependencies and permitted datasets).
- The three-minute demo opens by identifying the pre-existing concept and the new implementation.
- Public repo: keep API keys, private resumes, transcripts, and confidential work artifacts out of Git.
- Hackathon submission due November 4, 2026, 9:00 PM ET / 6:00 PM PT.

## Documentation
- [PRODUCT.md](PRODUCT.md) — scope, users, workflow, acceptance criteria
- [DESIGN.md](DESIGN.md) — visual system and interaction requirements
- [ARCHITECTURE.md](ARCHITECTURE.md) — Meta AI services, data flow, security, testing

- [GUARDRAILS.md](GUARDRAILS.md) — practice, evidence, consent, and restricted-evaluation boundaries
- [AGENTS.md](AGENTS.md) — instructions for Codex and other coding agents

## Stack
Tauri 2 with a static-exported Next.js App Router frontend, React, TypeScript, Tailwind CSS, Zod, and the Meta Model API using Muse Spark 1.3. A separate loopback-only Node cue service reads `MODEL_API_KEY`, `META_API_BASE_URL`, and `META_MODEL` from the environment. The desktop bundle contains no Meta credentials. Voice transcription is not included yet.

## Local setup
1. Use Node.js 20.9 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and set the Meta API variables. Keep `NEXT_PUBLIC_CUE_API_BASE_URL` on loopback; it is a public build-time address, not a credential.
4. Run `npm run backend:dev` in one terminal. It binds only to `127.0.0.1:8787` by default. If you change `CUE_API_PORT`, set `NEXT_PUBLIC_CUE_API_BASE_URL` to the matching loopback origin before building the frontend.
5. Run `npm run dev` for the browser preview, or `npm run tauri dev` for the Windows shell. The backend must remain running for cues.

The desktop frontend can be packaged with `npm run tauri build -- --no-bundle`. It exports to `out/`. No hosted API is deployed: origin checks and in-process request limits on the local service do not authenticate users. A public HTTPS deployment needs server-side session authentication, durable per-user quotas, and a spending cap before the client URL can be changed.

Run `npm run lint`, `npm run typecheck`, and `npm run build` before sharing changes. Never put keys in client-side code or commit `.env.local`.

## Credit and billing safety
The developer account shows $150 in promotional credits, but a payment method is required to make Model API calls. Do not assume notifications are hard spending limits. Confirm actual balance, account controls, and billing behavior before testing live calls.

## License
Follow the license selected on the new GitHub repository; don't import the original app's code or assets as a shortcut.
