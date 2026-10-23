# FamDesk agent

A patient AI tech helper for parents, on FaceTime through Chert. Mom FaceTimes the
line, points her camera at the device, and the agent identifies it, finds the fix and
walks her through it one step at a time, circling what to press on her screen.

No OpenAI key needed: speech uses LiveKit Inference (your LiveKit Cloud free credits),
and the LLM uses Nebius (or LiveKit Inference if no Nebius key).

## Run it (on your Mac)

Node 24 is recommended (22.23+ works).

```sh
cd agent
npm install
cp .env.example .env.local && chmod 600 .env.local   # then fill in your values
```

Terminal 1:
```sh
npm start
```

Terminal 2 (same folder):
```sh
npx --yes @trychert/facetime@0.1.0-beta.10 setup --env-file .env.local --project <your Chert project id>
npx --yes @trychert/facetime@0.1.0-beta.10 doctor
npx --yes @trychert/facetime@0.1.0-beta.10 dev --minutes 20
```

Then make a **FaceTime Video** call to the line from your verified iPhone.

### Camera: the phone camera page

The shared Chert line currently forwards only the caller's audio (the bridge publishes
`facetime-remote-audio` but not `facetime-remote-video`; caller video needs a video-enabled
line). Until then, the caller shows the device through a Safari page on the same iPhone:

```sh
npm run webcam                                              # terminal 3: prints a private link code
npx --yes cloudflared tunnel --url http://localhost:8090    # terminal 4: prints an https address
```

On the iPhone (during the FaceTime call), open `https://<trycloudflare address>/<code>` in
Safari, tap **Show my camera**, and point the back camera at the device. The page sends frames
to the agent and shows the agent's red circle on the live view. The FaceTime call keeps going
(its own camera pauses, since iOS lets one app use the camera at a time). Put the link in
`CAMERA_LINK` in `.env.local` and `npm run ask-help` includes it in the text to Mom.

If the line starts forwarding caller video, the agent uses that automatically.

## The three ways a call starts

1. **Mom FaceTimes the line** directly. The agent asks what's wrong.
2. **You ask for her:** `npm run ask-help -- +14155550123 "the Wi-Fi"`
   saves the request and texts Mom an invitation to FaceTime the line. When she calls,
   the agent already knows what it's about.
3. **Mom texts you / the agent:** today Chert can only *send* iMessages, so treat
   this like path 2 for now.

## Files

| File | What it does |
| --- | --- |
| `agent.mjs` | The agent: pipeline, persona, tools, agent video |
| `camera.mjs` | Reads the caller's camera and takes snapshots |
| `brain.mjs` | Vision (Nebius) and the Fix Researcher (Keenable + Nebius), with fake fallbacks |
| `image.mjs` | Rotate, resize, JPEG, and draw the red circle and arrow |
| `imessage.mjs` | Optional iMessage sending through Chert |
| `ask-help.mjs` | Path 2: text Mom and save the request |
| `face.mjs`, `greet.mjs` | From Chert's starter: idle face, greeting on `bridge_ready` |
| `webcam.mjs` | Stand-in camera: browser webcam page on localhost:8090 |
| `test-picture.mjs` | `npm run test:picture -- photo.jpg 0.7 0.4` previews the circle |

## Tools the LLM can call

`look_at_device`, `find_fix`, `point_to`, `check_step`, `finish_call`.
Each one calls the brain (or its fake answer, until your Nebius key is set).
