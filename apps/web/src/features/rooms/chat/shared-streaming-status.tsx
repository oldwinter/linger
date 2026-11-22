import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

type StatusSurface = "chat" | "thread";
type StatusTargets = Record<StatusSurface, HTMLDivElement | null>;

const StreamingStatusContext = createContext<{
  active: Record<StatusSurface, boolean>;
  setActive: (surface: StatusSurface, value: boolean) => void;
  targets: StatusTargets;
  refs: Record<StatusSurface, (node: HTMLDivElement | null) => void>;
} | null>(null);

export function SharedStreamingStatusProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [chat, setChat] = useState<HTMLDivElement | null>(null);
  const [thread, setThread] = useState<HTMLDivElement | null>(null);
  const [active, setActiveState] = useState<Record<StatusSurface, boolean>>({
    chat: false,
    thread: false,
  });
  const setActive = useCallback((surface: StatusSurface, next: boolean) => {
    setActiveState((current) =>
      current[surface] === next ? current : { ...current, [surface]: next },
    );
  }, []);
  const value = useMemo(
    () => ({
      active,
      setActive,
      targets: { chat, thread },
      refs: { chat: setChat, thread: setThread },
    }),
    [active, chat, setActive, thread],
  );
  return (
    <StreamingStatusContext value={value}>{children}</StreamingStatusContext>
  );
}

/**
 * Mirrors each source's status in both composers; subscriptions, Stop and
 * navigation stay with the source. A Run shows its status in one Room or
 * Thread only, so the two sources never show the same Run.
 */
export function SharedStreamingStatus({
  active,
  children,
  surface,
}: {
  /** Whether this source currently renders a status dock. */
  active?: boolean;
  children: ReactNode;
  surface: StatusSurface;
}) {
  const shared = useContext(StreamingStatusContext);
  const setActive = shared?.setActive;
  useEffect(() => {
    if (!setActive || active === undefined) return;
    setActive(surface, active);
    return () => setActive(surface, false);
  }, [active, setActive, surface]);
  if (!shared) return children;
  return (
    <>
      <div ref={shared.refs[surface]} data-streaming-surface={surface} />
      {Object.entries(shared.targets).map(([key, target]) =>
        target ? createPortal(children, target, `${surface}:${key}`) : null,
      )}
    </>
  );
}

/** True while either the Room or Thread streaming dock is visible. */
export function useSharedStreamingStatusActive(): boolean {
  const shared = useContext(StreamingStatusContext);
  return Boolean(shared?.active.chat || shared?.active.thread);
}
