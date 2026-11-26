import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { useT } from "@/i18n/use-translation";

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
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onLaunch: (request: HerdrCoreLaunchRequest) => Promise<void> | void;
}

export function LaunchTerminalDialog({
  templates,
  machines,
  defaultRoomId,
  defaultWorkItemId = "",
  defaultMachine = "local",
  pending = false,
  error = null,
  onClose,
  onLaunch,
}: LaunchTerminalDialogProps) {
  const t = useT();
  const templateFieldId = useId();
  const machineFieldId = useId();
  const nameFieldId = useId();
  const cwdFieldId = useId();
  const commandFieldId = useId();
  const taskFieldId = useId();
  const workItemFieldId = useId();
  const spaceFieldId = useId();

  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [machine, setMachine] = useState(
    defaultMachine === "all" ? "local" : defaultMachine,
  );
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [commandLine, setCommandLine] = useState("");
  const [task, setTask] = useState("");
  const [keep, setKeep] = useState(false);
  const [bindRoom, setBindRoom] = useState(Boolean(defaultRoomId));
  const [workItemId, setWorkItemId] = useState(defaultWorkItemId);
  const [spaceName, setSpaceName] = useState("");

  const activeTemplate = templates.find(
    (entry) => entry.name === selectedTemplate,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  return (
    <ModalDialog
      description={t(m.launchDialogDescription)}
      footer={
        <>
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
        </>
      }
      onClose={onClose}
      size="md"
      title={t(m.launchDialogTitle)}
    >
      <form
        className="flex flex-col gap-3 px-5 py-4"
        id="herdr-launch-form"
        onSubmit={handleSubmit}
      >
        <fieldset className="flex flex-col gap-3" disabled={pending}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              <span>{t(m.launchTemplateLabel)}</span>
              <select
                className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={templateFieldId}
                onChange={(event) => setSelectedTemplate(event.target.value)}
                value={selectedTemplate}
              >
                <option value="">{t(m.launchTemplateCustom)}</option>
                {templates.map((tpl) => (
                  <option key={tpl.name} value={tpl.name}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </label>

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
          </div>

          {activeTemplate?.description ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {activeTemplate.description}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              <span>{t(m.launchCwdLabel)}</span>
              <input
                className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={cwdFieldId}
                onChange={(event) => setCwd(event.target.value)}
                placeholder={t(m.launchCwdPlaceholder)}
                type="text"
                value={cwd}
              />
            </label>
          </div>

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

          <div className="flex flex-col gap-2 pt-1">
            {defaultRoomId ? (
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  checked={bindRoom}
                  className="size-3.5 rounded border-border"
                  onChange={(event) => setBindRoom(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  {t(m.launchBindRoomLabel, { roomId: defaultRoomId })}
                </span>
              </label>
            ) : null}

            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                checked={keep}
                className="size-3.5 rounded border-border"
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
