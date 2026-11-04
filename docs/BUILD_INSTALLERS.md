# Native installer builds (prototype)

Build pipeline: `.github/workflows/build-desktop.yml`

The workflow produces **unsigned, not-notarized prototype installers** for:

- Windows x64: `.exe` (NSIS)
- macOS Apple Silicon: `.dmg`
- macOS Intel: `.dmg`

Use the **Actions** tab for workflow run artifacts. The macOS DMG is **not a Windows executable**, and these files are different architectures.

## IMPORTANT — these are not standalone AI-capable releases

The Tauri app packages the **Next.js static frontend** and native SQLite store, but the API still runs from `backend/server.ts` as a separate **Node.js loopback service**. Installing only the `.exe` or `.dmg` does not start that service. Resume extraction, AI interviews, cue generation and other model-backed interactions will fail unless a compatible backend is running on `127.0.0.1:8787` and correctly authorized.

This workflow intentionally **does not embed or upload API keys**; do not put developer model credentials in the installable app or public repo. There is no secure packaged credential setup yet. These builds are for packaging and manual validation, **not public production distribution**.

To run the local backend for *your own development testing*, clone the matching repo/branch, configure `.env.local` privately from `.env.example`, then in a separate terminal:

```sh
npm ci
npm run backend:dev
```

Keep that process running while using the installed app. Do not ship the `.env.local` file to hackathon reviewers.

The current **Windows WASAPI system-audio loopback is Windows-only**. The macOS builds may start, but automatic system-output capture is not yet implemented. macOS microphone permission metadata is included; device operation still requires testing on each platform.

Because the Windows installer is not signed and the macOS bundles are not Apple notarized, OS trust prompts may appear. Do not present these as verified or signed downloads.

## Local builds

Requires Node.js, Rust, the Tauri 2 desktop build prerequisites, and on macOS Xcode command line tools.

Windows (PowerShell):

```powershell
npm ci
npm run tauri -- build --bundles nsis
```

macOS:

```sh
npm ci
npm run tauri -- build --bundles dmg
```

The output is under `src-tauri/target/release/bundle/` (or a target-specific release bundle folder). The Tauri `beforeBuildCommand` executes the Next.js static export.

## Submission

For the hackathon submit the repository URL, demonstration video, build instructions, and accurate feature/limitations disclosure. Treat the binaries as optional demonstration artifacts until the API backend is securely packaged and verified. 
