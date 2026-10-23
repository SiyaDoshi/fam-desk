# FamDesk

**AI tech support for your parents, on FaceTime.** Mom calls the agent, points her
camera at the TV, router or laptop, and it sees the exact device, looks up the fix
for that model, and walks her through it one step at a time, circling what to press
right on her screen. When it's done, it texts you what happened.

Built at the Beta Fund × AWS × OpenAI Multi-Model Hackathon with
[Chert](https://trychert.com) (FaceTime + iMessage), [Keenable](https://keenable.ai)
(web search), [Nebius](https://nebius.com) (open models) and LiveKit.

## Modalities

Video (the caller's camera, and the agent's annotated picture) · voice (speech in and out)
· vision (device and step recognition) · web search · text (iMessage summary).

## How it works

```
Mom's iPhone --FaceTime--> Chert --LiveKit room--> agent/ (Node)
                                                    speech: LiveKit Inference
                                                    LLM + tools: Nebius
                                                    vision: Nebius vision model
                                                    Fix Researcher: Keenable search -> Nebius
                                                    agent video: Mom's snapshot + red circle
```

1. A call starts: Mom FaceTimes the line, or a family member runs `npm run ask-help` to text her an invite.
2. The agent asks what's wrong and looks at the camera to identify the device.
3. The brain researches model-specific steps with Keenable.
4. For each step, the agent circles the target on Mom's screen, then checks the camera to confirm.
5. At the end it iMessages the family a summary.

## Run

See [`agent/README.md`](agent/README.md).
