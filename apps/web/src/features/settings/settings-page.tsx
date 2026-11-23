import {
  AiChipIcon,
  Idea01Icon,
  Key01Icon,
  KeyboardIcon,
  LanguageSkillIcon,
  LaptopIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/use-translation";

import { SaveDiagnosticsButton } from "./save-diagnostics-button";
import { settingsMessages } from "./settings.messages";

/** Settings is a page in the Space shell: its own sections beside the rail. */
export function SettingsLayout() {
  const { pathname } = useLocation();
  const t = useT();
  const sections = useRef<HTMLElement>(null);
  // In a narrow window the sections scroll sideways; the open one stays in view.
  useEffect(() => {
    sections.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside
        aria-label={t(settingsMessages.navigation)}
        className="flex shrink-0 flex-col border-b border-border px-3 py-4 md:w-[228px] md:border-r md:border-b-0"
      >
        <div className="flex items-center pt-0.5 pb-3.5">
          <p className="text-lg font-medium text-foreground">
            {t(settingsMessages.title)}
          </p>
        </div>
        <nav
          aria-label={t(settingsMessages.sections)}
          className="workspace-scrollbar flex min-h-0 flex-1 gap-0.5 overflow-x-auto md:flex-col md:overflow-x-visible md:overflow-y-auto"
          ref={sections}
        >
          <SettingsLink
            icon={<Icon icon={UserIcon} size={14} />}
            label={t(settingsMessages.profile)}
            to="account"
          />
          <SettingsLink
            icon={<Icon icon={Key01Icon} size={14} />}
            label={t(settingsMessages.security)}
            to="security"
          />
          <SettingsLink
            icon={<Icon icon={Idea01Icon} size={14} />}
            label="My Rules"
            to="my-rules"
          />
          <SettingsLink
            icon={<Icon icon={KeyboardIcon} size={14} />}
            label="Shortcuts"
            to="shortcuts"
          />
          <SettingsLink
            icon={<Icon icon={LaptopIcon} size={14} />}
            label={t(settingsMessages.computers)}
            to="computers"
          />
          <SettingsLink
            icon={<Icon icon={AiChipIcon} size={14} />}
            label={t(settingsMessages.models)}
            to="models"
          />
          <SettingsLink
            icon={<Icon icon={LanguageSkillIcon} size={14} />}
            label={t(settingsMessages.language)}
            to="language"
          />
        </nav>
        <SaveDiagnosticsButton />
      </aside>
      <main className="workspace-content-viewport workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 py-6 [scrollbar-gutter:stable] md:px-8">
        <Suspense
          fallback={
            <SettingsSectionLoading
              computers={pathname.endsWith("/settings/computers")}
            />
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

function SettingsSectionLoading({ computers }: { computers: boolean }) {
  const t = useT();
  const label = t(
    computers
      ? settingsMessages.loadingComputers
      : settingsMessages.loadingContent,
  );
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className="mx-auto w-full max-w-(--app-settings-width) space-y-4"
      role="status"
    >
      <span className="sr-only">{label}...</span>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function SettingsLink({
  icon,
  label,
  to,
}: {
  icon: ReactNode;
  label: string;
  to: string;
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        `flex h-[33px] shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
          isActive
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`
      }
      to={to}
    >
      {icon}
      {label}
    </NavLink>
  );
}
