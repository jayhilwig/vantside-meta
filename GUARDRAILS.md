# VantSide Guardrails

VantSide is an evidence-grounded career-memory and interview-practice application. It helps a person recall their own experience during a consensual practice conversation. It is not a covert interview-answering tool or a way to complete an assessment for someone.

These are product requirements. The current build offers explicit practice consent and microphone controls for a turn-based foundational interview, source-linked fact proposals requiring approval, and validated cue source IDs. It does not yet implement reliable session classification or every enforcement layer below; the Windows microphone path still needs manual verification.

## Practice sessions and consent

- During the Meta hackathon, enable practice sessions only. Label the mode clearly; do not offer hidden assistance during a real employer interview or assessment.
- Start microphone capture only after an explicit user action. Show unmistakable recording and transcription indicators throughout capture, with visible pause and stop controls.
- Stop must immediately terminate the session, microphone capture, transcription transport, and pending cue generation. A denied or revoked permission must stop capture and show a recoverable state. Never capture in the background or silently resume.
- Honor employer rules and the consent of everyone whose speech or materials enter the session. If use of recording or AI assistance is prohibited or consent is absent, do not start or continue that session.

## Evidence and cue boundaries

- Career accomplishments, statistics, projects, qualifications, and claims of expertise must come from user-provided materials and be traceable to approved source facts. Synthetic demo examples must stay clearly labeled as synthetic.
- Never invent a role, result, number, credential, or source. If a claim has no approved evidence, omit it or show “No verified memory match.”
- Cues are short reminders of existing experience: a project label and up to three brief phrases, with optional source notes. Do not produce a rehearsed answer, paragraph script, or unsupported metric.
- Generated text cannot silently change the user's approved career memory. The user reviews and corrects proposed facts before they become eligible for cues.

## Restricted evaluations

- Do not provide live solutions or substantive answers to coding assessments, legal competency questions, clinical assessments, licensing tests, or other restricted evaluations. Do not transform a prohibited question into a hidden step-by-step answer.
- Apply the restriction to the activity, not the profession. Engineers, attorneys, clinicians, and other professionals may practice recalling source-backed career experiences; their job title alone must never cause exclusion.
- If a question combines a permitted experience prompt with a restricted problem, withhold the substantive answer and limit any response to a safe career-memory cue only when the permitted part is clear and independently grounded.

## Conservative fallback

- When the session context, consent, employer rule, or question type is ambiguous, pause cue generation and ask for clarification within the practice flow. Do not infer that an actual evaluation is permitted.
- When the question is outside career-memory practice, appears to seek a restricted solution, or has no relevant approved fact, return a neutral no-cue/restricted state. Do not reuse an earlier cue as if it answered the new question.
- Explain the boundary in plain language and offer a permitted next step, such as practicing a question about the user's past work. Do not provide the restricted answer while explaining the boundary.

## Session data and retention

- Do not retain raw audio long term by default. Use only the temporary audio and transcript context needed for the active session, and discard it when the session ends unless the user explicitly opts into a separate retention feature.
- If optional summaries are added, require an explicit choice, show what will be saved, allow review and deletion, and define a clear retention period before launch. Summaries must not include unsupported facts or silently preserve raw audio.
- Explain when speech or documents are sent to Meta during the hackathon. Keep credentials, private resumes, transcripts, and raw audio out of the public repository and diagnostic logs.

## Enforcement layers

1. **Session layer:** require an explicit practice mode, microphone action, consent and restriction acknowledgement, visible capture state, and an immediate stop path. Block or pause when the session is identified as prohibited or unclear.
2. **Model-instruction layer:** instruct transcription/reasoning/vision adapters to use approved facts only, produce concise cues, avoid restricted solutions, and return a no-cue state for ambiguity or out-of-scope requests.
3. **Structured-output-validation layer:** validate cue length, source IDs, project ownership, and allowed status before display. Add explicit `restricted` and `needs_clarification` outcomes before voice launch; reject malformed, unsupported, or solution-like output and fall back safely.

LLM classification and prompt instructions cannot guarantee enforcement. Session controls, deterministic validation, conservative failure states, and review of real edge cases are required; even together they do not justify claiming perfect detection.

## Open design decisions

- Define how participants attest to consent and employer restrictions without pretending the app can independently verify them.
- Decide how to distinguish a behavioral question from a mixed or restricted assessment question, and whether to pause the entire turn or show only independently grounded career facts.
- Set the retention period, storage location, and deletion behavior for any future opt-in summary before shipping that feature.
