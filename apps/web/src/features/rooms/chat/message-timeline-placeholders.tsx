import { Message01Icon } from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n/use-translation";

import { chatMessages } from "./chat.messages";

/** Invites the first Message in a Room that has none. */
export function MessageTimelineEmptyState() {
  const t = useT();
  return (
    <div className="text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-lg bg-app-rail text-app-muted">
        <Icon icon={Message01Icon} size={20} />
      </span>
      <h2 className="mt-4 text-base font-semibold">
        {t(chatMessages.emptyTimelineTitle)}
      </h2>
      <p className="mt-1 text-sm text-app-muted">
        {t(chatMessages.emptyTimelineBody)}
      </p>
    </div>
  );
}

export function LoadingOlderMessages() {
  const t = useT();
  return (
    <div
      aria-label={t(chatMessages.loadingEarlierMessages)}
      className="mb-5 flex justify-center text-app-muted"
      role="status"
    >
      <Spinner />
    </div>
  );
}
