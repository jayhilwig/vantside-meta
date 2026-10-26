# VantSide Meta

**A live visual memory interface for spoken interview practice.**

VantSide Meta is a new, standalone Indie Developer entry for the Meta Global AI Developer Hackathon, October 26–November 4, 2026. It listens during a consensual practice interview, recognizes the topic of the conversation, and surfaces short, evidence-backed visual cues drawn from the participant's own career materials.

## The experience
1. Import a resume and optionally an image or PDF of past work.
2. Review a structured career memory of projects, facts, outcomes, and supporting evidence.
3. Choose a mock-interview scenario, grant microphone access, and start a clearly labeled practice session.
4. As questions are spoken, see relevant, compact, updating visual cards—not a wall of generated answers.
5. Stop the session; optionally review its transcript and cue history.

## The one thing the demo must prove
A spoken question causes an appropriate, trustworthy cue to appear quickly, and a follow-up question causes the cue to update appropriately. This must work in a real session, not only in a prerecorded animation.

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
- [AGENTS.md](AGENTS.md) — instructions for Codex and other coding agents

## Proposed stack
Next.js / React / TypeScript / Tailwind; Meta Model API for Muse Spark and Muse Voice Transcribe. Local-first storage for demo materials where practical. Exact audio transport and SDK integration must be validated against current official documentation before implementation.

## Local setup
To be filled in after the new application is initialized. Do not add example API keys or live customer data to the public repository.

## Credit and billing safety
The developer account shows $150 in promotional credits, but a payment method is required to make Model API calls. Do not assume notifications are hard spending limits. Confirm actual balance, account controls, and billing behavior before testing live calls.

## License
Follow the license selected on the new GitHub repository; don't import the original app's code or assets as a shortcut.
