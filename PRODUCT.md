# VantSide Meta — Product

## The idea

**Your experience. Ready when you need it.**

VantSide is a living professional memory. It learns from a resume and natural conversations, develops a source-grounded understanding of someone's work, and brings the right experiences forward for specific opportunities and interview rounds.

The intended product is not a resume chatbot, answer generator, job screener, or one-time interview-prep exercise.

## Design principles

- **Almost no instructions.** One screen, four numbered steps, one obvious action per step.
- **Progressive unlocking.** Later steps become available once the relevant information exists, without arbitrary conversation-length requirements.
- **Conversation before forms.** The resume tells VantSide where to begin; voice interviews uncover what a person actually did.
- **Memory that grows.** Return for another conversation, add evidence, correct facts, and build on past sessions.
- **Always grounded.** The user approves proposed facts. Don't invent credentials, achievements, or metrics.
- **Practice only during the hackathon.** No covert real-interview assistance.

## The four steps

### 1. Your Resume

Upload a PDF or Word resume. VantSide extracts work history, professional role and likely seniority, skills, projects and context. It infers profession from the resume rather than requiring a separate profession form. Ask for confirmation only when essential details are ambiguous. The user can correct extracted information.

### 2. Let's Talk

A Meta-powered, spoken foundational interview based on that specific resume and profession—not a job description yet. For a product designer, ask about design decisions, collaboration, projects and outcomes; for another profession, ask appropriate questions about actual work. Follow answers with thoughtful, adaptive prompts.

Sessions may be brief or extended and can be resumed or repeated. The result is an evolving **Career Memory**, not merely a saved transcript. Extract proposed experiences, decisions, facts, outcomes and supporting source references for user approval. Allow the user to review, revise and remove them.

### 3. The Opportunity

Add a job description as a document, URL or pasted text where supported. Identify and confirm the company and role. Use Career Memory to find relevant experience and ask targeted follow-up questions. Store the job description, round plan, and optional sourced company/interviewer context under a distinct opportunity.

Confirmed interviewers must come from the user or reliable evidence; suggested employees are never presented as confirmed interviewers. Public company research is a later enhancement, not a prerequisite.

### 4. Your Interview

Practice for a specific interview round. Voice interaction uses the professional history, approved memories, job requirements, and prior-round summaries to present compact, relevant visual cues. Capture new information during practice and propose memory updates.

After each round, retain user-approved, reusable career facts globally; keep company or round-specific context attached to that opportunity. If the job doesn't work out, the professional memory remains useful for the next one.

## Memory model

- **Career Memory (global):** Approved projects, roles, accomplishments, decisions, skills, stories and supporting sources; reusable across opportunities.
- **Opportunity Memory:** Job description, company/role, role-specific preparations, relevant people, requirements and context.
- **Interview Memory:** Individual sessions and rounds, questions, feedback, contextual cues and optional summaries.
- **Memory proposals:** Model-extracted information is pending until the user accepts or edits it. Preserve provenance and distinguish facts from inference.

Do not automatically convert unreviewed conversation content into established career facts. Prefer structured records over treating one enormous transcript as the corpus. For repeat sessions, summaries and memory updates require clear retention controls and user approval.

## Hackathon versus future product

**Current technical groundwork:** New desktop shell, local cue backend, a working Meta inference path and development-only text/sample experiments. These are not the finished product.

**Hackathon priority:** Resume ingestion, profession-aware foundational voice interview, a small approved and reusable Career Memory, one opportunity, and a working voice-to-visual-cue practice experience. Build one convincing end-to-end flow before secondary screens.

**Later:** Durable account sync (Supabase is a candidate), multiple long-running opportunities, sourced company/interviewer research, repeat interview rounds, polished three-platform releases, provider choice/BYOK, and hosted plans.

Don't show unavailable actions as finished, and don't describe development fixtures as a product feature.

## Privacy, consent and boundaries

Explicit microphone permission; visible listening and stop states; practice sessions only; no default permanent raw-audio retention. Show users what would be saved and let them review, edit or delete it. Do not use the system to answer restricted coding, legal, clinical or other assessments. See [GUARDRAILS.md](GUARDRAILS.md).

## Demo success

A user adds a resume, VantSide recognizes the profession, conducts an adaptive spoken conversation, proposes an accurate career memory item, and uses approved knowledge to show a contextual visual cue in job-specific practice. The demonstration must be honest about what was implemented during the hackathon.
