/**
 * Where a recording sits between the ears: -1 is the left ear at the start,
 * 1 is the right ear at the end. A recording with no length has no place yet.
 */
export function meetingEar(
  current: number,
  duration: number,
): number | undefined {
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0)
    return undefined;
  const span = Math.min(1, Math.max(0, current / duration));
  return span * 2 - 1;
}

/** The browser can move one recording from ear to ear. */
export function canWalkMeetingEars(): boolean {
  return (
    typeof AudioContext !== "undefined" &&
    typeof AudioContext.prototype.createStereoPanner === "function"
  );
}

export interface MeetingEarWalk {
  close: () => void;
  place: (current: number, duration: number) => void;
}

/**
 * Routes the recording through a stereo position. The panner is created
 * before the element is captured, so a browser that cannot pan leaves the
 * element's own output alone.
 */
export function walkMeetingEars(
  audio: HTMLAudioElement,
): MeetingEarWalk | undefined {
  if (!canWalkMeetingEars()) return undefined;
  const context = new AudioContext();
  try {
    const panner = context.createStereoPanner();
    panner.connect(context.destination);
    const source = context.createMediaElementSource(audio);
    source.connect(panner);
    const place = (current: number, duration: number) => {
      const ear = meetingEar(current, duration);
      if (ear !== undefined) panner.pan.value = ear;
    };
    place(audio.currentTime, audio.duration);
    void context.resume();
    return {
      close: () => {
        void context.close();
      },
      place,
    };
  } catch {
    void context.close();
    return undefined;
  }
}
