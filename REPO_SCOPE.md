# Repo scope

Hardpoint is a **local services dashboard** focused on AI servers (Ollama, Chatterbox, GPU), but any server you can start/stop on this machine can be a mount — including non-HTTP ones such as a UDP game server. It is not a chat client or character library.

## In scope

- Start/stop locally configured Ollama, Chatterbox, and other server installs (mounts), with HTTP, TCP, or process-based status checks
- GPU snapshot via `nvidia-smi`
- Loopback HTTP API on `127.0.0.1:3921` for status and control
- KVG_Standards: VisualAssault themes, AGPL-3.0, release workflows, electron-updater, minimal Electron menu

## Out of scope

- Model download UI, chat, TTS playback, database or encryption features (those live in RolePlaymate)

See [KVG_Standards REPO_SCOPE](https://github.com/gerp93/KVG_Standards) for the shared standards map.
