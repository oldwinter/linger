import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { personalProfileQueryOptions } from "@/features/settings/personal-profile-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import {
  memoryChanges,
  previousRememberedRevision,
  type MemoryChange,
} from "./remembered-changes";
import { wikiSubpagesMessages as m } from "./wiki-subpages.messages";

/** How the profile Another Me keeps differs from the previous revision. */
export function RememberedPage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const profile = useQuery(personalProfileQueryOptions(client, tenantId));
  const current = profile.data?.current;
  const previous = profile.data
    ? previousRememberedRevision(profile.data)
    : undefined;
  const changes = current
    ? memoryChanges(current.profile, previous?.profile)
    : [];
  const sections = groupChanges(changes);

  return (
    <LibrarySubpageShell
      backLabel={t(m.backToProfile)}
      backTo={`/t/${encodeURIComponent(tenantId)}/library/wiki`}
      subtitle={t(m.rememberedSubtitle)}
      title={t(m.rememberedTitle)}
    >
      {profile.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.loadingRemembered)}
        </p>
      ) : profile.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">
            {t(m.rememberedLoadFailed)}
          </p>
          <Button
            onClick={() => void profile.refetch()}
            size="compact"
            tone="secondary"
          >
            {t(commonMessages.retry)}
          </Button>
        </div>
      ) : !current ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.noProfileYet)}
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground" role="status">
            {previous
              ? changes.length
                ? t(m.changesSincePrevious, { count: changes.length })
                : t(m.nothingChanged)
              : t(m.firstProfile)}
          </p>
          {sections.map(([section, items]) => (
            <section aria-labelledby={sectionId(section)} key={section}>
              <h2
                className="text-sm font-medium text-foreground"
                id={sectionId(section)}
              >
                {section}
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {items.map((change) => (
                  <li
                    className="rounded-2xl border border-border bg-card px-4 py-3 shadow-xs"
                    key={`${change.kind}-${change.label}`}
                  >
                    <p className="text-sm font-medium text-foreground">
                      {change.kind === "added"
                        ? t(m.addedLabel, { label: change.label })
                        : change.kind === "removed"
                          ? t(m.removedLabel, { label: change.label })
                          : change.label}
                    </p>
                    {change.after ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                        {change.before
                          ? t(m.nowValue, { value: change.after })
                          : change.after}
                      </p>
                    ) : null}
                    {change.before ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                        {change.after
                          ? t(m.beforeValue, { value: change.before })
                          : change.before}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </LibrarySubpageShell>
  );
}

function groupChanges(changes: readonly MemoryChange[]) {
  const groups: Array<[string, MemoryChange[]]> = [];
  for (const change of changes) {
    const last = groups.at(-1);
    if (last && last[0] === change.section) last[1].push(change);
    else groups.push([change.section, [change]]);
  }
  return groups;
}

function sectionId(section: string) {
  return `remembered-${section.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
}
