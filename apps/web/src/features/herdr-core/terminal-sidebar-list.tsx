import {
  Alert01Icon,
  ClipboardCopyIcon,
  CloudServerIcon,
  ComputerTerminal01Icon,
  FilterHorizontalIcon,
  Folder01Icon,
  LaptopIcon,
  Layers01Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useMemo, useState, type FormEvent } from "react";

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
  isMachineConnected,
  isMachineNeedsLogin,
  terminalCurrentCwd,
  terminalDisplayName,
  terminalStatusWord,
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
  readonly allTerminals?: readonly HerdrCoreTerminal[];
  readonly machines: readonly HerdrCoreMachine[];
  readonly herdrAppDoc: HerdrAppParsedDoc;
  readonly filters: TerminalFilterCriteria;
  readonly groupBySpace: boolean;
  readonly selectedAddress: string | null;
  readonly roomId?: string;
  readonly syncingAddress?: string | null;
  readonly quickKeyBusyAddress?: string | null;
  readonly onFiltersChange: (patch: Partial<TerminalFilterCriteria>) => void;
  readonly onGroupBySpaceChange: (value: boolean) => void;
  readonly onSelect: (address: string) => void;
  readonly onQuickKeys?: (
    terminal: HerdrCoreTerminal,
    keys: readonly string[],
  ) => Promise<void> | void;
  readonly onSyncToSpace: (
    terminal: HerdrCoreTerminal,
    spaceName: string,
  ) => Promise<void> | void;
}

function resolveSpaceLabel(
  terminal: HerdrCoreTerminal,
  doc: HerdrAppParsedDoc,
): string | null {
  const labelSpace = terminal.labels["herdr.space"]?.trim();
  if (labelSpace) {
    const matched = doc.spaces.find((s) => s.id === labelSpace);
    return matched?.name ?? labelSpace;
  }
  for (const space of doc.spaces) {
    if (space.tabs.some((tab) => tab.terminal === terminal.address)) {
      return space.name;
    }
  }
  return null;
}

export function TerminalSidebarList({
  terminals,
  allTerminals,
  machines,
  herdrAppDoc,
  filters,
  groupBySpace,
  selectedAddress,
  roomId,
  syncingAddress,
  quickKeyBusyAddress,
  onFiltersChange,
  onGroupBySpaceChange,
  onSelect,
  onQuickKeys,
  onSyncToSpace,
}: TerminalSidebarListProps) {
  const t = useT();
  const [adoptingAddress, setAdoptingAddress] = useState<string | null>(null);
  const [spaceInput, setSpaceInput] = useState("");
  const [showExtraFilters, setShowExtraFilters] = useState(
    Boolean(filters.workItemId.trim()),
  );
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const sourceList = allTerminals ?? terminals;
  const statusCounts = useMemo(() => {
    let blocked = 0;
    let working = 0;
    let error = 0;
    let liveTotal = 0;
    for (const term of sourceList) {
      if (term.state !== "live") continue;
      liveTotal += 1;
      const word = terminalStatusWord(term);
      if (word === "blocked") blocked += 1;
      else if (word === "working") working += 1;
      else if (word === "error") error += 1;
    }
    return { blocked, working, error, liveTotal };
  }, [sourceList]);

  const blockedVisible = useMemo(
    () =>
      terminals.filter(
        (term) =>
          term.state === "live" && terminalStatusWord(term) === "blocked",
      ),
    [terminals],
  );

  const treeNodes = useMemo(() => buildTerminalTree(terminals), [terminals]);
  const flatNodes = useMemo(() => flattenTerminalTree(treeNodes), [treeNodes]);
  const spaceGroups = useMemo(
    () => (groupBySpace ? groupTerminalsBySpace(terminals, herdrAppDoc) : null),
    [groupBySpace, herdrAppDoc, terminals],
  );

  function openAdopt(terminal: HerdrCoreTerminal) {
    setAdoptingAddress(terminal.address);
    setSpaceInput(
      resolveSpaceLabel(terminal, herdrAppDoc) ??
        herdrAppDoc.spaces[0]?.name ??
        "",
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

  function handleCopyAddress(address: string) {
    void navigator.clipboard?.writeText(address).then(() => {
      setCopiedAddress(address);
      window.setTimeout(() => {
        setCopiedAddress((prev) => (prev === address ? null : prev));
      }, 1_500);
    });
  }

  const hasRoomHiddenLive =
    Boolean(roomId) &&
    filters.roomOnly &&
    flatNodes.length === 0 &&
    statusCounts.liveTotal > 0;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="herdr-terminal-list"
    >
      {/* Machine filter bar (shown when remote machines exist or a remote filter is active) */}
      {machines.length > 0 || filters.machine !== "all" ? (
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
              needsLogin={isMachineNeedsLogin(machine)}
              offline={!isMachineConnected(machine)}
              onClick={() => onFiltersChange({ machine: machine.name })}
            />
          ))}
        </div>
      ) : null}

      {/* Search + status + scope filters */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Icon
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              icon={Search01Icon}
              size={13}
            />
            <input
              aria-label={t(m.searchPlaceholder)}
              className="h-8 w-full rounded-lg border border-border bg-card pl-7 pr-2 text-xs text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) =>
                onFiltersChange({ search: event.target.value })
              }
              placeholder={t(m.searchPlaceholder)}
              type="search"
              value={filters.search}
            />
          </div>
          <button
            aria-expanded={showExtraFilters}
            aria-label={t(m.moreFilters)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              showExtraFilters || filters.workItemId.trim()
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setShowExtraFilters((v) => !v)}
            title={t(m.moreFilters)}
            type="button"
          >
            <Icon icon={FilterHorizontalIcon} size={13} />
          </button>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap items-center gap-1" role="group">
          <StatusFilterChip
            active={filters.status === "all"}
            label={t(m.filterStatusAll)}
            onClick={() => onFiltersChange({ status: "all" })}
          />
          <StatusFilterChip
            active={filters.status === "blocked"}
            count={statusCounts.blocked}
            label={t(m.filterStatusBlocked)}
            onClick={() =>
              onFiltersChange({
                status: filters.status === "blocked" ? "all" : "blocked",
              })
            }
            tone={statusCounts.blocked > 0 ? "warning" : "neutral"}
          />
          <StatusFilterChip
            active={filters.status === "working"}
            count={statusCounts.working}
            label={t(m.filterStatusWorking)}
            onClick={() =>
              onFiltersChange({
                status: filters.status === "working" ? "all" : "working",
              })
            }
            tone={statusCounts.working > 0 ? "info" : "neutral"}
          />
          {statusCounts.error > 0 || filters.status === "error" ? (
            <StatusFilterChip
              active={filters.status === "error"}
              count={statusCounts.error}
              label={t(m.filterStatusError)}
              onClick={() =>
                onFiltersChange({
                  status: filters.status === "error" ? "all" : "error",
                })
              }
              tone="danger"
            />
          ) : null}
        </div>

        {/* Scope row */}
        <div className="flex flex-wrap items-center gap-1.5">
          {roomId ? (
            <button
              aria-pressed={filters.roomOnly}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              groupBySpace
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onGroupBySpaceChange(!groupBySpace)}
            type="button"
          >
            <Icon icon={Layers01Icon} size={11} />
            <span>{t(m.groupBySpace)}</span>
          </button>

          <label className="ml-auto flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
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

        {showExtraFilters ? (
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
        ) : null}
      </div>

      {/* Pinned Blocked Attention Strip for immediate 1-click approval */}
      {blockedVisible.length > 0 ? (
        <div
          className="flex flex-col gap-1.5 rounded-xl border border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)]/75 p-2"
          data-testid="herdr-pinned-blocked"
        >
          <div className="flex items-center gap-1 text-[11px] font-semibold text-[var(--app-status-warning-text)]">
            <Icon icon={Alert01Icon} size={12} />
            <span>{t(m.pinnedAttention)}</span>
            <span className="ml-auto tabular-nums">
              {blockedVisible.length}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {blockedVisible.map((term) => {
              const busy = quickKeyBusyAddress === term.address;
              return (
                <div
                  className="flex flex-col gap-1 rounded-lg border border-[var(--app-status-warning-border)] bg-card/90 p-1.5"
                  key={`pinned:${term.address}`}
                >
                  <button
                    className="flex min-w-0 items-center justify-between gap-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelect(term.address)}
                    type="button"
                  >
                    <span className="truncate font-semibold text-foreground">
                      {terminalDisplayName(term)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {term.address}
                    </span>
                  </button>
                  {term.status?.msg ? (
                    <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                      {term.status.msg}
                    </p>
                  ) : null}
                  {onQuickKeys ? (
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      <Button
                        aria-label={`${t(m.approveYes)} — ${terminalDisplayName(term)}`}
                        data-voice-risk="confirm"
                        disabled={busy}
                        onClick={() => void onQuickKeys(term, ["y", "enter"])}
                        size="compact"
                        tone="primary"
                      >
                        <span>{t(m.approveYes)}</span>
                      </Button>
                      <Button
                        aria-label={`Enter — ${terminalDisplayName(term)}`}
                        data-voice-risk="confirm"
                        disabled={busy}
                        onClick={() => void onQuickKeys(term, ["enter"])}
                        size="compact"
                        tone="secondary"
                      >
                        <span className="font-mono">Enter</span>
                      </Button>
                      <Button
                        aria-label={`Esc — ${terminalDisplayName(term)}`}
                        data-voice-risk="confirm"
                        disabled={busy}
                        onClick={() => void onQuickKeys(term, ["esc"])}
                        size="compact"
                        tone="ghost"
                      >
                        <span className="font-mono">Esc</span>
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Terminal tree / space groups */}
      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto pr-0.5">
        {flatNodes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-3 py-6 text-center">
            <p className="text-xs font-medium text-foreground">
              {t(m.emptyListTitle)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {hasRoomHiddenLive
                ? t(m.outsideRoomHint, { count: statusCounts.liveTotal })
                : t(m.emptyListBody)}
            </p>
            {hasRoomHiddenLive ? (
              <Button
                onClick={() => onFiltersChange({ roomOnly: false })}
                size="compact"
                tone="secondary"
              >
                {t(m.showAllTerminals)}
              </Button>
            ) : null}
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
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {flattenTerminalTree(group.nodes).map((node) => (
                    <TerminalRowItem
                      adopting={adoptingAddress === node.terminal.address}
                      copied={copiedAddress === node.terminal.address}
                      herdrAppDoc={herdrAppDoc}
                      key={node.terminal.address}
                      node={node}
                      onCancelAdopt={() => setAdoptingAddress(null)}
                      onCopyAddress={() =>
                        handleCopyAddress(node.terminal.address)
                      }
                      onOpenAdopt={() => openAdopt(node.terminal)}
                      onSelect={() => onSelect(node.terminal.address)}
                      onSpaceInputChange={setSpaceInput}
                      onSubmitAdopt={(event) =>
                        submitAdopt(event, node.terminal)
                      }
                      roomId={roomId}
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
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {flatNodes.map((node) => (
              <TerminalRowItem
                adopting={adoptingAddress === node.terminal.address}
                copied={copiedAddress === node.terminal.address}
                herdrAppDoc={herdrAppDoc}
                key={node.terminal.address}
                node={node}
                onCancelAdopt={() => setAdoptingAddress(null)}
                onCopyAddress={() => handleCopyAddress(node.terminal.address)}
                onOpenAdopt={() => openAdopt(node.terminal)}
                onSelect={() => onSelect(node.terminal.address)}
                onSpaceInputChange={setSpaceInput}
                onSubmitAdopt={(event) => submitAdopt(event, node.terminal)}
                roomId={roomId}
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

function StatusFilterChip({
  active,
  count,
  label,
  tone = "neutral",
  onClick,
}: {
  readonly active: boolean;
  readonly count?: number;
  readonly label: string;
  readonly tone?: "neutral" | "info" | "warning" | "danger";
  readonly onClick: () => void;
}) {
  const inactiveTone =
    tone === "warning"
      ? "border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)]/50 text-[var(--app-status-warning-text)]"
      : tone === "danger"
        ? "border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)]/50 text-[var(--app-status-danger-text)]"
        : tone === "info"
          ? "border-[var(--app-card-info-border)] bg-[var(--app-card-info-surface)]/50 text-[var(--app-card-info-text)]"
          : "border-border bg-card text-muted-foreground hover:text-foreground";
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-foreground bg-foreground text-background"
          : inactiveTone,
      )}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      {typeof count === "number" && count > 0 ? (
        <span className="tabular-nums opacity-80">{count}</span>
      ) : null}
    </button>
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
  herdrAppDoc,
  roomId,
  selected,
  copied,
  adopting,
  spaceInput,
  syncing,
  onSelect,
  onCopyAddress,
  onOpenAdopt,
  onCancelAdopt,
  onSpaceInputChange,
  onSubmitAdopt,
}: {
  readonly node: TerminalTreeNode;
  readonly herdrAppDoc: HerdrAppParsedDoc;
  readonly roomId?: string;
  readonly selected: boolean;
  readonly copied: boolean;
  readonly adopting: boolean;
  readonly spaceInput: string;
  readonly syncing: boolean;
  readonly onSelect: () => void;
  readonly onCopyAddress: () => void;
  readonly onOpenAdopt: () => void;
  readonly onCancelAdopt: () => void;
  readonly onSpaceInputChange: (value: string) => void;
  readonly onSubmitAdopt: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const t = useT();
  const { terminal, depth, descendantCount } = node;
  const isBlocked =
    terminal.state === "live" && terminalStatusWord(terminal) === "blocked";
  const machine = extractMachineName(terminal.address);
  const cwd = terminalCurrentCwd(terminal);
  const spaceLabel = resolveSpaceLabel(terminal, herdrAppDoc);
  const workItem = terminal.labels["linger.work_item"]?.trim();
  const boundRoom = terminal.labels["linger.room"]?.trim();

  return (
    <li
      className={cn(
        "rounded-xl border transition-colors",
        selected
          ? "border-foreground/35 bg-muted/75 shadow-outline"
          : isBlocked
            ? "border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)]/40 hover:bg-[var(--app-status-warning-surface)]/70"
            : "border-border bg-card hover:bg-muted/40",
      )}
      data-herdr-address={terminal.address}
      data-herdr-depth={depth}
      style={
        depth > 0 ? { marginLeft: `${Math.min(depth, 4) * 12}px` } : undefined
      }
    >
      <div className="flex flex-col gap-1.5 p-2">
        <div className="flex items-start justify-between gap-1.5">
          <button
            aria-current={selected ? "true" : undefined}
            className="flex min-w-0 flex-1 flex-col gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onSelect}
            type="button"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <Icon
                className="shrink-0 text-muted-foreground"
                icon={ComputerTerminal01Icon}
                size={13}
              />
              <span className="truncate text-xs font-semibold text-foreground">
                {terminalDisplayName(terminal)}
              </span>
              {machine !== "local" ? (
                <span className="shrink-0 rounded bg-muted px-1 py-0.2 text-[10px] font-medium text-muted-foreground">
                  {machine}
                </span>
              ) : null}
            </div>
            <HerdrCoreStatusPill terminal={terminal} />
          </button>

          <button
            aria-label={
              copied
                ? t(m.addressCopied, { address: terminal.address })
                : t(m.copyAddress, { address: terminal.address })
            }
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onCopyAddress}
            title={t(m.copyAddress, { address: terminal.address })}
            type="button"
          >
            <span>{terminal.address}</span>
            <Icon icon={copied ? Tick02Icon : ClipboardCopyIcon} size={10} />
          </button>
        </div>

        {/* Metadata row: template, work item, room badge, cwd, sub-agents */}
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          {terminal.template ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
              {terminal.template}
            </span>
          ) : null}
          {workItem ? (
            <span className="rounded bg-[var(--app-card-info-surface)] px-1.5 py-0.5 font-mono font-medium text-[var(--app-card-info-text)]">
              {workItem}
            </span>
          ) : null}
          {boundRoom && (!roomId || boundRoom !== roomId) ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
              {t(m.roomBoundBadge)}
            </span>
          ) : null}
          {descendantCount > 0 ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground tabular-nums">
              {t(m.subAgentCount, { count: descendantCount })}
            </span>
          ) : null}
          {cwd ? (
            <span
              className="inline-flex min-w-0 max-w-full items-center gap-1 truncate font-mono"
              title={cwd}
            >
              <Icon className="shrink-0" icon={Folder01Icon} size={10} />
              <span className="truncate">{cwd}</span>
            </span>
          ) : null}
        </div>

        {/* Compact Space badge / inline adopt form */}
        {adopting ? (
          <form
            className="flex w-full items-center gap-1 pt-0.5"
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
          <div className="flex items-center justify-between pt-0.5">
            <button
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={onOpenAdopt}
              type="button"
            >
              <Icon icon={Layers01Icon} size={10} />
              <span>
                {spaceLabel
                  ? t(m.syncedToSpace, { space: spaceLabel })
                  : t(m.syncToSpace)}
              </span>
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
