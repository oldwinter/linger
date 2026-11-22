import { AiSparklesIcon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import {
  INKLING_2_MINI_ANNOUNCEMENT_URL,
  INKLING_2_MINI_HF_URL,
} from "@linger/service-kit/featured-models";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";

import { localModelsMessages as m } from "./local-models.messages";

const INKLING_TITLE = "Inkling 2 Mini";

/**
 * Editorial partner frame for Thinking Machines' Inkling 2 Mini at the top of
 * the local model library. Wraps the matching `ModelRow` when present so
 * status, progress, details and actions stay in one place, and falls back to a
 * partner highlight when the Computer's catalog does not include it.
 */
export function FeaturedModelSpotlight({ children }: { children?: ReactNode }) {
  const t = useT();
  const hasEntry = Boolean(children);

  return (
    <section
      aria-label={t(m.featuredSpotlightRegion)}
      className="rounded-xl border border-[var(--app-card-info-border)] bg-[var(--app-card-info-surface)] p-3.5"
      data-featured-spotlight="inkling-2-mini"
      data-in-catalog={hasEntry ? "true" : "false"}
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {!hasEntry ? (
            <span
              aria-hidden
              className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--app-mention-surface)] text-app-info shadow-outline"
            >
              <Icon icon={AiSparklesIcon} size={20} />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full bg-[var(--app-mention-surface)] px-2 py-0.5 text-2xs font-semibold tracking-wide text-app-info uppercase">
                {t(m.featuredNew)}
              </span>
              <span className="font-medium text-app-info">
                {t(m.featuredByThinkingMachines)}
              </span>
            </div>
            {!hasEntry ? (
              <h2 className="mt-1 text-base font-semibold text-foreground">
                {INKLING_TITLE}
              </h2>
            ) : null}
            <p className="mt-1 text-sm text-muted-foreground">
              {t(m.featuredInklingSummary)}
            </p>
            {!hasEntry ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t(m.featuredNotInCatalog)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:pt-0.5">
          <a
            className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border-hover underline-offset-2 transition-colors hover:text-app-info hover:decoration-app-info"
            href={INKLING_2_MINI_ANNOUNCEMENT_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>{t(m.featuredReadAnnouncement)}</span>
            <Icon className="shrink-0" icon={LinkSquare02Icon} size={14} />
          </a>
          <a
            className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border-hover underline-offset-2 transition-colors hover:text-app-info hover:decoration-app-info"
            href={INKLING_2_MINI_HF_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>{t(m.featuredHuggingFace)}</span>
            <Icon className="shrink-0" icon={LinkSquare02Icon} size={14} />
          </a>
        </div>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}
