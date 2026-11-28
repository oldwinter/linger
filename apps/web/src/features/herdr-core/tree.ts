import { isRecord } from "@linger/service-kit";

import type {
  HerdrAppParsedDoc,
  HerdrAppSpaceEntry,
  HerdrAppTabEntry,
  HerdrCoreMachine,
  HerdrCoreTerminal,
} from "./types";

export interface TerminalTreeNode {
  readonly terminal: HerdrCoreTerminal;
  readonly depth: number;
  readonly children: readonly TerminalTreeNode[];
  readonly descendantCount: number;
}

export interface TerminalFilterCriteria {
  readonly machine: string;
  readonly roomId?: string;
  readonly roomOnly: boolean;
  readonly workItemId: string;
  readonly status: string;
  readonly search: string;
  readonly showFinished: boolean;
}

export function extractMachineName(address: string): string {
  const slash = address.indexOf("/");
  return slash === -1 ? "local" : address.slice(0, slash);
}

export function terminalDisplayName(terminal: HerdrCoreTerminal): string {
  const trimmedName = terminal.name?.trim();
  if (trimmedName) return trimmedName;
  const trimmedTitle = terminal.title?.trim();
  if (trimmedTitle) return trimmedTitle;
  return terminal.address;
}

export function terminalCurrentCwd(terminal: HerdrCoreTerminal): string {
  return (
    terminal.foreground?.cwd?.trim() ||
    terminal.foreground_cwd?.trim() ||
    terminal.cwd ||
    ""
  );
}

export function terminalStatusWord(
  terminal: Pick<HerdrCoreTerminal, "status">,
): string | null {
  const word = terminal.status?.state ?? terminal.status?.status;
  return typeof word === "string" && word.trim().length > 0
    ? word.trim()
    : null;
}

export function isMachineNeedsLogin(machine: HerdrCoreMachine): boolean {
  return (
    machine.state === "needs_login" ||
    machine.status === "needs_login" ||
    Boolean(machine.needs_login)
  );
}

export function isMachineConnected(machine: HerdrCoreMachine): boolean {
  if (typeof machine.online === "boolean") {
    return machine.online;
  }
  if (typeof machine.state === "string" && machine.state.trim().length > 0) {
    return machine.state === "connected";
  }
  if (typeof machine.status === "string" && machine.status.trim().length > 0) {
    return machine.status === "connected" || machine.status === "online";
  }
  return machine.connected !== false;
}

export function terminalStatusRank(terminal: HerdrCoreTerminal): number {
  if (terminal.state !== "live") return 6;
  const word = terminalStatusWord(terminal);
  switch (word) {
    case "blocked":
      return 0;
    case "error":
      return 1;
    case "working":
      return 2;
    case "idle":
      return 3;
    case "done":
      return 4;
    default:
      return 5;
  }
}

function compareTerminals(a: HerdrCoreTerminal, b: HerdrCoreTerminal): number {
  const rankDiff = terminalStatusRank(a) - terminalStatusRank(b);
  if (rankDiff !== 0) return rankDiff;
  return b.created_ms - a.created_ms;
}

export function filterTerminals(
  terminals: readonly HerdrCoreTerminal[],
  criteria: TerminalFilterCriteria,
): HerdrCoreTerminal[] {
  const searchLower = criteria.search.trim().toLowerCase();
  const workItemTrimmed = criteria.workItemId.trim();

  return terminals.filter((term) => {
    if (!criteria.showFinished && term.state !== "live") return false;
    if (criteria.machine && criteria.machine !== "all") {
      if (extractMachineName(term.address) !== criteria.machine) return false;
    }
    if (criteria.roomOnly && criteria.roomId) {
      if (term.labels["linger.room"] !== criteria.roomId) return false;
    }
    if (workItemTrimmed) {
      if (term.labels["linger.work_item"] !== workItemTrimmed) return false;
    }
    if (criteria.status && criteria.status !== "all") {
      const word = terminalStatusWord(term) ?? term.state;
      if (word !== criteria.status && term.state !== criteria.status) {
        return false;
      }
    }
    if (searchLower) {
      const haystack = [
        term.address,
        term.name ?? "",
        term.title ?? "",
        term.template ?? "",
        terminalCurrentCwd(term),
        term.status?.msg ?? "",
        ...Object.values(term.labels),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }
    return true;
  });
}

/**
 * Builds a parent-child tree of terminals using `terminal.parent`, pinning
 * `blocked` terminals (and parent trees containing blocked children) to the top.
 */
export function buildTerminalTree(
  terminals: readonly HerdrCoreTerminal[],
): TerminalTreeNode[] {
  const byAddress = new Map<string, HerdrCoreTerminal>();
  for (const term of terminals) {
    byAddress.set(term.address, term);
  }

  const childrenMap = new Map<string, HerdrCoreTerminal[]>();
  const roots: HerdrCoreTerminal[] = [];

  for (const term of terminals) {
    const parentAddr = term.parent?.trim();
    if (
      parentAddr &&
      parentAddr !== term.address &&
      byAddress.has(parentAddr)
    ) {
      const siblings = childrenMap.get(parentAddr) ?? [];
      siblings.push(term);
      childrenMap.set(parentAddr, siblings);
    } else {
      roots.push(term);
    }
  }

  const visited = new Set<string>();
  const buildNode = (
    term: HerdrCoreTerminal,
    depth: number,
  ): TerminalTreeNode => {
    visited.add(term.address);
    const rawChildren = (childrenMap.get(term.address) ?? []).filter(
      (child) => !visited.has(child.address),
    );
    const children = rawChildren
      .map((child) => buildNode(child, depth + 1))
      .sort((a, b) => compareNodes(a, b));
    const descendantCount = children.reduce(
      (acc, child) => acc + 1 + child.descendantCount,
      0,
    );
    return { terminal: term, depth, children, descendantCount };
  };

  const nodes: TerminalTreeNode[] = [];
  for (const root of roots) {
    if (!visited.has(root.address)) {
      nodes.push(buildNode(root, 0));
    }
  }

  // Include any cycle members that were skipped as roots.
  for (const term of terminals) {
    if (!visited.has(term.address)) {
      nodes.push(buildNode(term, 0));
    }
  }

  return nodes.sort(compareNodes);
}

function minRankInTree(node: TerminalTreeNode): number {
  let best = terminalStatusRank(node.terminal);
  for (const child of node.children) {
    best = Math.min(best, minRankInTree(child));
  }
  return best;
}

function compareNodes(a: TerminalTreeNode, b: TerminalTreeNode): number {
  const aBlocked = minRankInTree(a) === 0 ? 0 : 1;
  const bBlocked = minRankInTree(b) === 0 ? 0 : 1;
  if (aBlocked !== bBlocked) return aBlocked - bBlocked;
  return compareTerminals(a.terminal, b.terminal);
}

export function flattenTerminalTree(
  nodes: readonly TerminalTreeNode[],
): TerminalTreeNode[] {
  const out: TerminalTreeNode[] = [];
  const walk = (list: readonly TerminalTreeNode[]): void => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

/**
 * Parses `docs/herdr-app` flexibly into Spaces and Tabs so Linger can group
 * terminals by `herdr.space` / `herdr.tab` and adopt new terminals into Spaces.
 */
export function parseHerdrAppDoc(value: unknown): HerdrAppParsedDoc {
  if (!isRecord(value)) {
    return { spaces: [], raw: {} };
  }
  const rawSpaces = Array.isArray(value.spaces) ? value.spaces : [];
  const spaces: HerdrAppSpaceEntry[] = [];

  for (const entry of rawSpaces) {
    if (!isRecord(entry)) continue;
    const id =
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : "";
    if (!id) continue;
    const name =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : id;
    const rawTabs = Array.isArray(entry.tabs) ? entry.tabs : [];
    const tabs: HerdrAppTabEntry[] = [];
    for (const tab of rawTabs) {
      if (!isRecord(tab)) continue;
      const tabId =
        typeof tab.id === "string" && tab.id.trim() ? tab.id.trim() : "";
      if (!tabId) continue;
      tabs.push({
        id: tabId,
        title:
          typeof tab.title === "string" && tab.title.trim()
            ? tab.title.trim()
            : tabId,
        ...(typeof tab.terminal === "string" ? { terminal: tab.terminal } : {}),
      });
    }
    spaces.push({ id, name, tabs });
  }

  return { spaces, raw: value };
}

export interface SpaceGroup {
  readonly spaceId: string | null;
  readonly spaceName: string | null;
  readonly nodes: readonly TerminalTreeNode[];
}

export function groupTerminalsBySpace(
  terminals: readonly HerdrCoreTerminal[],
  doc: HerdrAppParsedDoc,
): SpaceGroup[] {
  const spaceNameById = new Map<string, string>();
  const spaceByTerminal = new Map<string, string>();
  for (const space of doc.spaces) {
    spaceNameById.set(space.id, space.name);
    for (const tab of space.tabs) {
      if (tab.terminal) {
        spaceByTerminal.set(tab.terminal, space.id);
      }
    }
  }

  const buckets = new Map<string, HerdrCoreTerminal[]>();
  const unassigned: HerdrCoreTerminal[] = [];

  for (const term of terminals) {
    const labelSpace = term.labels["herdr.space"]?.trim();
    const spaceId = labelSpace || spaceByTerminal.get(term.address);
    if (spaceId) {
      const list = buckets.get(spaceId) ?? [];
      list.push(term);
      buckets.set(spaceId, list);
    } else {
      unassigned.push(term);
    }
  }

  const groups: SpaceGroup[] = [];
  for (const [spaceId, list] of buckets) {
    groups.push({
      spaceId,
      spaceName: spaceNameById.get(spaceId) ?? spaceId,
      nodes: buildTerminalTree(list),
    });
  }
  if (unassigned.length > 0) {
    groups.push({
      spaceId: null,
      spaceName: null,
      nodes: buildTerminalTree(unassigned),
    });
  }
  return groups;
}

/**
 * Produces an updated `docs/herdr-app` JSON payload and `herdr.space`/`herdr.tab`
 * labels to adopt a terminal into a `herdr-app` Space.
 */
export function buildHerdrAppAdoption(options: {
  readonly doc: HerdrAppParsedDoc;
  readonly terminal: HerdrCoreTerminal;
  readonly spaceName: string;
}): {
  readonly nextDocValue: Record<string, unknown>;
  readonly labels: Readonly<Record<string, string>>;
  readonly spaceId: string;
  readonly tabId: string;
} {
  const cleanSpaceName = options.spaceName.trim();
  const existingSpace = options.doc.spaces.find(
    (s) =>
      s.id === cleanSpaceName ||
      s.name.toLowerCase() === cleanSpaceName.toLowerCase(),
  );
  const spaceId =
    existingSpace?.id ??
    (cleanSpaceName
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gu, "-")
      .replace(/^-|-$/gu, "") ||
      "space");
  const tabId =
    options.terminal.labels["herdr.tab"]?.trim() ||
    `tab-${options.terminal.address.replace(/[^a-zA-Z0-9_-]+/gu, "-")}`;
  const tabTitle = terminalDisplayName(options.terminal);

  const nextSpaces: HerdrAppSpaceEntry[] = options.doc.spaces.map((space) => {
    const filteredTabs = space.tabs.filter(
      (tab) => tab.terminal !== options.terminal.address && tab.id !== tabId,
    );
    if (space.id !== spaceId) {
      return { ...space, tabs: filteredTabs };
    }
    return {
      ...space,
      tabs: [
        ...filteredTabs,
        { id: tabId, title: tabTitle, terminal: options.terminal.address },
      ],
    };
  });

  if (!existingSpace) {
    nextSpaces.push({
      id: spaceId,
      name: cleanSpaceName,
      tabs: [
        { id: tabId, title: tabTitle, terminal: options.terminal.address },
      ],
    });
  }

  return {
    nextDocValue: {
      ...options.doc.raw,
      spaces: nextSpaces,
    },
    labels: {
      "herdr.space": spaceId,
      "herdr.tab": tabId,
    },
    spaceId,
    tabId,
  };
}
