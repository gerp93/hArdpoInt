# CLAUDE.md

Hardpoint is a self-contained Electron + Vite + React app that monitors and
controls local AI services (Ollama, Chatterbox, GPU/CPU load). Source of truth:
https://github.com/gerp93/hArdpoInt

## Commands

```bash
npm install
npm run dev      # Vite :5174 + electron main
npm run build
npm run typecheck
npm run package  # electron-builder → release/
```

## Architecture

- `src/main/` — Electron main: `main.ts` (window, IPC, menu, updater), `config.ts` (BOM-safe `app-config.json` in userData), `ollama.ts` / `chatterbox.ts` (HTTP to local servers), `launch.ts` (start/stop, folder pickers), `gpu.ts` (`nvidia-smi`), `localServerProcess.ts` (port/process stop), `apiServer.ts` (127.0.0.1:3921 only, CORS for localhost).
- `src/renderer/` — Single-page dashboard (`Dashboard.tsx`), VisualAssault themes (`themes.css` vendored), `hardpoint-theme` in localStorage.
- `src/shared/types.ts` — `DashboardStatus` and IPC/API shapes.

Data stays on the machine; Hardpoint does not ship models. Windows Chatterbox launch uses `cmd.exe` with separate argv tokens for `start` / `/D` / `python.exe` / `start.py` flags — never a single quoted `/k` string.

## Standards

Follow [gerp93/KVG_Standards](https://github.com/gerp93/KVG_Standards) for theming, release/CI, licensing, and menu conventions (View + Help only).
