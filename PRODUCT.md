# VantSide Meta — Product

## The idea

**Your experience. Ready when you need it.**

VantSide is a living professional memory. It learns from a resume and natural conversations, develops a source-grounded understanding of someone's work, and brings the right experiences forward for specific opportunities and interview rounds.

The intended product is not a resume chatbot, answer generator, job screener, or one-time interview-prep exercise. During the hackathon it is strictly for consensual practice, under [GUARDRAILS.md](GUARDRAILS.md).

## Design principles

- **Almost no instructions.** One screen, four numbered steps, one obvious action per step.
- **Progressive unlocking.** Later steps become available once the relevant information exists, without arbitrary conversation-length requirements.
- **Conversation before forms.** The resume tells VantSide where to begin; voice interviews uncover what a person actually did.
- **Memory that grows.** Return for another conversation, add evidence, correct facts, and build on past sessions.
- **Always grounded.** The user approves proposed facts. Don't invent credentials, achievements, or metrics.
- **Practice only during the hackathon.** No covert real-interview assistance.
- **No paywall in the hackathon MVP.** Do not present unavailable actions as working.

## The four steps

### 1. Your Resume

The target accepts PDF or Word resumes and proposes source-linked work history, professional identity, skills, projects and context. The user reviews and corrects facts before approval; upload alone does not complete the step. Profession inference should avoid a separate profession form unless the source is ambiguous. The current build accepts **PDF only** and proposes source-linked projects, facts, profession, seniority, and a career overview for review; this inference still needs live verification.

The current resume proposal also includes explicit title evidence for seniority and quoted date evidence when the PDF supplies dates. Omitted or uncertain dates stay blank.

### 2. Let's Talk

A spoken foundational interview based on that specific resume and profession—not a job description yet. The current primary voice path uses GPT-Live for two-way conversation, pending Windows runtime QA; the Meta text path remains an accessibility fallback. For a product designer, ask about design decisions, collaboration, projects and outcomes; for another profession, ask appropriate questions about actual work. Follow answers with thoughtful, adaptive prompts.

Sessions may be brief or extended. The result is an evolving **Career Memory**, not merely a saved transcript. A minimum usable memory is one user-approved project or accomplishment supported by the resume or interview. Extract proposed experiences, decisions, facts, outcomes and supporting source references for user approval. Allow the user to review, revise and remove them. Approved memory and deliberately saved proposals now survive desktop restarts; raw answers, the current question, and unapproved conversation summaries do not.

### 3. The Opportunity

Add a job description as a document or pasted text; URL import is a later option. Identify and confirm the company and role, especially when the match is uncertain. Use Career Memory to find relevant experience and ask targeted follow-up questions. In the intended product, keep the job description, round plan, and optional sourced company/interviewer context under a distinct opportunity. The current build accepts pasted text or PDF and restores the most recently confirmed opportunity on launch. Pasted job text is stored locally; for PDF input only its filename and confirmed company/role are retained, not PDF bytes or extracted full text.

Confirmed interviewers must come from the user or reliable evidence; suggested employees are never presented as confirmed interviewers. Public company research is a later enhancement, not a prerequisite.

The current Opportunity review extracts company, role, supported seniority and short, quoted requirements from pasted text or a PDF. It presents possible strengths linked to approved Career Memory facts and marks unlinked requirements as needing evidence, without a match score. Confirmation stores reviewed requirements and targeted preparation questions with that opportunity. A user answer can become a pending global-memory proposal only after explicit review and approval.

### 4. Your Interview

Practice for a specific interview round. Voice interaction uses the professional history, approved memories, job requirements, and prior-round summaries to present compact, relevant visual cues. Capture new information during practice and propose memory updates.

In the intended product, user-approved reusable career facts persist globally after each round; company or round-specific context stays with that opportunity. If the job doesn't work out, the professional memory remains useful for the next one. The current build offers personalized text practice after one approved memory and a confirmed opportunity. The local schema supports round records, but the current UI does not create or manage rounds yet.

## Memory model

- **Career Memory (global):** Approved projects, roles, accomplishments, decisions, skills, stories and supporting sources; reusable across opportunities. Reviewed facts persist in the desktop app's local database.
- **Opportunity Memory:** Job description, company/role, role-specific preparations, relevant people, requirements and context.
- **Interview Memory:** Individual sessions and rounds, questions, feedback, contextual cues and optional summaries.
- **Memory proposals:** Model-extracted information is pending until the user accepts or edits it. Preserve provenance and distinguish facts from inference.

Do not automatically convert unreviewed conversation content into established career facts. Prefer structured records over treating one enormous transcript as the corpus. For repeat sessions, summaries and memory updates require clear retention controls and user approval.

## Hackathon versus future product

**Current technical groundwork:** New desktop shell, loopback-only backend, four-step flow, reviewed PDF fact proposals and professional profile, GPT-Live WebRTC foundational interview path with an opt-in Meta text/turn-based fallback, pending fact review, confirmed opportunity context, personalized cues, and a separately labeled synthetic test mode. SQLite retains approved memory, short evidence excerpts, deliberately saved pending proposals, session metadata, and confirmed opportunity context on device. Raw audio and full transcripts are not saved. The GPT-Live conversation and device behavior still need manual Windows/Tauri verification.

**Hackathon priority:** Resume ingestion, profession-aware foundational voice interview, a small approved and reusable Career Memory, one opportunity, and a working voice-to-visual-cue practice experience. Build one convincing end-to-end flow before secondary screens.

**Later:** Reviewed at-rest encryption and optional account sync, a multi-opportunity selector, sourced company/interviewer research, repeat interview-round UI, polished three-platform releases, and provider choice/BYOK. No paywalls or billing features belong in the hackathon MVP.

Don't show unavailable actions as finished, and don't describe development fixtures as a product feature.

## Privacy, consent and boundaries

Explicit microphone permission; visible listening and stop states; practice sessions only; no default permanent raw-audio retention. Show users what would be saved and let them review, edit or delete it. Do not use the system to answer restricted coding, legal, clinical or other assessments. See [GUARDRAILS.md](GUARDRAILS.md).

## Demo success

A user adds a resume, VantSide recognizes the profession, conducts an adaptive spoken conversation, proposes an accurate career memory item, and uses approved knowledge to show a contextual visual cue in job-specific practice. The demonstration must be honest about what was implemented during the hackathon.
