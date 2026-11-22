import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HeadlessMantineProvider, Spoiler } from "@mantine/core";
import { useState } from "react";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { MessageMarkdown } from "../../chat/message-markdown";
import { runtimeStatusMessages as m } from "../../runtime-status/runtime-status.messages";

/** About four lines of message text. */
const FOLDED_HEIGHT = 110;

/**
 * A brief or follow-up sent to a Task, on the right like a Room message. A
 * long one folds to its first few lines so the AlterEgo's work stays in view.
 */
export function TaskInputBubble({
  authorKind,
  body,
}: {
  authorKind: "agent" | "human";
  body: string;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex justify-end">
      {/* The bubble's own max-width outranks a width utility on it. */}
      <div className="min-w-0 max-w-[85%]">
        <div className="room-message-bubble">
          {/* Spoiler owns measurement, resize updates and the toggle's ARIA. */}
          <HeadlessMantineProvider>
            <Spoiler
              className="group/fold flex min-w-0 flex-col items-start [--mantine-scale:1]"
              classNames={{
                content: cn(
                  "order-first w-full overflow-hidden",
                  !expanded &&
                    "group-data-[has-spoiler]/fold:[mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]",
                ),
                control:
                  "-mx-1 mt-1 inline-flex items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              }}
              expanded={expanded}
              hideLabel={
                <>
                  {t(m.showLess)}
                  <Icon
                    className="rotate-180"
                    icon={ArrowDown01Icon}
                    size={14}
                  />
                </>
              }
              maxHeight={FOLDED_HEIGHT}
              onExpandedChange={setExpanded}
              showLabel={
                <>
                  {t(m.showMore)}
                  <Icon icon={ArrowDown01Icon} size={14} />
                </>
              }
            >
              <MessageMarkdown authorKind={authorKind} body={body} />
            </Spoiler>
          </HeadlessMantineProvider>
        </div>
      </div>
    </div>
  );
}
