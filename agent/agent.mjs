// FamDesk: a patient tech-support helper for parents, on FaceTime through Chert.
// Pipeline: speech-to-text -> LLM (with tools) -> text-to-speech. No OpenAI key needed:
//   - STT, TTS and VAD: LiveKit Inference (uses your LiveKit Cloud project's free credits)
//   - LLM: Nebius Token Factory (OpenAI-compatible) if NEBIUS_API_KEY is set,
//          otherwise LiveKit Inference.
// It watches the caller's camera, asks the brain (brain.mjs) what it sees, and points at
// things by showing the caller their own snapshot with a red circle and arrow.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, cli, defineAgent, inference, llm, ServerOptions, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { z } from 'zod';
import * as brain from './brain.mjs';
import { CallerCamera } from './camera.mjs';
import { drawFace, FPS, HEIGHT, WIDTH } from './face.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { annotate, shrink, toJpegBase64 } from './image.mjs';
import { sendText } from './imessage.mjs';

const REQUEST_FILE = fileURLToPath(new URL('./.help-request.json', import.meta.url));
const SHOW_POINTER_MS = 30_000;   // how long a circled picture stays up

function chooseLLM() {
  if (process.env.NEBIUS_API_KEY) {
    return new openai.LLM({
      apiKey: process.env.NEBIUS_API_KEY,
      baseURL: process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1/',
      model: process.env.NEBIUS_MODEL || 'meta-llama/Llama-3.3-70B-Instruct',
      temperature: 0.3,
    });
  }
  return process.env.LIVEKIT_LLM || 'openai/gpt-4.1-mini';
}

/** A help request saved by `npm run ask-help` in the last 3 hours, if any. */
function pendingRequest() {
  try {
    if (!existsSync(REQUEST_FILE)) return null;
    const req = JSON.parse(readFileSync(REQUEST_FILE, 'utf8'));
    return Date.now() - Date.parse(req.at) < 3 * 3600_000 ? req : null;
  } catch { return null; }
}

function instructionsFor(request) {
  const context = request
    ? `${request.requester} asked you to help this caller with ${request.problem}. Mention that kindly.`
    : 'The caller called you directly. Ask what they need help with.';
  return `You are FamDesk, a warm, patient AI tech helper on a FaceTime video call.
Your callers are often older parents who are not comfortable with technology. ${context}

How you work:
1. Ask what is wrong, then ask them to point their camera at the device. As soon as they say anything
   like "okay", "here" or "can you see it", call look_at_device. If they already described the device
   and are showing it, call look_at_device right away instead of asking again.
2. Call find_fix with the device and their problem in their words.
3. Guide ONE step at a time. Before each step that involves pressing, plugging or finding something,
   call point_to with what to look at, then say "I've circled it on your screen."
4. Wait for them to say they did it. Then call check_step. If it is not done, gently help again.
5. When it works, or if it needs a repair person, call finish_call with a short summary, then say goodbye.

Rules: keep every reply to one or two short sentences. Speak in simple sentences with no jargon or brand-new terms. Never give more than one step
at a time. Praise them when they get it right. If you cannot see well, ask them to move closer or turn
on a light. Be clear that you are an AI. Never ask for passwords or payment details.`;
}

export default defineAgent({
  entry: async ctx => {
    // Subscribe to everything: we need the caller's camera, not just their audio.
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    const caller = await ctx.waitForParticipant();
    const camera = new CallerCamera(ctx.room, caller);
    const request = pendingRequest();
    if (request) rmSync(REQUEST_FILE, { force: true });   // one request, one call

    // ---- The agent's own video: a face, or a circled snapshot while pointing ----
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let tick = 0, speaking = false;
    let pointer = null;   // { frames: [Uint8Array, Uint8Array], until }
    const frame = () => {
      tick++;
      const pixels = pointer && Date.now() < pointer.until
        ? pointer.frames[Math.floor(tick / 8) % 2]
        : drawFace(tick, speaking);
      if (pointer && Date.now() >= pointer.until) pointer = null;
      source.captureFrame(new VideoFrame(pixels, WIDTH, HEIGHT, VideoBufferType.RGBA));
    };
    frame();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(frame, 1000 / FPS);

    // ---- Call state and tools ----
    const state = { device: null, problem: request?.problem || '', steps: [], log: [] };
    const takeSnapshot = async () => {
      const img = await camera.snapshot();
      return img ? shrink(img, 640) : null;
    };
    const noVideo = 'I cannot see the camera yet. Ask them to switch to FaceTime video and point the back camera at the device.';

    const tools = {
      look_at_device: llm.tool({
        description: 'Look at the caller\'s camera to identify the device and anything visibly wrong (lights, error messages).',
        parameters: z.object({ hint: z.string().describe('What the caller said it is, or empty').optional() }),
        execute: async ({ hint }) => {
          const img = await takeSnapshot();
          if (!img) return noVideo;
          state.device = await brain.identify(toJpegBase64(img), hint || '');
          state.log.push(`Saw: ${JSON.stringify(state.device)}`);
          return state.device;
        },
      }),
      find_fix: llm.tool({
        description: 'Search the web for simple steps to fix the problem on this exact device.',
        parameters: z.object({ problem: z.string().describe('The problem in the caller\'s own words') }),
        execute: async ({ problem }) => {
          state.problem = problem;
          const result = await brain.research(state.device || { device_type: 'unknown' }, problem);
          state.steps = result.steps || [];
          state.log.push(`Found ${state.steps.length} steps for: ${problem}`);
          return result;
        },
      }),
      point_to: llm.tool({
        description: 'Circle something on the caller\'s screen (a button, light, cable or setting) so they know where to look.',
        parameters: z.object({ target: z.string().describe('What to point at, e.g. "reset button"') }),
        execute: async ({ target }) => {
          const img = await takeSnapshot();
          if (!img) return noVideo;
          const spot = await brain.locate(toJpegBase64(img), target, { width: img.width, height: img.height });
          if (!spot?.found) return `Could not find the ${target} in the picture. Ask them to move the camera closer to it.`;
          const point = { x: Math.min(1, Math.max(0, spot.x)), y: Math.min(1, Math.max(0, spot.y)) };
          pointer = {
            frames: [annotate(img, point, WIDTH, HEIGHT, false), annotate(img, point, WIDTH, HEIGHT, true)],
            until: Date.now() + SHOW_POINTER_MS,
          };
          state.log.push(`Pointed at: ${target}`);
          return `The ${target} is now circled in red on their screen.`;
        },
      }),
      check_step: llm.tool({
        description: 'Look at the camera to confirm the caller finished a step.',
        parameters: z.object({ step: z.string().describe('The step they were asked to do') }),
        execute: async ({ step }) => {
          const img = await takeSnapshot();
          if (!img) return noVideo;
          const result = await brain.check(toJpegBase64(img), step);
          if (result.done) pointer = null;
          state.log.push(`Checked "${step}": ${result.done ? 'done' : 'not yet'}`);
          return result;
        },
      }),
      finish_call: llm.tool({
        description: 'At the end of the call: text the family member a short summary of what happened.',
        parameters: z.object({
          summary: z.string().describe('One or two sentences: what was wrong and what fixed it'),
          fixed: z.boolean().describe('True if the problem is solved'),
        }),
        execute: async ({ summary, fixed }) => {
          const to = process.env.FAMILY_PHONE;
          const body = `FamDesk update: ${fixed ? 'Fixed' : 'Not fixed yet'}. ${summary}`;
          const result = await sendText(to, body);
          console.log('[summary]', body, '\n[log]', state.log.join(' | '));
          return result.sent ? 'Summary sent to the family.' : 'Summary saved (texting is not set up).';
        },
      }),
    };

    const session = new voice.AgentSession({
      stt: process.env.LIVEKIT_STT || 'deepgram/nova-3:en',
      llm: chooseLLM(),
      tts: process.env.LIVEKIT_TTS || 'cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',
      vad: new inference.VAD(),
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => { speaking = event.newState === 'speaking'; });
    session.on(voice.AgentSessionEventTypes.Error, event => console.error('[session error]', event.error?.message || event.error));
    // Latency log: shows which part is slow (turn detection, LLM, or text-to-speech).
    session.on(voice.AgentSessionEventTypes.MetricsCollected, ({ metrics: m }) => {
      if (m.type === 'eou_metrics') console.log(`[timing] end of turn detected after ${Math.round(m.endOfUtteranceDelayMs)} ms`);
      if (m.type === 'llm_metrics') console.log(`[timing] LLM first token ${Math.round(m.ttftMs)} ms (total ${Math.round(m.durationMs)} ms)`);
      if (m.type === 'tts_metrics') console.log(`[timing] TTS first audio ${Math.round(m.ttfbMs)} ms`);
    });
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, e => { if (e.isFinal) console.log(`[heard] ${e.transcript}`); });
    session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, e => console.log('[tools]', (e.functionCalls || []).map(c => c.name).join(', ')));
    ctx.addShutdownCallback(async () => {
      clearInterval(timer);
      camera.stop();
      await session.close();
      await track.close();
      await source.close();
    });
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions: instructionsFor(request), tools }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: false,      // we read video ourselves in camera.mjs
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });

    const greeting = request
      ? `Greet the caller warmly in one or two short sentences: say you're an AI helper, that ${request.requester} asked you to help with ${request.problem}, and ask them to point their camera at it.`
      : 'Greet the caller warmly in one short sentence: say you are an AI tech helper and ask what they need help with today.';
    // Greet once on Chert's bridge_ready signal (the call drops if silent for 10 s after it).
    const stopGreeting = greetOnBridgeReady(ctx.room, () => session.generateReply({ instructions: greeting }));
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: process.env.AGENT_NAME || 'siya-techhelp',
}));
