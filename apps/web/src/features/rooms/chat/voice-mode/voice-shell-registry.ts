/**
 * Minimal shell registration slot shared between RoomShell and the lazy Voice
 * Mode UI bridge so registering shell actions keeps DOM scraping off the
 * initial bundle.
 */

export interface VoiceShell {
  navigate: (path: string) => void;
  openSearch: (query: string) => void;
  back: () => void;
  /** Whether a route change is still loading (lazy routes commit late). */
  navigating: () => boolean;
}

let shell: VoiceShell | undefined;

export function registerVoiceShell(next: VoiceShell) {
  shell = next;
  return () => {
    if (shell === next) shell = undefined;
  };
}

export function getVoiceShell(): VoiceShell | undefined {
  return shell;
}

export function resetVoiceShellForTest() {
  shell = undefined;
}
