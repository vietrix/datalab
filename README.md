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
1. Generate a signing key: `cargo tauri signer generate` (store the private key securely).
2. Set `plugins.updater.pubkey` and `plugins.updater.endpoints` in `src-tauri/tauri.conf.json`.
3. Run `vbuild build` to produce updater artifacts and upload them with `latest.json` to the GitHub Release.

## Project Layout
- `src/` web UI (Lit + Material Web)
- `src/i18n/` translations (`en.json`, `vi.json`)
- `src-backend/` Rust backend crate (dataset processing)
- `src-tauri/` Tauri shell + commands + config
- `.vbuild.yml` vbuild tasks and workflow
