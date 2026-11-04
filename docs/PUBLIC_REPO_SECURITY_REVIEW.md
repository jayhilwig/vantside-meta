# VantSide public-repository security review — 2026-11-04

> Scope: focused **source and configuration review for hackathon submission**, not a comprehensive penetration test or certificate of security.

Reviewed `main` at `17f05e7b9b1fccf2384da737295caf160cb6b95d` and the installer branch changes, including source, test files, documentation, `.gitignore`, `.env.example`, Tauri capabilities, local backend, packaging workflow, and dependency versions in `package-lock.json`.

## Findings

### No obvious committed provider credential in the reviewed source

- Current tracked file tree has `.env.example`, with unpopulated credential fields, but **does not contain `.env` or `.env.local`**.
- GitHub commit-path history queries for `.env` and `.env.local` returned no commits on `main`. A commit message referencing `.env` actually changed `.env.example`.
- Static patterns for common API token formats and non-example email addresses produced no obvious live credential in the reviewed textual sources. Apparent key assignments in test files use mocked/dummy test values.
- `.gitignore` excludes local environment files, private database files, uploads and transcripts.
- **Limit:** This does not replace a complete secret-history scan (for example, Gitleaks) or GitHub's secret scanning, including all refs.

### Positive safeguards in the current app

- Node backend binds to `127.0.0.1:8787` rather than an internet-facing address.
- Calls to that service require an on-device random session token checked with a timing-safe comparison. The Tauri token-reading command is restricted to the main window.
- The backend limits request size, request frequency, concurrent calls, and timeouts.
- Job-posting URL import requires HTTPS, checks DNS answers against private/reserved address ranges, pins the resolved IP, limits redirects and response bytes. This reduces SSRF risk.
- API keys are read in the local Node backend from private environment variables, not from `NEXT_PUBLIC_` frontend variables.
- Tauri's default and HUD window capabilities are narrowly scoped.

### Known security and release limitations

1. **Dependency advisory: Next.js 16.1.7 and Sharp 0.34.5.** These versions fall within the affected range of [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), a critical advisory for the Next.js **Image Optimization API when SVGs are used on glibc Linux**. The submitted Tauri app uses a **static Next.js export**, not a hosted image-optimization API, so this particular server exploit path is not present in the shipped desktop runtime. **Update Next.js to at least 16.4.1 and Sharp to at least 0.35.5 before deploying a Next.js server**, and test builds after changes. Other advisories may also affect these versions; this is not a full dependency vulnerability scan.
2. The React packages actually resolved in `package-lock.json` are `react` / `react-dom` 19.3.1; these are more current than the compatible ranges in `package.json`. `react-server-dom-webpack` is not a standalone lockfile package. Do not infer a React Server Components vulnerability without checking actual runtime and build architecture.
3. **Not standalone:** Tauri installers do not include or launch `backend/server.ts`. Installing the executable alone leaves AI-powered workflows unavailable. Developer API credentials must not be bundled or published to remedy this.
4. **Plaintext local storage:** approved Career Memory persists in local SQLite, not encrypted at rest. OS account permissions are the primary protection.
5. **Third-party data handling:** AI requests send relevant resume, career, voice, and job information to explicitly configured remote model providers; users should not assume all content stays offline.
6. **Unsigned builds:** Windows and macOS installer artifacts are not code-signed; macOS bundles are not notarized. These are hackathon prototype artifacts, not verified production releases.
7. **OS feature parity:** Windows system-output loopback is not implemented on macOS.
8. **CI supply chain:** workflow actions currently use version tags, not immutable SHA pins. Pin action SHAs and review dependencies before production distribution.

## Validation not completed in this review

- No direct `npm audit`, `cargo audit`, or history-wide `gitleaks` scan; these need to run against a full checkout with registry access.
- GitHub Dependabot, secret-scanning, and code-scanning alert statuses could not be queried with the current integration. Inspect **Security** in GitHub directly.
- No dynamic penetration test, fuzzing, binary reverse engineering, installer execution on a clean machine, or privacy review of binary media assets.
- Passing installer compilation is **not** a pass on functional readiness or security.

## Before a wider release

- Enable GitHub dependency and secret alerts plus push protection where available.
- Run `npm audit` and `cargo audit`, triage results, and pin workflow action SHAs.
- Build a secure standalone backend plan (or authenticated hosted API / guarded BYOK); do not distribute developer keys.
- Review encrypted storage, disclosure and retention of user career information, signed installers, and macOS audio parity.

**Submission position:** Reasonable to present the source repository and the honest demo as a hackathon prototype with the limitations above. **Do not** claim the installer is a standalone, production-secure desktop app.
