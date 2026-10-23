# FamDesk — project context for coding agents

AI tech support for parents over FaceTime (Beta × AWS × OpenAI hackathon, Oct 23 2026).
Mom FaceTimes the agent and points her camera at a device; the agent identifies it, researches
the fix with Keenable, and guides her one step at a time, circling what to press on her screen.
At the end it iMessages the family a summary.

## Layout

Everything lives in `agent/`: a Node LiveKit agent on Chert FaceTime (started from
`chert new --video`). Read `agent/AGENTS.md` for Chert's rules. Do not break: greet on
`bridge_ready`, exactly one audio track, the agent publishes its own camera track.

- `agent.mjs` — session, persona, tools, the agent's video output
- `brain.mjs` — vision (Nebius vision model) and the Fix Researcher (Keenable search → Nebius steps)
- `camera.mjs` — caller video snapshots; `image.mjs` — pixels, JPEG, circle and arrow
- `imessage.mjs`, `ask-help.mjs` — optional Chert iMessage sending

## Models (no OpenAI key)

- Speech: LiveKit Inference (STT `deepgram/nova-3`, TTS Cartesia, VAD silero).
- LLM + vision: Nebius Token Factory, OpenAI-compatible, base URL `https://api.tokenfactory.nebius.com/v1/`.
- Search: Keenable `POST https://api.keenable.ai/v1/search` with `X-API-Key: keen_...`.

Every brain function falls back to a fake answer when keys are missing or a call fails.

## Secrets

Keys live in `agent/.env.local` — never commit them, never print them.
