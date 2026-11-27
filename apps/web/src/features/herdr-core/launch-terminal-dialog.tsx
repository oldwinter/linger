import { ComputerTerminal01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { herdrCoreMessages as m } from "./herdr-core.messages";
import { isMachineConnected, isMachineNeedsLogin } from "./tree";
import type {
  HerdrCoreLaunchRequest,
  HerdrCoreMachine,
  HerdrCoreTemplate,
} from "./types";

interface LaunchTerminalDialogProps {
  readonly templates: readonly HerdrCoreTemplate[];
  readonly machines: readonly HerdrCoreMachine[];
  readonly defaultRoomId?: string;
  readonly defaultWorkItemId?: string;
  readonly defaultMachine?: string;
  readonly defaultCwd?: string;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onLaunch: (request: HerdrCoreLaunchRequest) => Promise<void> | void;
}

function formatTemplateCommand(
  command: string | readonly string[] | null | undefined,
): string | null {
  if (!command) return null;
  if (typeof command === "string") return command.trim() || null;
  const joined = command.join(" ").trim();
  return joined || null;
}

export function LaunchTerminalDialog({
  templates,
  machines,
  defaultRoomId,
  defaultWorkItemId = "",
  defaultMachine = "local",
  defaultCwd = "",
  pending = false,
  error = null,
  onClose,
  onLaunch,
}: LaunchTerminalDialogProps) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const machineFieldId = useId();
  const nameFieldId = useId();
  const cwdFieldId = useId();
  const commandFieldId = useId();
  const taskFieldId = useId();
  const workItemFieldId = useId();
  const spaceFieldId = useId();
  const bindRoomFieldId = useId();

  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [machine, setMachine] = useState(
    defaultMachine === "all" ? "local" : defaultMachine,
  );
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState(defaultCwd);
  const [commandLine, setCommandLine] = useState("");
  const [task, setTask] = useState("");
  const [keep, setKeep] = useState(false);
  const [bindRoom, setBindRoom] = useState(Boolean(defaultRoomId));
  const [workItemId, setWorkItemId] = useState(defaultWorkItemId);
  const [spaceName, setSpaceName] = useState("");

  function submitLaunch() {
    if (pending) return;

    const labels: Record<string, string> = {};
    if (bindRoom && defaultRoomId) {
      labels["linger.room"] = defaultRoomId;
    }
    if (workItemId.trim()) {
      labels["linger.work_item"] = workItemId.trim();
    }
    if (spaceName.trim()) {
      labels["herdr.space"] = spaceName.trim();
    }

    const request: HerdrCoreLaunchRequest = {
      ...(selectedTemplate
        ? {
            template: selectedTemplate,
            ...(task.trim() ? { task: task.trim() } : {}),
          }
        : commandLine.trim()
          ? { line: commandLine.trim() }
          : {}),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(machine && machine !== "local" ? { on: machine } : {}),
      ...(keep ? { keep: true } : {}),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    };

    void onLaunch(request);
  }

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        form.requestSubmit();
      }
    };
    form.addEventListener("keydown", onKeyDown);
    return () => form.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitLaunch();
  }

  return (
    <ModalDialog
      description={t(m.launchDialogDescription)}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            {t(m.launchShortcutHint)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button data-voice-close onClick={onClose} tone="secondary">
              {t(m.launchCancel)}
            </Button>
            <Button
              form="herdr-launch-form"
              loading={pending}
              tone="primary"
              type="submit"
            >
              {t(m.launchSubmit)}
            </Button>
          </div>
        </div>
      }
      onClose={onClose}
      size="md"
      title={t(m.launchDialogTitle)}
    >
      <form
        className="flex flex-col gap-3.5 px-5 py-4"
        id="herdr-launch-form"
        onSubmit={handleSubmit}
        ref={formRef}
      >
        <fieldset className="flex flex-col gap-3.5" disabled={pending}>
          {/* Template picker cards */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {t(m.launchTemplateLabel)}
            </span>
            <div
              aria-label={t(m.launchTemplateLabel)}
              className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
              role="radiogroup"
            >
              <TemplateCard
                command={null}
                description={t(m.launchCustomDescription)}
                name={t(m.launchTemplateCustom)}
                onSelect={() => setSelectedTemplate("")}
                selected={selectedTemplate === ""}
              />
              {templates.map((tpl) => (
                <TemplateCard
                  command={formatTemplateCommand(tpl.command)}
                  description={tpl.description ?? null}
                  key={tpl.name}
                  name={tpl.name}
                  onSelect={() => setSelectedTemplate(tpl.name)}
                  selected={selectedTemplate === tpl.name}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              <span>{t(m.launchMachineLabel)}</span>
              <select
                className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={machineFieldId}
                onChange={(event) => setMachine(event.target.value)}
                value={machine}
              >
                <option value="local">{t(m.localMachine)}</option>
                {machines.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                    {isMachineNeedsLogin(entry)
                      ? ` (${t(m.machineNeedsLogin)})`
                      : !isMachineConnected(entry)
                        ? ` (${t(m.machineOffline)})`
                        : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              <span>{t(m.launchNameLabel)}</span>
              <input
                className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={nameFieldId}
                onChange={(event) => setName(event.target.value)}
                placeholder={t(m.launchNamePlaceholder)}
                type="text"
                value={name}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            <span>{t(m.launchCwdLabel)}</span>
            <input
              className="h-9 rounded-lg border border-border bg-card px-2.5 font-mono text-xs text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id={cwdFieldId}
              onChange={(event) => setCwd(event.target.value)}
              placeholder={defaultCwd || t(m.launchCwdPlaceholder)}
              type="text"
              value={cwd}
            />
          </label>

          {selectedTemplate ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              <span>{t(m.launchTaskLabel)}</span>
              <textarea
                className="min-h-20 rounded-lg border border-border bg-card px-2.5 py-2 text-sm text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={taskFieldId}
                onChange={(event) => setTask(event.target.value)}
                placeholder={t(m.launchTaskPlaceholder)}
                rows={3}
                value={task}
              />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              <span>{t(m.launchCommandLabel)}</span>
              <input
                className="h-9 rounded-lg border border-border bg-card px-2.5 font-mono text-xs text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={commandFieldId}
                onChange={(event) => setCommandLine(event.target.value)}
                placeholder={t(m.launchCommandPlaceholder)}
                type="text"
                value={commandLine}
              />
            </label>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              <span>{t(m.launchWorkItemLabel)}</span>
              <input
                className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={workItemFieldId}
                onChange={(event) => setWorkItemId(event.target.value)}
                type="text"
                value={workItemId}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              <span>{t(m.launchSpaceLabel)}</span>
              <input
                className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={spaceFieldId}
                onChange={(event) => setSpaceName(event.target.value)}
                placeholder={t(m.syncSpacePlaceholder)}
                type="text"
                value={spaceName}
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 pt-0.5">
            {defaultRoomId ? (
              <div className="flex items-center gap-2 text-xs text-foreground">
                <input
                  checked={bindRoom}
                  className="size-3.5 shrink-0 rounded border-border"
                  id={bindRoomFieldId}
                  onChange={(event) => setBindRoom(event.target.checked)}
                  type="checkbox"
                />
                <label
                  className="flex min-w-0 cursor-pointer items-center gap-1.5"
                  htmlFor={bindRoomFieldId}
                >
                  <span>{t(m.launchBindRoomLabel)}</span>
                  <code className="max-w-[160px] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {defaultRoomId}
                  </code>
                </label>
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                checked={keep}
                className="size-3.5 shrink-0 rounded border-border"
                onChange={(event) => setKeep(event.target.checked)}
                type="checkbox"
              />
              <span>{t(m.launchKeepLabel)}</span>
            </label>
          </div>

          {error ? (
            <p
              className="rounded-lg border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] px-3 py-2 text-xs text-[var(--app-status-danger-text)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </fieldset>
      </form>
    </ModalDialog>
  );
}

function TemplateCard({
  name,
  description,
  command,
  selected,
  onSelect,
}: {
  readonly name: string;
  readonly description: string | null;
  readonly command: string | null;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      aria-checked={selected}
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        selected
          ? "border-foreground bg-muted/60 shadow-outline"
          : "border-border bg-card hover:bg-muted/35",
      )}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
          <Icon
            className="shrink-0 text-muted-foreground"
            icon={ComputerTerminal01Icon}
            size={13}
          />
          <span className="truncate">{name}</span>
        </span>
        {selected ? (
          <span
            aria-hidden="true"
            className="grid size-4 shrink-0 place-items-center rounded-full bg-foreground text-background"
          >
            <Icon icon={Tick02Icon} size={10} />
          </span>
        ) : null}
      </div>
      {description ? (
        <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {description}
        </span>
      ) : null}
      {command ? (
        <code className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {command}
        </code>
      ) : null}
    </button>
  );
}
