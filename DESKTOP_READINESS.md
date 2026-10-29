# Desktop readiness — 2026-10-28

## Working today

- Tauri 2 loads the statically exported Next.js interface in a maximized Windows window titled VantSide. The bundle configuration includes Windows and macOS icons. The four preparation steps and simulated text practice are implemented; the real-interview Go Live HUD is a future destination.
- The native process owns a versioned SQLite database under Tauri's app-local-data directory (normally `%LOCALAPPDATA%\com.vantside.meta\career-memory.sqlite3` on Windows). Approved memory and opportunity records are saved transactionally; raw audio and full transcripts are session-only. Migration tests cover earlier records. The database is **not encrypted**.
- The separate Node service binds to `127.0.0.1:8787`, accepts known local origins, and reads Meta credentials from `.env.local` in development. The static frontend uses a build-time loopback URL. These process limits are not authentication.
- Microphone capture is user initiated and a completed answer is sent to the local backend for turn-based transcription. Device behavior in a packaged Windows WebView still needs manual verification. Questions are displayed as text; there is no speech generation.

## Risks and blockers

- **Packaged executable is not standalone:** `tauri build` packages the frontend and SQLite code, but does not launch, bundle, or supervise the Node Meta backend. Running only the executable cannot perform resume extraction, interviews, or cue generation. Installing Node and running `npm run backend:dev` with a separate `.env.local` is currently a development workflow, not a distributable solution.
- The developer Meta key must never be shipped in the executable, sidecar, static assets, or installer. A shared-key hosted API needs real user access controls, durable quotas, and spending limits before public distribution. Future BYOK needs reviewed OS-backed key storage. OpenAI credentials and provider integration are not part of this build.
- Windows WebView2 microphone permission, selected devices, output routing, and the speaker test require device QA. Output selection is offered only when the WebView exposes `setSinkId`; a system-default fallback remains. macOS needs microphone usage metadata, Intel and Apple Silicon builds, signing/notarization, and runtime device checks.
- The local SQLite file follows account permissions but is plaintext. Windows profile backup/snapshots may preserve deleted data. Manual packaged-app close/reopen and deletion tests remain necessary.
- The static export uses a loopback URL baked at build time. Changing the backend port later requires a matching frontend build. The current CSP permits local connections and native commands are limited to memory load/save.
- A prior Windows build encountered `.next` `EPERM` when reusing output or generating pages concurrently. The build script now removes only the ignored `.next` directory and limits workers. On this audit run, Webpack stayed at "Creating an optimized production build" for several minutes without an `EPERM` diagnostic, so that run was stopped; a completed fresh export is still required. Recheck only after ensuring no development process is using that output; do not remove user data or the SQLite directory.

## Recommended next actions

1. Manually test the packaged Windows app from a clean user environment: launch, backend reachability, one short Meta request, microphone permission, device controls, and memory save/reopen/delete. Report the standalone backend limitation explicitly.
2. Choose a secure distribution path for Meta requests: authenticated hosted HTTPS with durable quotas and a spending cap, or a separately reviewed user-key design with OS-backed storage. Do not package the developer key.
3. After the Windows runtime path works, add macOS microphone metadata and test signed Intel and Apple Silicon builds on real devices.
