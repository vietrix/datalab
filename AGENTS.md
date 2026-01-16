# Repository Guidelines

## Project Structure & Module Organization
- `src/` frontend (Lit + Material Web, styles, assets).
- `src/i18n/` translations (`en.json`, `vi.json`).
- `src/assets/` source artwork (e.g., `icon.svg`) for installers.
- `src-backend/` Rust backend crate (pure data logic).
- `src-tauri/src/` Tauri shell + commands + platform helpers.
- `.vbuild.yml` defines the task runner workflow.

## Build, Test, and Development Commands
```sh
vbuild dev
vbuild build
vbuild icons
vbuild frontend:dev
```
Fallback:
```sh
npm run tauri:dev
npm run tauri:build
```

## Coding Style & Naming Conventions
- TypeScript + Lit in `src/`, Rust 2021 in `src-tauri/src/`.
- 2-space indentation; `snake_case` for Rust; `PascalCase` for components.
- Keep files small and focused. Commands should delegate to modules. Never cram large features into a single file; split by responsibility.
- UI strings live in `src/i18n/*.json` (update both locales).

## Testing Guidelines
No automated tests yet. If you add them: `cargo test` for Rust, and a frontend runner (e.g., Vitest).

## Commit & Pull Request Guidelines
Use Conventional Commits and include a short summary + screenshots for UI changes.

## Security & Release Notes
Updater config is in `src-tauri/tauri.conf.json` (pubkey + GitHub `latest.json` endpoint). Build artifacts with `vbuild build` and attach to GitHub Releases. Never commit secrets.
