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

The target accepts PDF or Word resumes and proposes source-linked work history, professional identity, skills, projects and context. The user reviews and corrects facts before approval; upload alone does not complete the step. Profession inference should avoid a separate profession form unless the source is ambiguous. The current build accepts **PDF only** and proposes source-linked projects and facts; profession and seniority inference are not implemented.

### 2. Let's Talk

A Meta-powered, spoken foundational interview based on that specific resume and profession—not a job description yet. For a product designer, ask about design decisions, collaboration, projects and outcomes; for another profession, ask appropriate questions about actual work. Follow answers with thoughtful, adaptive prompts.

Sessions may be brief or extended. The result is an evolving **Career Memory**, not merely a saved transcript. A minimum usable memory is one user-approved project or accomplishment supported by the resume or interview. Extract proposed experiences, decisions, facts, outcomes and supporting source references for user approval. Allow the user to review, revise and remove them. Resumption across launches requires reviewed persistence and retention controls; it is not in the current build.

### 3. The Opportunity

Add a job description as a document or pasted text; URL import is a later option. Identify and confirm the company and role, especially when the match is uncertain. Use Career Memory to find relevant experience and ask targeted follow-up questions. In the intended product, keep the job description, round plan, and optional sourced company/interviewer context under a distinct opportunity. The current build accepts pasted text or PDF and holds one confirmed opportunity in session memory.

Confirmed interviewers must come from the user or reliable evidence; suggested employees are never presented as confirmed interviewers. Public company research is a later enhancement, not a prerequisite.

### 4. Your Interview

Practice for a specific interview round. Voice interaction uses the professional history, approved memories, job requirements, and prior-round summaries to present compact, relevant visual cues. Capture new information during practice and propose memory updates.

In the intended product, user-approved reusable career facts persist globally after each round; company or round-specific context stays with that opportunity. If the job doesn't work out, the professional memory remains useful for the next one. The current build offers personalized text practice after one approved memory and a confirmed opportunity; its Step 4 card still says “Practice,” and it does not persist rounds or facts across launches.

## Memory model

- **Career Memory (global in the intended product):** Approved projects, roles, accomplishments, decisions, skills, stories and supporting sources; reusable across opportunities. The current build holds approved facts only in the active app session.
- **Opportunity Memory:** Job description, company/role, role-specific preparations, relevant people, requirements and context.
- **Interview Memory:** Individual sessions and rounds, questions, feedback, contextual cues and optional summaries.
- **Memory proposals:** Model-extracted information is pending until the user accepts or edits it. Preserve provenance and distinguish facts from inference.

Do not automatically convert unreviewed conversation content into established career facts. Prefer structured records over treating one enormous transcript as the corpus. For repeat sessions, summaries and memory updates require clear retention controls and user approval.

## Hackathon versus future product

**Current technical groundwork:** New desktop shell, loopback-only Meta backend, four-step session text flow, reviewed PDF fact proposals, confirmed opportunity context, personalized cues, and a separately labeled synthetic test mode. Static build and mocked contracts pass; personal PDF and packaged desktop Meta calls still need live verification. No raw audio is captured or persisted.

**Hackathon priority:** Resume ingestion, profession-aware foundational voice interview, a small approved and reusable Career Memory, one opportunity, and a working voice-to-visual-cue practice experience. Build one convincing end-to-end flow before secondary screens.

**Later:** Reviewed secure local persistence and optional account sync, multiple long-running opportunities, sourced company/interviewer research, repeat interview rounds, polished three-platform releases, and provider choice/BYOK. No paywalls or billing features belong in the hackathon MVP.

Don't show unavailable actions as finished, and don't describe development fixtures as a product feature.

## Privacy, consent and boundaries

Explicit microphone permission; visible listening and stop states; practice sessions only; no default permanent raw-audio retention. Show users what would be saved and let them review, edit or delete it. Do not use the system to answer restricted coding, legal, clinical or other assessments. See [GUARDRAILS.md](GUARDRAILS.md).

## Demo success

A user adds a resume, VantSide recognizes the profession, conducts an adaptive spoken conversation, proposes an accurate career memory item, and uses approved knowledge to show a contextual visual cue in job-specific practice. The demonstration must be honest about what was implemented during the hackathon.
