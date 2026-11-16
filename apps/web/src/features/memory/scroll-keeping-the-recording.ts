/**
 * Where the meeting scroll should be so a recording that is already playing
 * stays on screen when the summary is inserted above it.
 */
export function scrollKeepingTheRecording(
  scrollTop: number,
  beforeTop: number | undefined,
  afterTop: number,
  playing: boolean,
): number {
  if (!playing || beforeTop === undefined) return scrollTop;
  return scrollTop + (afterTop - beforeTop);
}
