import { NotificationBlock01Icon } from "@hugeicons/core-free-icons";

import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import { useAnotherMeQuiet } from "./another-me-quiet";

/** Holds Another Me's system reminders on this computer, without changing the Chat. */
export function QuietRemindersControl({
  accountId,
  variant,
}: {
  accountId: string;
  variant: "settings" | "toolbar";
}) {
  const quiet = useAnotherMeQuiet(accountId);
  if (variant === "toolbar") {
    return (
      <ActionMenu
        buttonClassName={`xs-nav-btn${quiet.until ? " text-app-ink" : ""}`}
        items={[
          { label: "Quiet for an hour", onSelect: quiet.quietForHour },
          { label: "Quiet until morning", onSelect: quiet.quietUntilMorning },
          ...(quiet.until
            ? [
                {
                  label: "End quiet",
                  onSelect: quiet.endQuiet,
                  separatorBefore: true,
                },
              ]
            : []),
        ]}
        label={quiet.label ?? "Quiet reminders"}
        placement="bottom-start"
        trigger={<Icon icon={NotificationBlock01Icon} size={16} />}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {quiet.label ??
          "Another Me still writes in its Chat. This only holds the system reminder on this computer."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={quiet.quietForHour} size="compact" tone="secondary">
          Quiet for an hour
        </Button>
        <Button
          onClick={quiet.quietUntilMorning}
          size="compact"
          tone="secondary"
        >
          Quiet until morning
        </Button>
        {quiet.until ? (
          <Button onClick={quiet.endQuiet} size="compact" tone="ghost">
            End quiet
          </Button>
        ) : null}
      </div>
    </div>
  );
}
