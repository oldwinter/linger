import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { isShortcutKeyEvent } from "@/lib/keyboard-shortcut";

import type { LifeChapter } from "./life-telling";

/** One chapter of the life at a time, from the earliest year. */
export function LifeTellingView({
  chapters,
}: {
  chapters: readonly LifeChapter[];
}) {
  const [step, setStep] = useState(0);
  const lastIndex = Math.max(chapters.length - 1, 0);
  const index = Math.min(step, lastIndex);
  const chapter = chapters[index];
  const last = chapters.length > 0 && index === lastIndex;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isShortcutKeyEvent(event)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setStep((current) => {
        const at = Math.min(current, lastIndex);
        if (event.key === "ArrowLeft") return Math.max(0, at - 1);
        return Math.min(lastIndex, at + 1);
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lastIndex]);

  if (!chapter) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Another Me has not written a life yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <article aria-label="Life chapter" className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{chapter.period}</p>
        <p className="text-xl text-foreground">{chapter.sentence}</p>
      </article>
      <p className="text-sm text-muted-foreground" role="status">
        {last
          ? "That's the life Another Me would tell."
          : `Chapter ${index + 1} of ${chapters.length}`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={index === 0}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          tone="secondary"
          type="button"
        >
          Earlier chapter
        </Button>
        <Button
          disabled={last}
          onClick={() => setStep((current) => Math.min(lastIndex, current + 1))}
          tone="secondary"
          type="button"
        >
          Later chapter
        </Button>
      </div>
    </div>
  );
}
