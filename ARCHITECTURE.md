# VantSide Meta — Technical Architecture

**Goal:** A new, publicly auditable, Meta-native prototype built during the hackathon. Model and transport details are candidates until verified with live docs and an actual request.

## 1. Stack and boundaries
- UI: React / Next.js / TypeScript / Tailwind CSS; desktop-first practice view.
- Server: Next.js route handlers for orchestration and Meta inference; never expose keys to client-side bundles.
- Primary inference: Meta Model API, Muse Spark 1.3 for textual/multimodal interpretation and structured cue construction.
- Voice: Muse Voice Transcribe 1.0, with streamed audio and session lifecycle handled according to the **official voice API protocol** (verify transport, authentication and sample rate before implementation).
- Persistence: in-memory or local browser storage for demo; carefully limit any storage of uploads or transcript data. No database unless a demonstrated need exists.
- Optional after MVP: Baseten Muse Spark Open for comparison; do not require it for startup or demo.

Official references (verify updated SDK shapes and model availability at implementation time):
- https://dev.meta.ai/docs/quickstart
- https://dev.meta.ai/docs/models
- https://dev.meta.ai/models/muse-spark
- https://dev.meta.ai/models/muse-voice-transcribe
- https://github.com/meta-models/meta-model-cookbook

## 2. Logical data flow
```text
User-supplied resume / portfolio materials
   -> secure temporary parsing / multimodal extraction (Muse Spark)
   -> proposed career facts with source references
   -> user approval / correction
   -> approved CareerMemory records

User microphone (explicit permission)
   -> audio capture and stream bridge (validated Meta voice transport)
   -> Muse Voice Transcribe (streaming turns/speaker information)
   -> stable utterance / question event
   -> cue orchestrator (coalescing + cancellation + relevance logic)
   -> Muse Spark (approved memory + current conversational context)
   -> validated Cue JSON (source IDs required)
   -> React floating visual cue card
```

## 3. Data contracts (initial proposal)
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

## 4. Real-time orchestration
- Prefer final transcript segments or high-confidence speech boundaries to avoid firing model calls on every word.
- Debounce/coalesce transcript updates, cancel stale cue requests, and use request IDs to avoid out-of-order UI updates.
- Track perceived latency separately for voice-to-turn and turn-to-cue; instrument actual numbers instead of promising subsecond latency.
- Return compact, schema-validated JSON with strict source-ID constraints; retry once for parsing errors, then show a safe failure state.
- Retain current valid cue while a replacement is pending, with a small status indicator.
- Microphone capture must cease when the user stops, navigates away, or loses permission.

## 5. Model use
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

## 6. Security and privacy
- `.env.local` is ignored; server side environment name `MODEL_API_KEY` per Meta docs. Include `.env.example` with empty placeholders only.
- Do not emit tokens in logs, telemetry, error messages, demos or Git commits.
- Validate types, MIME, and upload sizes. Strip or minimize document content submitted to model APIs; use shareable synthetic sample data for public demos.
- Never place personal career memory, identifiable interviewer documents, raw audio, or transcripts in the public repo.
- Explicitly disclose third-party AI processing and account billing mode in development docs.
- Important: Meta dashboard states free-credit content may be used for product improvement. Confirm current account privacy/billing terms before sending private career or employer material. Avoid sensitive materials during hackathon testing.
- Default to consensual mock interviewing; no stealth capture or support for violating interview rules.

## 7. Integration plan and gates
1. Confirm Model API billing credits, payment requirements and model access. Do not trigger billable requests without user approval.
2. Initialize fresh project and isolate secrets from browser and Git.
3. Implement deterministic mock response in UI to validate component behavior (clearly marked local fixture, never presented to judges as live Meta inference).
4. Make a minimal Muse Spark server-side request and log safe latency/model metadata.
5. Prove voice transcription with a minimal capture test against Meta's actual protocol.
6. Combine final turn events with structured cue request and source validation.
7. Add multimodal upload extraction if time remains; use approved sample memory as a viable fallback.
8. Create a reliable test path for API failure, permission denial, and no-match.

## 8. Definition of done
A clean install works, the repo is public and credential-free, spoken practice questions create *live Meta-derived* source-backed visual cues, errors can recover, and the three-minute video identifies newly built functionality clearly.
