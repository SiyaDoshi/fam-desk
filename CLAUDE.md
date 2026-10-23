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
- `brain.mjs` — vision and the Fix Researcher (Keenable search → model-written steps)
- `camera.mjs` — caller video snapshots; `image.mjs` — pixels, JPEG, circle and arrow
- `imessage.mjs`, `ask-help.mjs` — optional Chert iMessage sending

## Models (no OpenAI key)

- Speech: LiveKit Inference (STT `deepgram/flux-general-en` with STT turn detection (no local VAD), TTS Cartesia).
- LLM + vision: LiveKit Inference (`openai/gpt-4.1-mini`) by default; Nebius Token Factory
  (OpenAI-compatible, `https://api.tokenfactory.nebius.com/v1/`) when `NEBIUS_API_KEY` is set, falling back to LiveKit.
- Search: Keenable `POST https://api.keenable.ai/v1/search` with `X-API-Key: keen_...`.

Every brain function falls back to a fake answer if all model calls fail.

## Secrets

Keys live in `agent/.env.local` — never commit them, never print them.
