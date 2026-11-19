import { Cancel01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import { ActorAvatar } from "./members/actor-avatar";
import type { AnotherMeArrival } from "./another-me-arrived";

/** Another Me's new words, sitting where the person already is. */
export function AnotherMeArrivedBanner({
  arrival,
  onDismiss,
  onOpen,
}: {
  arrival: AnotherMeArrival;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  return (
    <aside
      aria-label="Another Me arrived"
      className="fixed right-6 bottom-6 z-20 flex w-[min(20rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-border bg-card p-3 shadow-lg max-md:top-4 max-md:right-4 max-md:bottom-auto"
    >
      <ActorAvatar
        actorId={arrival.actorId}
        kind="agent"
        name={arrival.name}
        size="sm"
      />
      <div className="min-w-0 flex-1" role="status" aria-live="polite">
        <p className="truncate text-sm font-medium text-foreground">
          {arrival.name}
        </p>
        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
          {arrival.text}
        </p>
        <Button className="mt-2" onClick={onOpen} size="compact" type="button">
          Open
        </Button>
      </div>
      <button
        aria-label="Dismiss"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onDismiss}
        type="button"
      >
        <Icon icon={Cancel01Icon} size={14} />
      </button>
    </aside>
  );
}
