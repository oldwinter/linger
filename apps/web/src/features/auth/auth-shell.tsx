import type { ReactNode } from "react";

import { BrandMark } from "@/components/ui/brand-mark";

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
      <header className="auth-brand" aria-label="Linger">
        <BrandMark decorative />
        <strong className="auth-brand-name">Linger</strong>
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
