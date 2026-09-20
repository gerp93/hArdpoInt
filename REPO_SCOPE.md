# Repo scope

Hardpoint is a **local AI services dashboard** (Ollama, Chatterbox, GPU). It is not a chat client or character library.

## In scope

- Start/stop locally configured Ollama and Chatterbox installs
- GPU snapshot via `nvidia-smi`
- Loopback HTTP API on `127.0.0.1:3921` for status and control
- KVG_Standards: VisualAssault themes, AGPL-3.0, release workflows, electron-updater, minimal Electron menu

## Out of scope

- Model download UI, chat, TTS playback, database or encryption features (those live in RolePlaymate)

See [KVG_Standards REPO_SCOPE](https://github.com/gerp93/KVG_Standards) for the shared standards map.
