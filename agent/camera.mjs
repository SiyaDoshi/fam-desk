// Watches the caller's FaceTime camera and keeps the latest frame, so tools can take a snapshot.
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';
import { rotate } from './image.mjs';

const ROTATION_DEGREES = [0, 90, 180, 270];   // VideoRotation enum order

export class CallerCamera {
  #latest = null;        // { frame, rotation } as received
  #reading = new Set();  // track sids already being read

  /** Start reading video from `participant` (the caller) in `room`. */
  constructor(room, participant) {
    const watch = (track, _pub, who) => {
      if (who.identity !== participant.identity || track.kind !== TrackKind.KIND_VIDEO) return;
      if (this.#reading.has(track.sid)) return;
      this.#reading.add(track.sid);
      this.#read(track).finally(() => this.#reading.delete(track.sid));
    };
    room.on(RoomEvent.TrackSubscribed, watch);
    for (const pub of participant.trackPublications.values()) {
      if (pub.track) watch(pub.track, pub, participant);
    }
    this.stop = () => room.off(RoomEvent.TrackSubscribed, watch);
  }

  async #read(track) {
    console.log('[camera] caller video track subscribed');
    try {
      for await (const event of new VideoStream(track)) {
        this.#latest = { frame: event.frame, rotation: event.rotation };
      }
    } catch (err) {
      console.warn('[camera] video stream ended:', err.message);
    }
  }

  /** True once at least one frame has arrived. */
  get hasVideo() { return this.#latest !== null; }

  /** The latest frame as an upright RGBA image { data, width, height }, or null. */
  snapshot() {
    if (!this.#latest) return null;
    const { frame, rotation } = this.#latest;
    const rgba = frame.convert(VideoBufferType.RGBA);
    const img = { data: new Uint8Array(rgba.data), width: rgba.width, height: rgba.height };
    return rotate(img, ROTATION_DEGREES[rotation] ?? 0);
  }
}
