# VantSide Meta — Product Specification

**Version:** Hackathon scope, October 26, 2026  
**Theme:** Build for Your World  
**Track:** Indie Developer  
**Status:** The four-step text flow and synthetic cue path are implemented in a Tauri-compatible static frontend with a separate loopback Meta service. Personal PDF extraction and desktop live Meta behavior require manual verification. Voice and cross-restart persistence remain unimplemented.

## 1. Problem and proposition
During stressful conversations people struggle to recall specific examples and metrics from their own experience. Traditional interview-preparation tools generate scripts or generic chat responses. VantSide Meta instead presents *small, timely visual memory cues*, grounded in the user's own documented work, during an explicitly consensual practice interview.

**Product promise:** Your own experience, surfaced at the moment it's useful.

## 2. Target user and demo scenario
Primary user: an experienced professional practicing interviews about complex past work. First demo user: a product designer discussing research, product decisions, workflows, and measurable outcomes. The design should generalize to other professions without building industry-specific features during the event.

Do not build applicant screening, personality scoring, covert interview assistance, or claims about hiring outcomes.

## 3. Progressive four-step journey (target experience)

The product lives on one main screen with four large numbered steps. It is a progressive journey, not a page-by-page setup wizard. Each step unlocks when its useful output exists; users can return to earlier steps and improve their information without losing later work. Keep explanatory text exceptionally short and never style an unavailable action as working.

1. **Your Resume:** Upload a PDF. Meta extraction proposes career facts with source references; the user reviews and approves or corrects them. An upload alone does not complete this step.
2. **Let's Talk:** Hold an adaptive, voice-driven foundational interview informed by the resume. Turn approved examples into an editable, evidence-grounded Career Memory. A short first conversation should yield a useful starter memory; neither a two-hour session nor a fixed duration is required. Users may extend the conversation, and a later edition may resume from approved memory and an explicitly saved summary rather than retained raw audio.
3. **The Opportunity:** Upload or paste a job description and confirm the identified company. Public company research and known or potential interviewer research are optional enrichments, never gates to Practice. Show source and verification status; label uncertain company or interviewer matches as suggestions rather than facts.
4. **Practice:** Run a job-specific mock interview using approved Career Memory and confirmed opportunity context. Surface live, compact visual reminders of existing experience, not scripts or answers to restricted assessments.

Practice unlocks when there is a usable approved Career Memory and a confirmed opportunity. A clearly labeled synthetic demo remains available separately before personalized steps are complete. The current four-step flow uses text for Let's Talk and Practice; it has not been verified with live desktop Meta calls.

## 4. Hackathon scope versus longer-term product
### Current prototype (implemented)

- New app with usable desktop-first responsive UI and opening animation. **Done in Milestone 1.**
- A clearly labeled synthetic demo profile. **Done in Milestone 1.**
- Server-side Muse Spark call with schema validation. **Implemented in the separate loopback service; packaged desktop request remains to be manually verified.**
- Text input to exercise questions and follow-ups before voice integration. **Done in Milestone 1.**
- Four numbered steps with session-only PDF resume fact proposals and approval, short text conversation, job-description identification and confirmation, and personalized text Practice. **Implemented; live desktop Meta path still needs manual verification.**

### Immediate hackathon MVP target and remaining verification

- Keep the four numbered steps visible on one main screen, with honest locked, ready, and completed states. The first functional path is a thin, verifiable pass through PDF review, a short foundational conversation, job-description/company confirmation, and Practice; do not claim a step works until its full path is tested.
- Use Meta models to propose resume facts, then require user review before they enter Career Memory. Keep facts editable and traceable to user-provided evidence.
- Make the initial foundational interview adaptive and useful after a few substantial examples; allow continuation without making session length an unlock condition.
- Accept a pasted job description as the simplest Opportunity input; PDF upload is a target only if extraction is reliable. Confirm the company before using its identity in prompts. Public company and interviewer research are optional and must not block Practice.
- Meta Muse Voice Transcribe streaming speech-to-text with clear microphone permissions and transcript state. Validate service/browser integration first.
- Event-driven cue updates when a new interview question or significant follow-up is detected.
- UI states: idle, microphone permission, listening, thinking, cue ready, error, stopped.
- Source-backed, job-specific cues; avoid invented metrics, accomplishments, and interviewer identities. If the four-step path is incomplete by submission, demonstrate only verified functions and identify the synthetic/text fallback clearly.

### Longer-term product, after the core loop is reliable

- Resume and interview continuation across launches using approved memory and opt-in summaries with defined retention and deletion; no default long-term raw audio or transcript storage.
- Optional public company research with citations and freshness indicators; known interviewer information only when sourced, and possible matches clearly marked as unverified.
- Additional document formats, richer evidence review, cue history, transcript review, and reliable device selection.
- Open-source BYOK and provider choice as described in section 10; no extra provider in the hackathon build.

Second-person speaker differentiation, Baseten benchmarking, detailed opportunity tracking, and elaborate animations remain outside the immediate MVP.

## 5. Explicit exclusions
See [GUARDRAILS.md](GUARDRAILS.md) for the practice-only boundary, evidence requirements, restricted evaluations, consent, retention, and conservative fallback behavior.

- Live hidden assistance in actual employer interviews; sessions are designated mock/practice.
- Employer candidate screening, applicant ranking, or personality inference.
- A generic resume chatbot, dashboard-first workflow, or simple RAG/search demo.
- Automatic content generation that impersonates professional experiences.
- Full account management, payments, team collaboration, browser extensions, deep recruiting integrations, complex job tracking.
- Paywalls and billing features in the hackathon MVP.

## 6. Product behaviors
- Quiet by default. Cards animate subtly into place and never obstruct the entire conversation.
- No stale answers masquerading as current: show timestamp/status and preserve previous card while a new one is being prepared.
- If the model cannot identify a trustworthy match, say 'No verified memory match' instead of guessing.
- User can correct memory entries; generated content cannot silently overwrite approved facts.
- Returning to an earlier step may enrich approved memory or opportunity context; later steps should reflect reviewed changes without silently replacing earlier evidence.
- No automatic audio storage. Retention, if enabled, is explicit and explained.
- Keyboard accessible controls and reduced-motion accommodation.

## 7. Testable acceptance criteria
1. A fresh Tauri desktop session shows four numbered steps on one main screen. Personalized Practice unlocks only after reviewed Career Memory and confirmed opportunity context; the current browser/text demo is an interim synthetic path.
2. A short foundational conversation yields at least one user-approved, source-linked career example that remains editable. Users can continue without a fixed-duration requirement.
3. At least three different spoken questions elicit distinct, relevant cues using actual Meta inference.
4. A follow-up changes or refines the existing card without flooding the UI with text.
5. Every factual cue is traceable to a memory item and no unsupported numerical outcome or interviewer identity is invented.
6. An outage or API error produces a recoverable message; session termination stops audio capture.
7. The public repo can be opened anonymously and contains no proprietary legacy VantSide source or credentials.
8. Three-minute video shows *new hackathon code and features only* and opens with the pre-existing-versus-new disclosure. Only verified functionality is presented as working.

## 8. Demo story (target 3 minutes)
Use this sequence only for functions verified in the submitted build; otherwise disclose the synthetic/text fallback.
- 0:00–0:15 — Explain original concept versus completely fresh hackathon implementation.
- 0:15–0:50 — Show the four-step main screen, reviewed Career Memory, and confirmed opportunity context if functional; describe source validation.
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
- Before November 4, first verify one reliable desktop spoken-question → Meta transcription → Meta reasoning → grounded cue demonstration, then add the thinnest trustworthy four-step path time permits. Windows x64 is the first runtime target; macOS Intel and Apple Silicon build artifacts and device permission checks follow. A CI build alone does not establish working microphone or window behavior on either Mac architecture.
- Keep the compact cue within the practice window for the initial desktop demo. A separate floating, always-on-top window is a later enhancement after focus, accessibility, and cross-platform behavior are tested.
- If voice or a platform build remains unverified at submission time, describe the text demo and available artifacts accurately; do not present them as a completed spoken or cross-platform experience.
