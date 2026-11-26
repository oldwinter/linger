import { useState, type ReactNode } from "react";

import { LANGUAGES, setLanguage, type Language } from "@/i18n/language";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { authMessages as m } from "./auth.messages";
import { AuthIllustration } from "./auth-illustration";

export function AuthShell({
  children,
  subtitle,
  title,
}: {
  children: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <main className="auth-page min-h-dvh text-foreground">
      <header className="auth-brand">
        <img
          alt="Linger"
          className="auth-brand-wordmark"
          draggable={false}
          height={386}
          src="/linger-wordmark.svg"
          width={1225}
        />
        <AuthLanguageSwitcher />
      </header>

      <div className="auth-stage">
        <div aria-hidden="true" className="auth-illustration">
          <AuthIllustration />
        </div>

        <section aria-labelledby="auth-title" className="auth-panel">
          <div className="auth-heading">
            <h1 className="auth-title" id="auth-title">
              {title}
            </h1>
            <p className="auth-subtitle">{subtitle}</p>
          </div>
          {children}
        </section>
      </div>

      <footer className="auth-footer">&copy; 2026 Linger</footer>
    </main>
  );
}

function AuthLanguageSwitcher() {
  const { language, t } = useTranslation();
  const [switching, setSwitching] = useState(false);

  function choose(next: Language) {
    if (next === language || switching) return;
    setSwitching(true);
    void setLanguage(next)
      .catch(() => undefined)
      .finally(() => setSwitching(false));
  }

  return (
    <div
      aria-label={t(m.language)}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-card/90 p-0.5 text-xs backdrop-blur-sm"
      role="group"
    >
      {LANGUAGES.map(({ name, tag }) => {
        const active = language === tag;
        return (
          <button
            aria-pressed={active}
            className={cn(
              "min-h-8 rounded-full px-2.5 py-1 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
            disabled={switching}
            key={tag}
            lang={tag}
            onClick={() => choose(tag)}
            type="button"
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
