import { useLayoutEffect, useRef, useState } from "react";

/**
 * An underline that slides to the selected tab, inset like the tab's label.
 * The tab row must be positioned; no selection hides the underline.
 */
export function useTabIndicator<K>(selected: K | undefined) {
  const tabs = useRef(new Map<K, HTMLElement>());
  const [position, setPosition] = useState<{ left: number; width: number }>();
  useLayoutEffect(() => {
    const tab = selected === undefined ? undefined : tabs.current.get(selected);
    if (!tab) {
      setPosition(undefined);
      return;
    }
    const measure = () => {
      const next = { left: tab.offsetLeft + 12, width: tab.offsetWidth - 24 };
      setPosition((current) =>
        current?.left === next.left && current?.width === next.width
          ? current
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(tab);
    if (tab.parentElement) observer.observe(tab.parentElement);
    return () => observer.disconnect();
  }, [selected]);
  return {
    tabRef: (key: K) => (node: HTMLElement | null) => {
      if (node) tabs.current.set(key, node);
      else tabs.current.delete(key);
    },
    indicator: position ? (
      <span
        aria-hidden="true"
        className="workspace-tab-indicator"
        style={position}
      />
    ) : null,
  };
}
