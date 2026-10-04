# Repo scope

Hardpoint is a **local services dashboard** focused on AI servers (Ollama, Chatterbox, GPU), but any server you can start/stop on this machine can be a mount — including non-HTTP ones such as a UDP game server. It is not a roleplay chat client or character library; the one chat it has is the **Assistant**, an operator chat that sets up and manages mounts.

## In scope

- Start/stop locally configured Ollama, Chatterbox, and other server installs (mounts), with HTTP, TCP, or process-based status checks
- GPU snapshot via `nvidia-smi`
- Loopback HTTP API on `127.0.0.1:3921` for status and control
- **Assistant**: an in-app chat (Claude Agent SDK, using the user's own Claude sign-in) that works out a server's start/stop/probe settings and saves the mount. It is limited to reading and to managing mounts: it cannot write files or run commands of its own.
- KVG_Standards: VisualAssault themes, AGPL-3.0, release workflows, electron-updater, minimal Electron menu

## Out of scope

- Model download UI, roleplay/general chat, TTS playback, database or encryption features (those live in RolePlaymate)

See [KVG_Standards REPO_SCOPE](https://github.com/gerp93/KVG_Standards) for the shared standards map.
