# Version bump

Auto Release (`.github/workflows/auto-release.yml`) always does at least a patch bump on every push to `main`. To force a release with no real code change, edit this file instead of pushing an empty commit.

- 2026-09-20 — created this file
- 2026-09-21 — frame-ancestors * so packaged RolePlaymate/KVGenius can iframe the UI
- 2026-09-21 — source logo + generated icons (KVG_Standards branding checklist)
- 2026-09-21 — in-app Check for Updates (electron-updater UI, Sweeper pattern)
- 2026-09-21 — GPU process tabs: Active/compute vs UI & overlays
- 2026-09-21 — scan/add services (no baked-in Ollama/Comfy cards)
- 2026-09-21 — Use PATH on every service card (not only Ollama)
- 2026-09-21 — install folder XOR Use PATH; scan treats localhost≡127.0.0.1 as already added
- 2026-09-21 — Kill button on GPU Active/compute (skip Insufficient Permissions rows)
- 2026-09-21 — hide already-added hosts from scan results
- 2026-09-21 — filter already-added out of scan API too (port + localhost≡127.0.0.1)
- 2026-09-21 — rename Install → Launch from (folder or PATH)
