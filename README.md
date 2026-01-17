# DataLab (by Vietrix)

Cross-platform desktop application for distilling instruction and code datasets
for LLM training. Built with Tauri (Rust backend) and Material Design 3 web UI.

## Requirements
- Node.js 18+
- Rust toolchain (stable)
- vbuild task runner: https://github.com/vietrix/vbuild

## Development

Use vbuild as the primary task runner:

```sh
vbuild dev
```

Front-end only:

```sh
vbuild frontend:dev
```

## Build & Packaging

Generate icons from `src/assets/icon.svg`, then build platform installers:

```sh
vbuild build
```

Tauri outputs installers in `src-tauri/target/release/bundle/`.

## Feature Highlights
- Import JSON, JSONL, or CSV datasets.
- Preview records with syntax-highlighted code blocks.
- Filter by length, keywords, categories, and duplicates.
- Distill via random sampling, diversity buckets, or score-based selection.
- Manually adjust selections before export.
- Export distilled data as JSON or CSV.
- Dark mode UI with startup splash and recent log preview.
- Built-in updater targeting GitHub Releases.
- Multi-language UI via `src/i18n/*.json`.

## Auto Updates (GitHub Releases)
The updater is wired through `@tauri-apps/plugin-updater` and `src-tauri/tauri.conf.json`.
Before releasing:
1. Generate keys: `npx tauri signer generate --write-keys src-tauri/keys/datalab.key --ci`.
2. Add the private key content to GitHub Secrets:
   - `TAURI_SIGNING_PRIVATE_KEY` = contents of `src-tauri/keys/datalab.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = password used when generating the key
3. Push a version tag like `v0.1.0`. The release workflow builds installers, creates `latest.json`, and uploads updater artifacts automatically.

## Project Layout
- `src/` web UI (Lit + Material Web)
- `src/i18n/` translations (`en.json`, `vi.json`)
- `src-backend/` Rust backend crate (dataset processing)
- `src-tauri/` Tauri shell + commands + config
- `.vbuild.yml` vbuild tasks and workflow
