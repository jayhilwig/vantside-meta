# AGENTS.md — VantSide Meta

You are building an original, standalone October 26–November 4, 2026 Meta hackathon entry. Read `README.md`, `PRODUCT.md`, `DESIGN.md`, and `ARCHITECTURE.md` before making changes.

## Hard constraints
1. **New hackathon code only.** Do not copy any pre-event VantSide file, source function, component, asset, or configuration into the submitted project. The original VantSide may be inspected for concepts only, read-only, if access is explicitly granted. Do not modify it.
2. Keep the new repository public-safe: no secrets, personal transcripts, private resumes, confidential screenshots, or unlicensed assets. Keep `.env.local`, build output, logs, and uploaded documents out of Git.
3. Use Meta models meaningfully. The P0 loop must be real spoken question -> Meta voice transcription -> Meta reasoning -> live visual cue. A fixture may accelerate development but cannot be represented as actual live model output.
4. The signature opening black ribbon/white perspective-dot animation must be authored anew from reference screenshots. Respect reduced motion.
5. Focus on **practice interviews**, not covert assistance during prohibited real interviews. Avoid job screening, personality scoring, generic RAG/chatbot, or dashboard-centric features.
6. Never generate invented career facts, fake numerical outcomes, or fabricated source attribution.
7. Never assume specific Meta SDK or streaming endpoints without consulting current official docs. Run integration smoke tests and document confirmed behavior.
8. Do not spend money or enable auto-billing without explicit approval. Promotional credits are not necessarily a hard limit.

## Workflow
- Work in small verifiable slices: plan -> implement -> test -> report. Prefer clear Git commits showing only hackathon-period work.
- Keep type-check, lint, and automated tests passing. When implementing a new service, add a mocked contract test and a separately invoked live integration smoke test.
- Prioritize the smallest working demo before extra polish or backend infrastructure.
- Document tradeoffs in `ARCHITECTURE.md`; reflect changed scope in `PRODUCT.md` and changed UI tokens in `DESIGN.md`.
- Do not edit any file outside the VantSide Meta workspace without explicit permission.
- On each meaningful completion, report: files changed, behavior verified, known gaps, and next smallest step.

## Implementation order
1. Bootstrap fresh app, styling, README and `.gitignore`.
2. Re-create signature opener and a simple live-session shell.
3. Add Meta Spark server adapter and validated visual cue schema.
4. Add Meta Voice Transcribe stream integration, audio permission lifecycle and final utterance events.
5. Connect question/turn -> cue card, test with real calls.
6. Add multimodal career-material import only after the core loop is reliable.
7. Prepare three-minute demo and disclosure of pre-existing concept.

## Reference disclosure for demo
"The VantSide concept and visual references existed before this hackathon. This standalone application, Meta model integrations, and real-time visual cue workflow were newly implemented during the event." Update this statement to accurately match the actual final deliverable.
