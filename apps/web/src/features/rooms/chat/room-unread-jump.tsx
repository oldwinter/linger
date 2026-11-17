import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Floats over the timeline once the "New messages" divider leaves the viewport.
 * The wrapper carries the positioning because Button already owns `relative`.
 */
export function RoomUnreadJump({
  aboveLatest = false,
  onJump,
}: {
  aboveLatest?: boolean;
  onJump: () => void;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 flex justify-center",
        aboveLatest ? "bottom-14" : "bottom-3",
      )}
    >
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
