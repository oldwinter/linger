import {
  CloudServerIcon,
  ComputerTerminal01Icon,
  Folder01Icon,
  Layers01Icon,
  LaptopIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { herdrCoreMessages as m } from "./herdr-core.messages";
import { HerdrCoreStatusPill } from "./status-pill";
import {
  buildTerminalTree,
  extractMachineName,
  flattenTerminalTree,
  groupTerminalsBySpace,
  terminalCurrentCwd,
  terminalDisplayName,
  type TerminalFilterCriteria,
  type TerminalTreeNode,
} from "./tree";
import type {
  HerdrAppParsedDoc,
  HerdrCoreMachine,
  HerdrCoreTerminal,
} from "./types";

interface TerminalSidebarListProps {
  readonly terminals: readonly HerdrCoreTerminal[];
  readonly machines: readonly HerdrCoreMachine[];
  readonly herdrAppDoc: HerdrAppParsedDoc;
  readonly filters: TerminalFilterCriteria;
  readonly groupBySpace: boolean;
  readonly selectedAddress: string | null;
  readonly roomId?: string;
  readonly syncingAddress?: string | null;
  readonly onFiltersChange: (patch: Partial<TerminalFilterCriteria>) => void;
  readonly onGroupBySpaceChange: (value: boolean) => void;
  readonly onSelect: (address: string) => void;
  readonly onSyncToSpace: (
    terminal: HerdrCoreTerminal,
    spaceName: string,
  ) => Promise<void> | void;
}

export function TerminalSidebarList({
  terminals,
  machines,
  herdrAppDoc,
  filters,
  groupBySpace,
  selectedAddress,
  roomId,
  syncingAddress,
  onFiltersChange,
  onGroupBySpaceChange,
  onSelect,
  onSyncToSpace,
}: TerminalSidebarListProps) {
  const t = useT();
  const [adoptingAddress, setAdoptingAddress] = useState<string | null>(null);
  const [spaceInput, setSpaceInput] = useState("");

  const treeNodes = buildTerminalTree(terminals);
  const flatNodes = flattenTerminalTree(treeNodes);
  const spaceGroups = groupBySpace
    ? groupTerminalsBySpace(terminals, herdrAppDoc)
    : null;

  function openAdopt(terminal: HerdrCoreTerminal) {
    setAdoptingAddress(terminal.address);
    setSpaceInput(
      terminal.labels["herdr.space"] ?? herdrAppDoc.spaces[0]?.name ?? "",
    );
  }

  function submitAdopt(
    event: FormEvent<HTMLFormElement>,
    terminal: HerdrCoreTerminal,
  ) {
    event.preventDefault();
    const target = spaceInput.trim();
    if (!target) return;
    void Promise.resolve(onSyncToSpace(terminal, target)).finally(() => {
      setAdoptingAddress(null);
      setSpaceInput("");
    });
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="herdr-terminal-list"
    >
      {/* Machine filter bar */}
      <div
        aria-label={t(m.launchMachineLabel)}
        className="flex flex-wrap items-center gap-1"
        role="group"
      >
        <MachineFilterChip
          active={filters.machine === "all"}
          label={t(m.allMachines)}
          onClick={() => onFiltersChange({ machine: "all" })}
        />
        <MachineFilterChip
          active={filters.machine === "local"}
          icon={LaptopIcon}
          label={t(m.localMachine)}
          onClick={() => onFiltersChange({ machine: "local" })}
        />
        {machines.map((machine) => (
          <MachineFilterChip
            active={filters.machine === machine.name}
            icon={CloudServerIcon}
            key={machine.name}
            label={machine.name}
            offline={machine.connected === false}
            needsLogin={Boolean(machine.needs_login)}
            onClick={() => onFiltersChange({ machine: machine.name })}
          />
        ))}
      </div>

      {/* Search + scope filters */}
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <Icon
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            icon={Search01Icon}
            size={14}
          />
          <input
            aria-label={t(m.searchPlaceholder)}
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-2.5 text-xs text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) =>
              onFiltersChange({ search: event.target.value })
            }
            placeholder={t(m.searchPlaceholder)}
            type="search"
            value={filters.search}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {roomId ? (
            <button
              aria-pressed={filters.roomOnly}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                filters.roomOnly
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onFiltersChange({ roomOnly: !filters.roomOnly })}
              type="button"
            >
              {filters.roomOnly ? t(m.filterRoomOnly) : t(m.filterAllRooms)}
            </button>
          ) : null}

          <button
            aria-pressed={groupBySpace}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
              groupBySpace
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onGroupBySpaceChange(!groupBySpace)}
            type="button"
          >
            <Icon icon={Layers01Icon} size={12} />
            <span>{t(m.groupBySpace)}</span>
          </button>

          <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <input
              checked={filters.showFinished}
              className="size-3 rounded border-border"
              onChange={(event) =>
                onFiltersChange({ showFinished: event.target.checked })
              }
              type="checkbox"
            />
            <span>{t(m.showFinished)}</span>
          </label>
        </div>

        <input
          aria-label={t(m.filterWorkItemPlaceholder)}
          className="h-7 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) =>
            onFiltersChange({ workItemId: event.target.value })
          }
          placeholder={t(m.filterWorkItemPlaceholder)}
          type="text"
          value={filters.workItemId}
        />
      </div>

      {/* Terminal tree / space groups */}
      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto pr-0.5">
        {flatNodes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center">
            <p className="text-xs font-medium text-foreground">
              {t(m.emptyListTitle)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t(m.emptyListBody)}
            </p>
          </div>
        ) : spaceGroups ? (
          <div className="flex flex-col gap-3">
            {spaceGroups.map((group) => (
              <section
                aria-label={group.spaceName ?? t(m.unassignedSpace)}
                className="flex flex-col gap-1"
                key={group.spaceId ?? "__unassigned__"}
              >
                <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon icon={Layers01Icon} size={12} />
                  <span className="truncate">
                    {group.spaceName ?? t(m.unassignedSpace)}
                  </span>
                  <span className="tabular-nums opacity-70">
                    {flattenTerminalTree(group.nodes).length}
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {flattenTerminalTree(group.nodes).map((node) => (
                    <TerminalRowItem
                      adopting={adoptingAddress === node.terminal.address}
                      key={node.terminal.address}
                      node={node}
                      onCancelAdopt={() => setAdoptingAddress(null)}
                      onOpenAdopt={() => openAdopt(node.terminal)}
                      onSelect={() => onSelect(node.terminal.address)}
                      onSpaceInputChange={setSpaceInput}
                      onSubmitAdopt={(event) =>
                        submitAdopt(event, node.terminal)
                      }
                      selected={selectedAddress === node.terminal.address}
                      spaceInput={spaceInput}
                      syncing={syncingAddress === node.terminal.address}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {flatNodes.map((node) => (
              <TerminalRowItem
                adopting={adoptingAddress === node.terminal.address}
                key={node.terminal.address}
                node={node}
                onCancelAdopt={() => setAdoptingAddress(null)}
                onOpenAdopt={() => openAdopt(node.terminal)}
                onSelect={() => onSelect(node.terminal.address)}
                onSpaceInputChange={setSpaceInput}
                onSubmitAdopt={(event) => submitAdopt(event, node.terminal)}
                selected={selectedAddress === node.terminal.address}
                spaceInput={spaceInput}
                syncing={syncingAddress === node.terminal.address}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MachineFilterChip({
  active,
  icon,
  label,
  offline = false,
  needsLogin = false,
  onClick,
}: {
  readonly active: boolean;
  readonly icon?: typeof LaptopIcon;
  readonly label: string;
  readonly offline?: boolean;
  readonly needsLogin?: boolean;
  readonly onClick: () => void;
}) {
  const t = useT();
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {icon ? <Icon icon={icon} size={12} /> : null}
      <span>{label}</span>
      {needsLogin ? (
        <span className="text-[10px] text-[var(--app-status-warning-text)]">
          ({t(m.machineNeedsLogin)})
        </span>
      ) : offline ? (
        <span className="text-[10px] opacity-60">({t(m.machineOffline)})</span>
      ) : null}
    </button>
  );
}

function TerminalRowItem({
  node,
  selected,
  adopting,
  spaceInput,
  syncing,
  onSelect,
  onOpenAdopt,
  onCancelAdopt,
  onSpaceInputChange,
  onSubmitAdopt,
}: {
  readonly node: TerminalTreeNode;
  readonly selected: boolean;
  readonly adopting: boolean;
  readonly spaceInput: string;
  readonly syncing: boolean;
  readonly onSelect: () => void;
  readonly onOpenAdopt: () => void;
  readonly onCancelAdopt: () => void;
  readonly onSpaceInputChange: (value: string) => void;
  readonly onSubmitAdopt: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const t = useT();
  const { terminal, depth, descendantCount } = node;
  const isBlocked =
    terminal.state === "live" && terminal.status?.status === "blocked";
  const machine = extractMachineName(terminal.address);
  const cwd = terminalCurrentCwd(terminal);
  const spaceLabel = terminal.labels["herdr.space"];

  return (
    <li
      className={cn(
        "rounded-xl border transition-colors",
        selected
          ? "border-foreground/30 bg-muted/70 shadow-outline"
          : isBlocked
            ? "border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)]/40 hover:bg-[var(--app-status-warning-surface)]/70"
            : "border-border bg-card hover:bg-muted/40",
      )}
      data-herdr-address={terminal.address}
      data-herdr-depth={depth}
      style={
        depth > 0 ? { marginLeft: `${Math.min(depth, 4) * 14}px` } : undefined
      }
    >
      <button
        aria-current={selected ? "true" : undefined}
        className="flex w-full flex-col gap-1.5 p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
        type="button"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon
              className="shrink-0 text-muted-foreground"
              icon={ComputerTerminal01Icon}
              size={14}
            />
            <span className="truncate text-xs font-semibold text-foreground">
              {terminalDisplayName(terminal)}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {terminal.address}
            </span>
          </div>
          {machine !== "local" ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {machine}
            </span>
          ) : null}
        </div>

        <HerdrCoreStatusPill terminal={terminal} />

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {terminal.template ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
              {terminal.template}
            </span>
          ) : null}
          {cwd ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1 truncate font-mono text-[10px]">
              <Icon className="shrink-0" icon={Folder01Icon} size={11} />
              <span className="truncate">{cwd}</span>
            </span>
          ) : null}
          {descendantCount > 0 ? (
            <span className="text-[10px] font-medium text-foreground">
              {t(m.subAgentCount, { count: descendantCount })}
            </span>
          ) : null}
        </div>
      </button>

      <div className="flex flex-wrap items-center justify-between gap-1 border-t border-border/60 px-2.5 py-1">
        {adopting ? (
          <form
            className="flex w-full items-center gap-1"
            onSubmit={onSubmitAdopt}
          >
            <input
              aria-label={t(m.syncSpacePlaceholder)}
              className="h-6 min-w-0 flex-1 rounded border border-border bg-card px-1.5 text-[11px] text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(event) => onSpaceInputChange(event.target.value)}
              placeholder={t(m.syncSpacePlaceholder)}
              type="text"
              value={spaceInput}
            />
            <Button
              loading={syncing}
              size="compact"
              tone="primary"
              type="submit"
            >
              {t(m.syncSpaceConfirm)}
            </Button>
            <Button
              data-voice-close
              onClick={onCancelAdopt}
              size="compact"
              tone="ghost"
            >
              {t(m.launchCancel)}
            </Button>
          </form>
        ) : (
          <button
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onOpenAdopt}
            type="button"
          >
            <Icon icon={Layers01Icon} size={11} />
            <span>
              {spaceLabel
                ? t(m.syncedToSpace, { space: spaceLabel })
                : t(m.syncToSpace)}
            </span>
          </button>
        )}
      </div>
    </li>
  );
}
