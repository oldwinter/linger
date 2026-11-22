import { useRef, type KeyboardEvent } from "react";

import { useTabIndicator } from "@/components/ui/tab-indicator";
import { cn } from "@/lib/cn";

/** Page-level views as a row of tabs with a sliding underline. */
export function UnderlineTabs<K extends string>({
  className,
  items,
  label,
  onChange,
  value,
}: {
  className?: string;
  items: readonly { id: K; label: string }[];
  label: string;
  onChange: (id: K) => void;
  value: K;
}) {
  const { tabRef, indicator } = useTabIndicator(value);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasSelected = items.some((item) => item.id === value);

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (items.length === 0) return;
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % items.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const target = items[nextIndex];
    if (!target) return;
    buttonRefs.current[nextIndex]?.focus();
    onChange(target.id);
  }

  return (
    <div
      aria-label={label}
      className={cn(
        "workspace-file-tabs relative flex max-w-full gap-1 overflow-x-auto",
        className,
      )}
      role="tablist"
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        const bindIndicator = tabRef(item.id);
        return (
          <button
            aria-selected={selected}
            className="workspace-view-tab inline-flex h-9 shrink-0 items-center gap-1.5 px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            key={item.id}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(node) => {
              buttonRefs.current[index] = node;
              bindIndicator(node);
            }}
            role="tab"
            tabIndex={selected || (!hasSelected && index === 0) ? 0 : -1}
            type="button"
          >
            {item.label}
          </button>
        );
      })}
      {indicator}
    </div>
  );
}
