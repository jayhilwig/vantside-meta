# VantSide Meta — Product Specification

**Version:** Hackathon scope, October 26, 2026  
**Theme:** Build for Your World  
**Track:** Indie Developer  
**Status:** Proposed scope; not a claim of implemented functionality

## 1. Problem and proposition
During stressful conversations people struggle to recall specific examples and metrics from their own experience. Traditional interview-preparation tools generate scripts or generic chat responses. VantSide Meta instead presents *small, timely visual memory cues*, grounded in the user's own documented work, during an explicitly consensual practice interview.

**Product promise:** Your own experience, surfaced at the moment it's useful.

## 2. Target user and demo scenario
Primary user: an experienced professional practicing interviews about complex past work. First demo user: a product designer discussing research, product decisions, workflows, and measurable outcomes. The design should generalize to other professions without building industry-specific features during the event.

Do not build applicant screening, personality scoring, covert interview assistance, or claims about hiring outcomes.

## 3. Primary journey
1. **Prepare:** Upload PDF resume and optionally project screenshots or portfolio PDFs. Display import progress, source names, and privacy note.
2. **Verify memory:** AI extracts candidate project entries. User reviews and corrects claims before activation. Each fact has an evidence source or is labeled unverified.
3. **Start practice:** Select a sample role or free-form session. Microphone access is explicit, with visible live/pause/stop controls. Explain what audio processing occurs.
4. **Talk:** As a practice partner asks a question, streaming transcription provides usable utterances and detects turns. A reasoning service matches utterances to the memory and returns a small structured cue.
5. **See cues:** The active card shows project title, up to three keywords/facts, a metric where verified, and an optional evidence indicator. Update or gracefully retain a cue as context changes. No paragraph-length generated answer.
6. **Finish:** Stop capture immediately; optionally view transcript and cue timeline. Deletion is straightforward.

## 4. MVP priorities
### P0 — Must work for the three-minute demo
- New app with usable desktop-first responsive UI and opening animation.
- One seeded demo profile **with synthetic or explicitly shareable information**, editable before use.
- Meta Muse Spark call from server-side code returning validated structured JSON cue data.
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
1. A fresh browser session can launch the practice workflow with explicit microphone permissions.
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
