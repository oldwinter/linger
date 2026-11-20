import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { personalProfileQueryOptions } from "@/features/settings/personal-profile-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import {
  memoryChanges,
  previousRememberedRevision,
  type MemoryChange,
} from "./remembered-changes";

/** How the profile Another Me keeps differs from the previous revision. */
export function RememberedPage() {
  const { client } = useTeamHubRuntime();
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
      backLabel="Back to Profile"
      backTo={`/t/${encodeURIComponent(tenantId)}/library/wiki`}
      subtitle="The current profile beside the previous one, so you can see what changed."
      title="What Another Me remembers"
    >
      {profile.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading what Another Me remembers.
        </p>
      ) : profile.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">
            Could not load what Another Me remembers.
          </p>
          <Button
            onClick={() => void profile.refetch()}
            size="compact"
            tone="secondary"
          >
            Retry
          </Button>
        </div>
      ) : !current ? (
        <p className="text-sm text-muted-foreground" role="status">
          Another Me has not written a profile yet.
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground" role="status">
            {previous
              ? changes.length
                ? `${changes.length} ${changes.length === 1 ? "change" : "changes"} since the previous profile.`
                : "Nothing has changed since the previous profile."
              : "This is the first profile Another Me has written."}
          </p>
          {sections.map(([section, items]) => (
            <section aria-labelledby={sectionId(section)} key={section}>
              <h2 className="text-sm text-foreground" id={sectionId(section)}>
                {section}
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {items.map((change) => (
                  <li
                    className="rounded-2xl border border-border px-4 py-3"
                    key={`${change.kind}-${change.label}`}
                  >
                    <p className="text-sm font-medium text-foreground">
                      {change.kind === "added"
                        ? `Added ${change.label}`
                        : change.kind === "removed"
                          ? `Removed ${change.label}`
                          : change.label}
                    </p>
                    {change.after ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                        {change.before ? `Now: ${change.after}` : change.after}
                      </p>
                    ) : null}
                    {change.before ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                        {change.after
                          ? `Before: ${change.before}`
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
