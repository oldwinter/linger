import type { ReactNode } from "react";

import { RichMessage, useT } from "@/i18n/use-translation";

import { connectorMessages as m } from "./connectors.messages";

const COMPOSIO_KEYS_URL =
  "https://dashboard.composio.dev/~/project/settings/api-keys";

/** Where a provider's API key comes from, shown above the form that saves it. */
export function ProviderKeyGuide({
  href,
  note,
  steps,
}: {
  href: string;
  note?: string;
  steps: ReactNode;
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-app-border bg-app-surface-soft p-4">
      <p className="font-medium text-foreground">{t(m.getYourApiKey)}</p>
      <div className="mt-1.5 leading-5 text-muted-foreground">{steps}</div>
      {note ? <p className="mt-2 leading-5 text-foreground">{note}</p> : null}
      <a
        className="mt-2 inline-flex font-medium text-app-link hover:underline"
        href={href}
        rel="noopener noreferrer"
        target="_blank"
      >
        {t(m.getAKey)} <span aria-hidden="true">↗</span>
      </a>
    </div>
  );
}

export function ComposioKeyGuide() {
  const t = useT();
  return (
    <ProviderKeyGuide
      href={COMPOSIO_KEYS_URL}
      note={t(m.composioKeyNote)}
      steps={
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>{t(m.composioStepOpen)}</li>
          <li>
            <RichMessage
              message={m.composioStepCreate}
              tags={{ strong: (text) => <strong>{text}</strong> }}
            />
          </li>
          <li>{t(m.composioStepPaste)}</li>
          <li>{t(m.composioStepReturn)}</li>
        </ol>
      }
    />
  );
}
