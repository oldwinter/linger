import { Button } from "@/components/ui/button";

/**
 * Floats over the timeline once the "New messages" divider leaves the viewport.
 * The wrapper carries the positioning because Button already owns `relative`.
 */
export function RoomUnreadJump({ onJump }: { onJump: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <Button
        className="pointer-events-auto shadow-md"
        onClick={onJump}
        size="compact"
        tone="subtle"
      >
        Jump to new messages
      </Button>
    </div>
  );
}
