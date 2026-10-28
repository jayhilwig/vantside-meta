> Product direction (October 27): VantSide's core is resume-derived professional identity → repeatable adaptive foundational voice interviews → approved, persistent Career Memory → job-specific Opportunity Memory → round-specific Interview Memory and visual practice cues. Persistence and voice are product goals; the current implementation is session-only and text-based. Synthetic cue tests are engineering fixtures, not the intended product.

# VantSide Meta — Technical Architecture

**Goal:** A new, publicly auditable, Meta-native prototype built during the hackathon. The target runtime is Tauri 2 on Windows x64, macOS Intel, and macOS Apple Silicon. Model and voice transport details remain candidates until verified with current official docs and live requests.

## 1. Stack and boundaries
- UI: React / Next.js / TypeScript / Tailwind CSS; preserve the current practice view and opener inside a Tauri 2 desktop shell.
- Current prototype server: `backend/server.ts` exposes `POST /cue`, `POST /extract-resume`, and `POST /extract-opportunity` on `127.0.0.1` only. The static frontend calls a build-time configured loopback URL. PDF bytes are sent inline to Muse Spark for one-off extraction; no Files API upload or backend persistence is used.
- Hosted hackathon backend target: a separate HTTPS service with real user/session authentication, durable quotas, and a spending cap. The current loopback service must not be publicly deployed. The shared Meta key remains on the server, never in static assets, the Tauri binary, CI artifacts, or client-side environment variables.
- Primary inference: Meta Model API, Muse Spark 1.3 for textual/multimodal interpretation and structured cue construction.
- Voice: Muse Voice Transcribe 1.0, with streamed audio and session lifecycle handled according to the **official voice API protocol** (verify transport, authentication and sample rate before implementation).
- Persistence: session state stays in memory. No raw audio or transcript persistence is implemented or permitted by default. No database unless a demonstrated need exists.
- Optional after MVP: Baseten Muse Spark Open for comparison; do not require it for startup or demo.

Official references (verify updated SDK shapes and model availability at implementation time):
- https://dev.meta.ai/docs/quickstart
- https://dev.meta.ai/docs/models
- https://dev.meta.ai/models/muse-spark
- https://dev.meta.ai/models/muse-voice-transcribe
- https://github.com/meta-models/meta-model-cookbook

## 2. Memory domains and lifecycle

- **Career Memory:** global, structured, approved professional facts, projects, decisions and outcomes, with source provenance, correction and deletion controls.
- **Opportunity Memory:** job description, confirmed company/role, role-specific context, optional sourced people and preparation questions. Keep company-specific material separate from global facts.
- **Interview Memory:** individual practice sessions and rounds, transient transcript context, optional user-reviewed summaries and proposed updates to Career Memory.
- **Promotion:** speech/document extraction proposes facts; it does not silently promote them. Approval and provenance are required before reuse in grounded visual cues.
- **Resume-first identity (target):** infer profession and seniority from resume PDF or future Word support, ask only necessary clarifications, then generate profession-specific foundational interview questions independent of a job listing. The current build does not infer profession or seniority.
- **Adaptive voice:** after each answer, select a meaningful follow-up; support stopping, returning, and progressively deepening Career Memory.
- **Durability:** current session-only storage is insufficient for the intended product. Evaluate secure local persistence for the hackathon and Supabase for future cross-device sync. Never persist raw audio by default; give users review/edit/delete controls and explicit consent for saved summaries.
- **API security:** current loopback-only backend must not be made public with a shared key. Production hosting requires authentication, durable quotas and spending protections.

## 3. Logical data flow
```text
SEPARATE SYNTHETIC DEVELOPMENT FIXTURE
Clearly labeled synthetic examples + simulated interviewer question
   -> loopback-only cue service (hosted HTTPS service after authentication)
   -> Muse Spark
   -> validated Cue JSON (source IDs required)
   -> React visual cue card

CURRENT FOUR-STEP TEXT PATH (desktop live Meta behavior not yet verified)
1 Your Resume: PDF -> temporary Meta extraction -> proposed source-linked facts
   -> user review/correction -> approved Career Memory seed
2 Let's Talk: short text conversation -> user-approved example quoting a session response
   -> editable Career Memory for this app session
3 The Opportunity: pasted/uploaded job description -> proposed company -> user confirmation
   -> opportunity context (public research and interviewer suggestions are future work)
4 Your Interview (currently labeled Practice in UI): text question + approved memory + confirmed opportunity
   -> Meta reasoning -> validated, source-backed compact cue

FUTURE VOICE PATH
Explicit microphone start -> Meta transcription -> final question/answer turn
   -> adaptive foundational follow-up or grounded practice cue -> immediate stop controls
```

Do not gate progression on interview duration. A short first conversation can establish a useful starter memory; later continuation should use approved facts and an opt-in summary, never default long-term raw audio or transcript retention. Company and interviewer research is optional and cannot silently promote a suggested identity to verified fact.

## 4. Data contracts (initial proposal)
```ts
type CareerFact = {
  id: string;
  projectId: string;
  text: string;
  kind: 'role' | 'decision' | 'process' | 'outcome' | 'metric' | 'context';
  sourceIds: string[];
  approved: boolean;
};
type CareerProject = { id: string; title: string; organization?: string; factIds: string[] };
type TranscriptTurn = {
  id: string;
  speaker: 'interviewer' | 'candidate' | 'unknown';
  text: string;
  isFinal: boolean;
  timestampMs: number;
};
type VisualCue = {
  id: string;
  question: string;
  projectId: string | null;
  headline: string;
  cuePhrases: string[]; // maximum 3, brief
  metric?: string;
  sourceFactIds: string[];
  match: 'verified' | 'none';
};
```
Any metric displayed must be supported by an `approved` source fact. If match is `none`, return an empty project ID, empty source facts, and safe fallback UI.
In the current four-step flow, a resume upload produces *proposed* facts only; user approval creates eligible session Career Memory. Text interview entries must quote a phrase from the user's session response. Opportunity context requires a user-confirmed company and role. Public-research items with source URL, retrieval time, and `verified` or `suggested` status remain future contracts. Never infer an interviewer identity from a name or role match alone.

## 5. Real-time orchestration
- Prefer final transcript segments or high-confidence speech boundaries to avoid firing model calls on every word.
- Debounce/coalesce transcript updates, cancel stale cue requests, and use request IDs to avoid out-of-order UI updates.
- Track perceived latency separately for voice-to-turn and turn-to-cue; instrument actual numbers instead of promising subsecond latency.
- Return compact, schema-validated JSON with strict source-ID constraints; retry once for parsing errors, then show a safe failure state.
- Retain current valid cue while a replacement is pending, with a small status indicator.
- Microphone capture must cease when the user stops, navigates away, or loses permission.

## 6. Model use
### Muse Spark 1.3 (core)
- Convert PDF/image/text career artifacts into proposed structured memory and link them to supplied sources.
- Given a completed interview question and approved memory, rank relevant *existing* facts and create compact cue text.
- Use narrow structured instructions and output validation; do not ask the model to invent a user accomplishment or metric.

### Muse Voice Transcribe 1.0 (core)
- Streaming voice-to-text, speech boundary detection, and speaker/turn metadata where supported.
- Verify that browser audio transport and voice session semantics work in the selected architecture before committing to UI.
- Speaker labels must be treated as fallible; provide 'unknown' when uncertain.

### Muse Image / SAM / other APIs (not core)
- Not needed for the initial proof. Muse Spark's multimodal input may handle the portfolio imagery needed for MVP; do not add image generation or segmentation for appearances alone.

## 7. Security and privacy
- `.env.local` is ignored; server side environment name `MODEL_API_KEY` per Meta docs. Include `.env.example` with empty placeholders only.
- Do not emit tokens in logs, telemetry, error messages, demos or Git commits.
- Validate types, MIME, and upload sizes. Strip or minimize document content submitted to model APIs; use shareable synthetic sample data for public demos.
- Never place personal career memory, identifiable interviewer documents, raw audio, or transcripts in the public repo.
- Keep raw audio and working transcripts in active-session memory by default. A resumed session across launches needs separately designed, opt-in summaries or approved memory persistence with a clear retention and deletion policy; do not treat raw transcript storage as the shortcut.
- Explicitly disclose third-party AI processing and account billing mode in development docs.
- Important: Meta dashboard states free-credit content may be used for product improvement. Confirm current account privacy/billing terms before sending private career or employer material. Avoid sensitive materials during hackathon testing.
- Default to consensual mock interviewing; no stealth capture or support for violating interview rules.

## 8. Integration plan and gates
1. Confirm Model API billing credits, payment requirements and model access. Do not trigger billable requests without user approval.
2. Initialize fresh project and isolate secrets from browser and Git.
3. Implement deterministic mock response in UI to validate component behavior (clearly marked local fixture, never presented to judges as live Meta inference).
4. Make a minimal Muse Spark server-side request and log safe latency/model metadata.
5. Prove voice transcription with a minimal capture test against Meta's actual protocol.
6. Combine final turn events with structured cue request and source validation.
7. Add multimodal upload extraction if time remains; use approved sample memory as a viable fallback.
8. Create a reliable test path for API failure, permission denial, and no-match.

## 9. Implementation history and current state
- The original `POST /api/cue` was moved to the separate loopback-only `POST /cue` service. It reads `MODEL_API_KEY`, `META_API_BASE_URL`, and `META_MODEL` only in Node.js, then sends a short question and the synthetic examples to `/chat/completions`; credentials never reach the browser.
- The request uses JSON mode, `reasoning_effort: "minimal"`, `max_completion_tokens: 512`, and `store: false`.
- Zod validates the generated shape and enforces that cited fact IDs belong to the selected synthetic project. A no-match response cannot cite facts.
- Upstream errors, malformed JSON, and schema failures return a generic user-facing message. Upstream response bodies and keys are not logged or relayed.
- The opening ribbon and perspective dot field are newly authored SVG/CSS. Reduced-motion preference skips the timed intro and disables motion.
- The current UI is text-only but now includes inline PDF proposals, user approval, session Career Memory, opportunity confirmation, and personalized text cues. Voice capture, cross-restart persistence, and full live-session device controls remain future work.
- Lint, TypeScript, and a Webpack production build passed in Milestone 1. The static desktop build and mocked cue contract have since passed; a packaged Windows runtime and live desktop-to-Meta request remain unverified.

## 10. Definition of done
A clean install works, the repo is public and credential-free, spoken practice questions create *live Meta-derived* source-backed visual cues, errors can recover, and the three-minute video identifies newly built functionality clearly.

## 11. Tauri compatibility and packaging decision

- `src/app/page.tsx`, `src/components/practice-app.tsx`, `src/app/globals.css`, the SVG opener, synthetic examples, and the local Manrope font can form a static frontend. Browser-only APIs used by the opener run in an effect. Confirm asset paths and font loading in a packaged WebView on each OS.
- Next.js now uses `output: 'export'`; `out/` is Tauri's `frontendDist`. The request-dependent `POST` route was removed from the frontend and moved to the separate loopback server. The frontend URL is configured with `NEXT_PUBLIC_CUE_API_BASE_URL` at build time; builds reject non-loopback URLs until hosted authentication exists.
- The local service shares the career-example data contract and cue schema. Its loopback binding, origin check, 5.5 MB request cap for inline PDFs, one in-flight request, and per-process request quotas limit accidental/local abuse. These controls are not user authentication and must not be treated as sufficient for public hosting.
- Windows x64 is the first packaging target. The shell has no custom native commands or microphone access yet, and its CSP allows only local cue-service connections.
- Keep request validation, Meta response parsing, source-ID checks, and error redaction on the backend. Add authenticated demo sessions, per-session quotas/rate limits, and an overall spending limit before distributing a client that calls the shared-key backend. CORS or an embedded app token alone does not authorize requests from a public binary.
- Use Tauri capabilities and a restrictive CSP for the bundled UI, allowing only the required backend origin and native commands. Do not give a remotely loaded page broad native access. Do not package a local Node sidecar containing the shared Meta key.
- The current synchronous cue route is a starting point, not a proven voice-stream bridge. Validate Meta Voice Transcribe's current transport and the hosting platform's streaming/connection limits before choosing a persistent service or native-to-server bridge.

## 12. Provider boundary (design only)

- **Transcription provider:** receives an explicitly started audio session and emits typed partial/final utterances, status, and errors. Audio capture and OS permission handling stay in a separate platform adapter.
- **Reasoning provider:** receives a stable practice question plus approved, source-linked facts and returns the validated `VisualCue` contract, including a safe no-match result.
- **Vision provider:** receives a user-approved image/PDF source and proposes source-linked facts for review; it cannot silently approve facts.
- Select Meta implementations only in the hackathon backend. Preserve the same domain contracts for a later desktop BYOK edition, where native code retrieves a user's key for a request without returning it to the WebView. Prefer OS-backed credential storage; evaluate Tauri Stronghold with a user-derived unlock secret if an encrypted vault is needed. Never hard-code a vault password.

## 13. Planned GitHub Actions matrix

| Runner | Rust target | Output goal |
| --- | --- | --- |
| `windows-latest` | `x86_64-pc-windows-msvc` | Windows x64 installer/app bundle |
| `macos-latest` | `x86_64-apple-darwin` | macOS Intel app/DMG |
| `macos-latest` | `aarch64-apple-darwin` | macOS Apple Silicon app/DMG |

For each job: check out the fresh repository, set up Node and stable Rust with the matrix target, run `npm ci`, lint/typecheck, build the static desktop frontend, run `tauri-apps/tauri-action`, and upload architecture-labeled artifacts. CI must not receive `MODEL_API_KEY`; it builds only the public client. Treat unsigned CI artifacts as build checks. Signed/notarized macOS releases and signed Windows distribution are separate release gates requiring protected secrets and platform-specific setup. Runtime microphone and window QA require actual devices on each target architecture.

## 14. Platform risks and gates

- **Microphone:** Request permission only after the user starts practice; show recording state and stop capture on session end, navigation, or permission loss. macOS bundles need `NSMicrophoneUsageDescription` in `Info.plist`, plus WebView behavior testing. Windows uses WebView2 and its own device-permission path. Browser success does not prove either packaged app works.
- **Streaming transcription:** Confirm Meta's actual protocol, audio format/sample rate, reconnect and cancellation behavior, and backend hosting limits before implementation. Measure question-to-cue latency with real speech; partial transcripts must not flood the reasoning service.
- **Floating windows:** An always-on-top cue can obscure interview content, steal focus, or become difficult to dismiss. First ship the cue inside the practice window; later test position, click behavior, multi-monitor/full-screen interactions, accessibility, and per-platform window permissions before enabling a separate overlay.
- **Security and permissions:** Tauri capabilities should grant only required commands to the local WebView. Keep network destinations explicit in CSP, do not log raw audio or credentials, and never let a public executable impersonate a trusted backend client by itself.

Platform references: [Tauri Next.js guide](https://v2.tauri.app/start/frontend/nextjs/), [Next.js static export limits](https://nextjs.org/docs/app/guides/static-exports), [Tauri GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/), [Tauri macOS microphone plist](https://v2.tauri.app/distribute/macos-application-bundle/), [Tauri capabilities](https://v2.tauri.app/security/capabilities/), [Tauri Stronghold](https://v2.tauri.app/plugin/stronghold/).

## 15. Implementation order through November 4

1. Protect the shared-key endpoint before public hosting, and prove a text-question cue through the packaged Windows x64 Tauri shell. The present service remains loopback-only.
2. Verify Meta Voice Transcribe's official stream protocol and prove one microphone → final transcript → grounded cue path on Windows.
3. Verify the existing four-step text path with live desktop Meta calls, then make the foundational conversation adaptive and voice-driven. Gate each step on validated output and label incomplete features honestly. Public company/interviewer research and cross-launch resumption are optional later work.
4. Test permission denial, stop/recovery, source grounding, and real spoken follow-ups on the Windows demo machine. Keep the existing text input as an explicitly labeled fallback.
5. Run the three-target CI matrix and manually test macOS Intel and Apple Silicon where devices are available. Do not claim runtime support from CI artifacts alone; defer separate floating windows, BYOK, and additional providers.
