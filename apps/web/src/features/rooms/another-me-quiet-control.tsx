import { NotificationBlock01Icon } from "@hugeicons/core-free-icons";

import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";

import { useAnotherMeQuiet } from "./another-me-quiet";
import { roomListMessages as m } from "./room-list.messages";

/** Holds Another Me's system reminders on this computer, without changing the Chat. */
export function QuietRemindersControl({
  accountId,
  variant,
}: {
  accountId: string;
  variant: "settings" | "toolbar";
}) {
  const t = useT();
  const quiet = useAnotherMeQuiet(accountId);
  if (variant === "toolbar") {
    return (
      <ActionMenu
        buttonClassName={`xs-nav-btn${quiet.until ? " text-app-ink" : ""}`}
        items={[
          { label: t(m.quietForHour), onSelect: quiet.quietForHour },
          { label: t(m.quietUntilMorning), onSelect: quiet.quietUntilMorning },
          ...(quiet.until
            ? [
                {
                  label: t(m.endQuiet),
                  onSelect: quiet.endQuiet,
                  separatorBefore: true,
                },
              ]
            : []),
        ]}
        label={quiet.label ?? t(m.quietReminders)}
        placement="bottom-start"
        trigger={<Icon icon={NotificationBlock01Icon} size={16} />}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {quiet.label ?? t(m.quietRemindersHint)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={quiet.quietForHour} size="compact" tone="secondary">
          {t(m.quietForHour)}
        </Button>
        <Button
          onClick={quiet.quietUntilMorning}
          size="compact"
          tone="secondary"
        >
          {t(m.quietUntilMorning)}
        </Button>
        {quiet.until ? (
          <Button onClick={quiet.endQuiet} size="compact" tone="ghost">
            {t(m.endQuiet)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
