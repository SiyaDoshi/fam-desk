// Takes snapshots of the caller's FaceTime camera, on demand.
// It does NOT read every frame: copying 30 full video frames a second in JavaScript
// slows the whole agent down (late replies, dropped calls). Instead, each snapshot
// opens the video track briefly, takes one frame and closes it.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';
import jpeg from 'jpeg-js';
import { rotate } from './image.mjs';

const ROTATION_DEGREES = [0, 90, 180, 270];   // VideoRotation enum order
// Stand-in camera (npm run webcam): the latest browser webcam frame, used only when
// no caller video reaches the call.
const WEBCAM_FILE = fileURLToPath(new URL('./.webcam.jpg', import.meta.url));

/** The latest stand-in webcam frame if it is under 5 s old, else null. */
function webcamFrame() {
  try {
    if (Date.now() - statSync(WEBCAM_FILE).mtimeMs > 5000) return null;
    const d = jpeg.decode(readFileSync(WEBCAM_FILE), { useTArray: true, maxMemoryUsageInMB: 256 });
    return { data: d.data, width: d.width, height: d.height };
  } catch { return null; }
}

export class CallerCamera {
  #track = null;

  /** Watch for the caller's (`participant`) video track in `room`. */
  constructor(room, participant) {
    const watch = (track, _pub, who) => {
      if (who.identity !== participant.identity || track.kind !== TrackKind.KIND_VIDEO) return;
      if (this.#track !== track) console.log('[camera] caller video track available');
      this.#track = track;
    };
    const gone = (track) => { if (track === this.#track) this.#track = null; };
    // Diagnostics: log every track anyone publishes or we subscribe to, to see whether
    // the caller's camera reaches the room at all.
    const logPub = (pub, who) => console.log(`[camera] ${who.identity} published ${pub.kind === TrackKind.KIND_VIDEO ? 'VIDEO' : 'audio'} track (source ${pub.source})`);
    const logSub = (track, _pub, who) => console.log(`[camera] subscribed to ${who.identity}'s ${track.kind === TrackKind.KIND_VIDEO ? 'VIDEO' : 'audio'} track`);
    room.on(RoomEvent.TrackPublished, logPub);
    room.on(RoomEvent.TrackSubscribed, logSub);
    room.on(RoomEvent.TrackSubscribed, watch);
    room.on(RoomEvent.TrackUnsubscribed, gone);
    for (const pub of participant.trackPublications.values()) {
      logPub(pub, participant);
      if (pub.track) watch(pub.track, pub, participant);
    }
    const report = setTimeout(() => {
      if (!this.#track) console.warn(`[camera] no video track from ${participant.identity} after 15 s: the caller's camera is not reaching the agent`);
    }, 15_000);
    this.stop = () => {
      clearTimeout(report);
      room.off(RoomEvent.TrackPublished, logPub); room.off(RoomEvent.TrackSubscribed, logSub);
      room.off(RoomEvent.TrackSubscribed, watch); room.off(RoomEvent.TrackUnsubscribed, gone);
    };
  }

  get hasVideo() { return this.#track !== null || webcamFrame() !== null; }

  /** One upright RGBA frame { data, width, height } from the caller's camera, or null. */
  async snapshot(timeoutMs = 3000) {
    if (!this.#track) {
      const frame = webcamFrame();
      if (frame) console.log('[camera] using the stand-in webcam (no caller video on this call)');
      return frame;
    }
    const reader = new VideoStream(this.#track).getReader();
    try {
      const next = reader.read();
      const timeout = new Promise(resolve => setTimeout(() => resolve({ done: true }), timeoutMs));
      const { value, done } = await Promise.race([next, timeout]);
      if (done || !value) return null;
      const rgba = value.frame.convert(VideoBufferType.RGBA);
      const img = { data: new Uint8Array(rgba.data), width: rgba.width, height: rgba.height };
      return rotate(img, ROTATION_DEGREES[value.rotation] ?? 0);
    } catch (err) {
      console.warn('[camera] snapshot failed:', err.message);
      return null;
    } finally {
      reader.cancel().catch(() => {});
    }
  }
}
