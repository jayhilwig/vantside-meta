# VantSide Meta — Design Specification

**Purpose:** Recreate the recognizable design *language* of the original VantSide from newly authored UI code. Reference screenshots are design guidance only; do not copy the original source, bundled media, logo files, components, or animation implementations.

## 1. Visual direction
- **Editorial minimalism:** generous white space, strong large headlines, uncomplicated cards and dialogs.
- **Palette:** warm/neutral white surfaces (`#FFFFFF`), near-black text (`#242424`), black animated backdrop (`#000000`); greens in the current screenshots range from deep product green to bright lime brand mark. Starting *provisional* tokens: `--ink: #252525`, `--canvas: #ffffff`, `--action: #12A85B`, `--brand-lime: #B7FF00`, `--border: #D9D9D9`, `--muted: #777777`. Calibrate from design review rather than treating sampled values as exact original tokens.
- **Type:** Manrope Variable (400–700; occasional heavier display weights as supported). Use legitimate webfont distribution, not any private copied font binary. System sans fallback.
- **Shape:** thin borders, modest rounded corners, no noisy gradients, no generic AI neon glassmorphism.
- **Hierarchy:** large assertive product statement; supporting copy short and light; cards have specific jobs.

## 2. Signature opening animation (P0)
The screenshots show a centered VantSide mark and 'Starting...' text within a black horizontal hourglass/ribbon across a white full-screen canvas. The ribbon's top and bottom boundaries bow inward toward the center. Rows of white circles taper in size toward the middle, suggesting a dotted perspective field.

Rebuild the animation **from scratch** using CSS/SVG/Canvas as appropriate, with these requirements:
- Black ribbon with smooth concave edges and white outer field; dots have coherent perspective, not random confetti.
- Centered new wordmark treatment; Manrope Variable wordmark and a freshly created lime monogram inspired by the reference's geometry, not a copied asset.
- Slow, confident dot movement or subtle expansion/contraction; avoid strobing and excessive motion.
- A brief startup state leads deterministically into the usable app; do not trap the user in the splash.
- Include accessible reduced-motion behavior and meaningful loading text for assistive technology.
- Maintain good proportions at desktop sizes and graceful clipping on smaller screens.

## 3. Main app layout

The primary screen has four large numbered cards with progressive unlock states—not a wizard or a text-heavy dashboard:

1. **Your Resume** — add a PDF or Word resume; show what VantSide recognized.
2. **Let's Talk** — resume-aware foundational voice interview; continue or return to deepen Career Memory.
3. **The Opportunity** — add a job description and role context; support targeted follow-up conversations.
4. **Your Interview** — practice for an interview round with succinct grounded visual cues.

Each step is revisitable. Keep copy exceptionally short, one clear action per card, and honest completion states. Do not make users classify their profession manually unless the resume is ambiguous. The opener and existing visual identity remain intact.


- Top-left logo/wordmark; settings discreetly top-right.
- Large headline with one emphatic weight shift; short setup explanation.
- Compact preparation area for career material and approved facts.
- Primary CTA: Start practice / Go Live; action green in the app, with clear disabled and busy states.
- Use roomy column layouts and centered max content width; avoid dense analytics panels.

## 4. Components and patterns from screenshots (new implementations)
### Preparation cards
Thin dark border and rounded corners. Large green sequential numerals (1, 2, 3) indicate preparation flow. Card headers have small uppercase eyebrow, role/title, supporting metadata, and bottom actions.

### Career Memory review dialog
White modal over a dimmed background. Large readable heading, understated source and theme labels, fact statements in comfortable paragraph line height. Supporting evidence expandable. Close button in a dedicated footer. Do not make this modal the central demo feature.

### Session/device preflight
Two-column speaker and microphone controls where browser/platform support allows. Explicit test buttons, visible status, understandable error handling, and a disabled 'Ready' until required microphone checks pass. Note: browser speaker selection may not be universally supported; design graceful fallback.

### Live visual cue (primary differentiator)
Create a fresh compact floating card suitable for a desktop practice session:
- Top: project label and minimal relevance/status indicator.
- Center: 1–3 short cue phrases, not written scripts.
- One bold metric *only if supported by memory*.
- Optional source/evidence reveal on demand.
- Transition smoothly when spoken context changes. Brief 'finding memory' state; avoid distracting flash or jitter.
- Contain no fabricated experience, coaching score, hidden microphone status, or prompt-injection text.

### Post-session review
Optional simple tabs for Summary and Transcript, similar in spirit to the screenshots, but low priority until the live cue loop works.

## 5. Interaction and accessibility
- Full keyboard operation: visible focus ring, escape for modals, properly labeled mic controls.
- 4.5:1 contrast for normal text when feasible; never rely on green alone to convey state.
- Respect `prefers-reduced-motion` for opener and cue transitions.
- Responsive target: desktop first; usable tablet and small-width fallback.
- Microcopy: plain language (e.g., 'Listening', 'Finding a relevant example', 'No verified match', 'Stop practice').

## 6. What not to recreate for the event
The source screenshots also show opportunity tracking, interviewer tabs, JD alignment percentages, accumulated interviews, and detailed memory summaries. These explain the larger VantSide product, but are **not** MVP requirements. Do not copy their content/layout wholesale or let them turn the prototype into a dashboard.

## 7. Screenshot provenance
Reference-only screenshots supplied by the project owner on October 26, 2026: black ribbon startup states, device preflight, interview summary dialog, foundational memory dialog, career memory dialog, opportunity/detail cards, homepage, and Meta billing view. The billing screenshot is *not* product UI guidance. Do not include private interview notes, names, resumes, or billing screenshots as public repo assets without review.
