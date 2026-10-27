# VantSide Meta — Product Specification

**Version:** Hackathon scope, October 26, 2026  
**Theme:** Build for Your World  
**Track:** Indie Developer  
**Status:** The text-only practice UI and synthetic cue flow are packaged for a Tauri 2 desktop shell. The Meta cue service runs separately on loopback for this prototype; Windows runtime and live desktop cue behavior still require manual verification. Voice and personal-material import remain unimplemented.

## 1. Problem and proposition
During stressful conversations people struggle to recall specific examples and metrics from their own experience. Traditional interview-preparation tools generate scripts or generic chat responses. VantSide Meta instead presents *small, timely visual memory cues*, grounded in the user's own documented work, during an explicitly consensual practice interview.

**Product promise:** Your own experience, surfaced at the moment it's useful.

## 2. Target user and demo scenario
Primary user: an experienced professional practicing interviews about complex past work. First demo user: a product designer discussing research, product decisions, workflows, and measurable outcomes. The design should generalize to other professions without building industry-specific features during the event.

Do not build applicant screening, personality scoring, covert interview assistance, or claims about hiring outcomes.

## 3. Primary journey
1. **Prepare (Milestone 1):** Start with a small, clearly labeled set of synthetic project examples.
2. **Practice (Milestone 1):** Type or select a simulated interviewer question. No microphone is used.
3. **See cues (Milestone 1):** A server-side Muse Spark request matches the question to approved synthetic facts. The validated visual card shows a project, up to three short cue phrases, and expandable source notes. No unsupported outcome or metric is introduced.
4. **Later:** Import and review personal materials, use explicit microphone permission and Meta Voice Transcribe, then connect final transcript turns to the same cue flow.

## 4. MVP priorities
### P0 — Must work for the three-minute demo
- New app with usable desktop-first responsive UI and opening animation. **Done in Milestone 1.**
- A clearly labeled synthetic demo profile. **Done in Milestone 1.**
- Server-side Muse Spark call with schema validation. **Implemented in the separate loopback service; packaged desktop request remains to be manually verified.**
- Text input to exercise questions and follow-ups before voice integration. **Done in Milestone 1.**
- Meta Muse Voice Transcribe streaming speech-to-text with clear microphone permissions and transcript state. Validate service/browser integration first.
- Event-driven cue updates when a new interview question or significant follow-up is detected.
- UI states: idle, microphone permission, listening, thinking, cue ready, error, stopped.
- Source-backed cues; avoid invented metrics and fabricated professional achievements.

### P1 — If P0 is stable
- PDF/image ingestion with Muse Spark multimodal extraction, confirmation and evidence mapping.
- Cue history and transcript review.
- Reliable device-selection and audio-input testing.

### P2 — Only with time left
- Second-person speaker differentiation, supplemental document formats, Baseten latency benchmarking, more elaborate animations.

## 5. Explicit exclusions
See [GUARDRAILS.md](GUARDRAILS.md) for the practice-only boundary, evidence requirements, restricted evaluations, consent, retention, and conservative fallback behavior.

- Live hidden assistance in actual employer interviews; sessions are designated mock/practice.
- Employer candidate screening, applicant ranking, or personality inference.
- A generic resume chatbot, dashboard-first workflow, or simple RAG/search demo.
- Automatic content generation that impersonates professional experiences.
- Full account management, payments, team collaboration, browser extensions, deep recruiting integrations, complex job tracking.

## 6. Product behaviors
- Quiet by default. Cards animate subtly into place and never obstruct the entire conversation.
- No stale answers masquerading as current: show timestamp/status and preserve previous card while a new one is being prepared.
- If the model cannot identify a trustworthy match, say 'No verified memory match' instead of guessing.
- User can correct memory entries; generated content cannot silently overwrite approved facts.
- No automatic audio storage. Retention, if enabled, is explicit and explained.
- Keyboard accessible controls and reduced-motion accommodation.

## 7. Testable acceptance criteria
1. A fresh Tauri desktop session can launch the practice workflow with explicit microphone permissions; the current browser/text demo is an interim step.
2. At least three different spoken questions elicit distinct, relevant cues using actual Meta inference.
3. A follow-up changes or refines the existing card without flooding the UI with text.
4. Every factual cue is traceable to a memory item and no unsupported numerical outcome is invented.
5. An outage or API error produces a recoverable message; session termination stops audio capture.
6. The public repo can be opened anonymously and contains no proprietary legacy VantSide source or credentials.
7. Three-minute video shows *new hackathon code and features only* and opens with the pre-existing-versus-new disclosure.

## 8. Demo story (target 3 minutes)
- 0:00–0:15 — Explain original concept versus completely fresh hackathon implementation.
- 0:15–0:50 — Show prepared career memory and one multimodal source; describe source validation.
- 0:50–2:15 — Ask two or three spoken interview questions and show cue transitions; include a follow-up.
- 2:15–2:45 — Show transcript, source linkage, and Meta model architecture.
- 2:45–3:00 — Close with a clear product claim, not an overpromise.

## 9. Success metric
Primary: reliable spoken-question-to-relevant-visual-cue loop. Secondary: latency measured at p50/p95, source attribution accuracy, fraction of questions with appropriate cues, recoverability, and demo quality. No numerical performance target is asserted before empirical measurements.

## 10. Desktop and provider direction

- Target a Tauri 2 desktop application for Windows x64, macOS Intel, and macOS Apple Silicon. Keep the current Next.js/React visual language and newly authored opening animation.
- For the hackathon, use Meta models exclusively. The shared Meta key stays on a hosted backend; it must not ship in the Tauri binary, static frontend, or GitHub Actions artifacts.
- The long-term open-source edition will support BYOK and provider choice (Meta, OpenAI, and compatible services). Keep transcription, reasoning, and vision behind separate provider contracts so the practice UI is not tied to a vendor. No additional provider is part of the hackathon scope.
- Later BYOK credentials belong in secure local storage reached through the Tauri native boundary, not browser storage or a bundled configuration file. A user-supplied key is distinct from the hackathon's shared server key.
- Before November 4, prioritize one reliable desktop spoken-question → Meta transcription → Meta reasoning → grounded cue demonstration. Windows x64 is the first runtime target; macOS Intel and Apple Silicon build artifacts and device permission checks follow. A CI build alone does not establish working microphone or window behavior on either Mac architecture.
- Keep the compact cue within the practice window for the initial desktop demo. A separate floating, always-on-top window is a later enhancement after focus, accessibility, and cross-platform behavior are tested.
- If voice or a platform build remains unverified at submission time, describe the text demo and available artifacts accurately; do not present them as a completed spoken or cross-platform experience.
