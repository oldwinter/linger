import { Button } from "@/components/ui/button";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { composerMessages } from "./composer.messages";

interface RoomChatComposerNoticesProps {
  agentDirectoryError: boolean;
  onRetryAgents: () => void;
}

export function RoomChatComposerNotices({
  agentDirectoryError,
  onRetryAgents,
}: RoomChatComposerNoticesProps) {
  const t = useT();
  return agentDirectoryError ? (
    <div
      className="room-readable mt-1.5 flex items-center justify-between gap-3 px-1 text-xs text-app-muted"
      role="alert"
    >
      <span>{t(composerMessages.agentsUnavailable)}</span>
      <Button onClick={onRetryAgents} size="compact" tone="secondary">
        {t(commonMessages.retry)}
      </Button>
    </div>
  ) : null;
}
