import { RefreshIcon } from "@hugeicons/core-free-icons";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, fieldControlClassName } from "@/components/ui/field";
import { FormFeedback } from "@/components/ui/form-feedback";
import { Icon } from "@/components/ui/icon";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Select, SelectItem } from "@/components/ui/select";
import { Hint } from "@/features/local-computer/computer-hint";
import { localComputersQueryKey } from "@/features/local-computer/local-computer-queries";
import {
  tenantAgentAvailabilityQueryKey,
  tenantAgentsQueryKey,
} from "@/features/rooms/room-queries";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { cn } from "@/lib/cn";

import {
  byokProtocolLabels,
  modelSourceErrorCopy,
  modelSourceModeLabels,
  modelSourceRuntimeLabels,
} from "./local-models-copy";
import {
  type LocalModel,
  tenantLocalModelsQueryKey,
} from "./local-models-queries";
import { contextLabel, formatGigabytes } from "./local-models-rules";
import {
  type ByokInput,
  type ByokModel,
  type ByokTestRequest,
  byokModelsQueryOptions,
  type ModelSourceMode,
  type ModelSourceRuntime,
  type ModelSourceStatus,
  type ModelSourceSwitchRequest,
  type ModelSourceView,
  modelSourceQueryKey,
  switchModelSource,
  testByokEndpoint,
} from "./model-source-queries";

// Subscription is not offered: switching to it moves every Agent on the
// Computer to one Runtime without checking that Runtime is signed in, and
// unloads local models.
const modes: readonly ModelSourceMode[] = ["local", "byok"];
const byokRuntimes: readonly ModelSourceRuntime[] = ["claude", "codex", "pi"];

const byokExplanation =
  "Bring your own key: use your own OpenAI-compatible or Anthropic API endpoint. A gateway on this computer serves it to your Agents.";

/** What the page says the Computer's Agents run on now. */
export function activeSourceLabel(status: ModelSourceStatus) {
  const runtime = modelSourceRuntimeLabels[status.runtime];
  if (status.mode === "byok")
    return `BYOK · ${status.byok.model_id ?? runtime}`;
  if (status.mode === "subscription") return `Subscription · ${runtime}`;
  return "Local model";
}

interface ModelSourceSwitcher {
  clearFeedback: () => void;
  failure: string | undefined;
  pending: ModelSourceSwitchRequest | undefined;
  request: (body: ModelSourceSwitchRequest) => void;
  saveRevision: number;
}

/**
 * Switching may take minutes while the Computer installs a Runtime or starts
 * its gateway. When Agents are working, the owner chooses whether to end
 * their tasks; nothing changes until they do. Work that starts during the
 * switch is asked about once the Computer has switched.
 */
export function useModelSourceSwitch({
  computerId,
  computerName,
  tenantId,
}: {
  computerId: string;
  computerName: string;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<{
    agents: string[];
    body: ModelSourceSwitchRequest;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const mutation = useMutation({
    mutationFn: (body: ModelSourceSwitchRequest) =>
      switchModelSource(client, tenantId, computerId, body),
    onError: (error, body) => {
      // A switch can fail after the Computer changed (work started meanwhile,
      // or no answer in time), so show what it serves now.
      void queryClient.invalidateQueries({
        queryKey: modelSourceQueryKey(tenantId, computerId),
      });
      if (
        error instanceof TeamHubError &&
        error.code === "AGENT_HAS_ACTIVE_RUNS"
      )
        setBusy({
          agents: (error.details ?? []).map((detail) => detail.reason),
          body,
        });
    },
    onMutate: () => setNotice(null),
    onSuccess: (view) => {
      queryClient.setQueryData(modelSourceQueryKey(tenantId, computerId), view);
      setNotice(switchedNotice(view));
      setSaveRevision((current) => current + 1);
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: tenantLocalModelsQueryKey(tenantId),
        }),
        queryClient.invalidateQueries({
          queryKey: localComputersQueryKey(tenantId),
        }),
        queryClient.invalidateQueries({
          queryKey: tenantAgentsQueryKey(tenantId),
        }),
        queryClient.invalidateQueries({
          queryKey: tenantAgentAvailabilityQueryKey(tenantId),
        }),
      ]);
    },
  });
  const failureCode =
    mutation.error instanceof TeamHubError ? mutation.error.code : undefined;
  const switcher: ModelSourceSwitcher = {
    clearFeedback: () => {
      setNotice(null);
      if (mutation.isError) mutation.reset();
    },
    failure:
      mutation.isError && failureCode !== "AGENT_HAS_ACTIVE_RUNS"
        ? modelSourceErrorCopy(failureCode)
        : undefined,
    pending: mutation.isPending ? mutation.variables : undefined,
    request: (body) => mutation.mutate(body),
    saveRevision,
  };
  const feedback = (
    <>
      {notice ? (
        <div className="mt-4">
          <FormFeedback tone="success">{notice}</FormFeedback>
        </div>
      ) : null}
      {busy ? (
        <TerminateTasksDialog
          agents={busy.agents}
          computerName={computerName}
          onClose={() => setBusy(null)}
          onConfirm={() => {
            mutation.mutate({ ...busy.body, force_terminate: true });
            setBusy(null);
          }}
        />
      ) : null}
    </>
  );
  return { feedback, switcher };
}

function switchedNotice(view: ModelSourceView) {
  if (!view.status) return "Switched.";
  const updated = view.updated_agent_count ?? 0;
  const ended = view.terminated_run_count ?? 0;
  const parts = [`Agents now use ${activeSourceLabel(view.status)}.`];
  if (updated)
    parts.push(
      `${updated} ${updated === 1 ? "Agent was" : "Agents were"} moved.`,
    );
  if (ended)
    parts.push(`${ended} ${ended === 1 ? "task was" : "tasks were"} ended.`);
  return parts.join(" ");
}

function TerminateTasksDialog({
  agents,
  computerName,
  onClose,
  onConfirm,
}: {
  agents: string[];
  computerName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const names = agents.length ? agents.join(", ") : "Some Agents";
  return (
    <ModalDialog
      description={`${names} ${agents.length === 1 ? "is" : "are"} working on tasks on ${computerName}. Switching now ends those tasks; they can't be resumed.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={onConfirm} tone="danger">
            Terminate tasks & Switch
          </Button>
        </>
      }
      onClose={onClose}
      size="md"
      title="End running tasks?"
    >
      <p className="px-5 py-4 text-sm text-muted-foreground">
        To keep them, wait until they finish and switch then.
      </p>
    </ModalDialog>
  );
}

/** The offered model sources as tabs; a dot marks the one in use. */
export function ModelSourceTabs({
  active,
  onChange,
  value,
}: {
  active: ModelSourceMode;
  onChange: (mode: ModelSourceMode) => void;
  value: ModelSourceMode;
}) {
  return (
    <div
      aria-label="Model source"
      className="mt-6 inline-flex self-start rounded-lg bg-muted p-0.5"
      role="tablist"
    >
      {modes.map((mode) => {
        const tab = (
          <button
            aria-selected={mode === value}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              mode === value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            key={mode}
            onClick={() => onChange(mode)}
            role="tab"
            type="button"
          >
            {mode === active ? (
              <span
                aria-label="In use"
                className="size-1.5 rounded-full bg-app-success"
                role="img"
              />
            ) : null}
            {modelSourceModeLabels[mode]}
          </button>
        );
        return mode === "byok" ? (
          <Hint key={mode} placement="top" text={byokExplanation}>
            {tab}
          </Hint>
        ) : (
          tab
        );
      })}
    </div>
  );
}

/** Offered above the library while the Agents use another source. */
export function SwitchToLocalNotice({
  disabled,
  models,
  switcher,
}: {
  disabled: boolean;
  models: readonly LocalModel[];
  switcher: ModelSourceSwitcher;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const chosen =
    (selectedId
      ? models.find((model) => model.id === selectedId)
      : undefined) ?? models[0];
  const single = models.length === 1 ? models[0] : undefined;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {single ? (
          <>
            <span className="text-foreground">{single.name}</span> is on this
            computer and can run your Agents locally.
          </>
        ) : models.length > 1 ? (
          "Choose a model on this computer to run your Agents locally."
        ) : (
          "Download a model below to run your Agents locally."
        )}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {models.length > 1 && chosen ? (
          <Select
            aria-label="Local model"
            onValueChange={setSelectedId}
            value={chosen.id}
            variant="pill"
          >
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name} ·{" "}
                {model.state === "loaded" ? "Loaded" : "Downloaded"} ·{" "}
                {formatGigabytes(model.memory_bytes)}
              </SelectItem>
            ))}
          </Select>
        ) : null}
        <Button
          disabled={disabled || !chosen}
          loading={switcher.pending?.mode === "local"}
          onClick={() =>
            chosen &&
            switcher.request({ local_model_id: chosen.id, mode: "local" })
          }
          size="compact"
          tone="primary"
        >
          Switch to Local model
        </Button>
      </div>
    </div>
  );
}

/** A listed model: its ID, then its name and context window when known. */
function ByokModelOption({ model }: { model: ByokModel }) {
  const details = [
    model.name,
    model.context_window ? contextLabel(model.context_window) : undefined,
  ].filter(Boolean);
  return (
    <>
      {details.length ? `${model.id} ` : model.id}
      {details.length ? (
        <span className="ml-1 text-xs text-muted-foreground">
          {details.join(" · ")}
        </span>
      ) : null}
    </>
  );
}

function sameEndpointOrigin(savedUrl: string | undefined, nextUrl: string) {
  const trimmedSaved = savedUrl?.trim();
  const trimmedNext = nextUrl.trim();
  if (!trimmedSaved || !trimmedNext) return false;
  if (trimmedSaved === trimmedNext) return true;
  try {
    return new URL(trimmedSaved).origin === new URL(trimmedNext).origin;
  } catch {
    return false;
  }
}

/**
 * The person's own endpoint. The API key goes to the Computer, which keeps
 * it private; Linger never shows it again.
 */
export function ByokPanel({
  computerId,
  disabled,
  status,
  switcher,
  tenantId,
}: {
  computerId: string;
  disabled: boolean;
  status: ModelSourceStatus;
  switcher: ModelSourceSwitcher;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const saved = status.byok;
  const [runtime, setRuntime] = useState<ModelSourceRuntime>(
    status.mode === "byok" ? status.runtime : "claude",
  );
  const [baseUrl, setBaseUrl] = useState(saved.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  // Starts empty until a model is saved, then shows the saved one.
  const [modelId, setModelId] = useState(saved.model_id ?? "");
  const [manualModelEntry, setManualModelEntry] = useState(false);
  // Models are listed for the address and key as they stand when a field is
  // left, not on every keystroke.
  const [listed, setListed] = useState({
    baseUrl: saved.base_url ?? "",
    keyRevision: 0,
  });
  const [keyEdited, setKeyEdited] = useState(false);
  const trimmedBaseUrl = baseUrl.trim();
  // Never reuse a saved key when the owner points BYOK at a different host.
  const canReuseSavedKey =
    saved.key_saved &&
    (!saved.base_url || sameEndpointOrigin(saved.base_url, trimmedBaseUrl));
  const credentials = apiKey
    ? { api_key: apiKey }
    : canReuseSavedKey
      ? { reuse_saved_key: true }
      : {};
  const listedCanReuseSavedKey =
    saved.key_saved &&
    (!saved.base_url || sameEndpointOrigin(saved.base_url, listed.baseUrl));
  const listedCredentials = apiKey
    ? { api_key: apiKey }
    : listedCanReuseSavedKey
      ? { reuse_saved_key: true }
      : {};
  const input: ByokInput = {
    base_url: trimmedBaseUrl,
    model_id: modelId.trim(),
    ...credentials,
  };
  const models = useQuery({
    ...byokModelsQueryOptions(
      client,
      tenantId,
      computerId,
      { base_url: listed.baseUrl, ...listedCredentials },
      listed.keyRevision,
    ),
    // A refresh keeps the current choices on screen until the new list lands,
    // but clearing the address clears stale options.
    placeholderData: listed.baseUrl ? keepPreviousData : undefined,
  });
  const listedModels = listed.baseUrl ? (models.data?.models ?? []) : [];
  // A saved or typed ID the endpoint does not list stays choosable.
  const modelOptions =
    input.model_id === "" ||
    listedModels.some((model) => model.id === input.model_id)
      ? listedModels
      : [{ id: input.model_id }, ...listedModels];
  const modelControlId = useId();
  const modelHintId = `${modelControlId}-hint`;
  const modelHint = models.isFetching
    ? "Listing the endpoint's models…"
    : models.isError
      ? "The endpoint didn't list its models. Type the model ID."
      : listedModels.length
        ? `${listedModels.length} ${listedModels.length === 1 ? "model" : "models"} listed.`
        : undefined;
  const showModelSelect = listedModels.length > 0 && !manualModelEntry;
  // The Computer decides whether the endpoint needs a key: one on this
  // computer or the local network may have none.
  const complete = input.base_url !== "" && input.model_id !== "";
  const test = useMutation({
    mutationFn: (body: ByokTestRequest) =>
      testByokEndpoint(client, tenantId, computerId, body),
  });
  const active = status.mode === "byok";

  function save(event: FormEvent) {
    event.preventDefault();
    switcher.request({ byok: input, mode: "byok", runtime });
  }

  function listModels() {
    setKeyEdited(false);
    setListed((current) => ({
      baseUrl: input.base_url,
      keyRevision: current.keyRevision + 1,
    }));
  }

  return (
    <form
      aria-label="BYOK"
      className="mt-6 overflow-hidden rounded-xl border border-border"
      onSubmit={save}
    >
      <div className="grid grid-cols-1 gap-4 px-4 py-4">
        {active && saved.protocol ? (
          <p className="text-xs text-muted-foreground">
            In use, through {byokProtocolLabels[saved.protocol]}.
          </p>
        ) : null}
        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">
            AI runtime
          </p>
          <Select
            aria-label="AI runtime"
            className="w-full"
            disabled={disabled}
            onValueChange={(value) => {
              setRuntime(value as ModelSourceRuntime);
              // The runtime decides which API format is tried first.
              test.reset();
            }}
            value={runtime}
          >
            {byokRuntimes.map((item) => (
              <SelectItem key={item} value={item}>
                {modelSourceRuntimeLabels[item]}
              </SelectItem>
            ))}
          </Select>
        </div>
        <Field
          autoComplete="off"
          disabled={disabled}
          label="Base URL"
          onBlur={() =>
            setListed((current) =>
              current.baseUrl === input.base_url
                ? current
                : { ...current, baseUrl: input.base_url },
            )
          }
          onChange={(event) => {
            setBaseUrl(event.target.value);
            test.reset();
          }}
          placeholder="https://api.example.com/v1"
          spellCheck={false}
          value={baseUrl}
        />
        <Field
          autoComplete="new-password"
          disabled={disabled}
          hint={
            canReuseSavedKey
              ? "A key is saved on this computer. Leave blank to keep it."
              : "Optional for an endpoint on this computer or your local network."
          }
          label="API key"
          onBlur={() => {
            if (!keyEdited) return;
            setKeyEdited(false);
            setListed((current) => ({
              ...current,
              keyRevision: current.keyRevision + 1,
            }));
          }}
          onChange={(event) => {
            setApiKey(event.target.value);
            setKeyEdited(true);
            test.reset();
          }}
          type="password"
          value={apiKey}
        />
        <div>
          <label
            className="mb-1.5 block text-sm font-medium text-foreground"
            htmlFor={modelControlId}
          >
            Model
          </label>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-48 flex-1">
              {showModelSelect ? (
                <Select
                  aria-describedby={modelHint ? modelHintId : undefined}
                  aria-label="Model"
                  className="w-full"
                  disabled={disabled}
                  id={modelControlId}
                  onValueChange={(value) => {
                    setModelId(value);
                    test.reset();
                  }}
                  placeholder="Choose a model"
                  value={input.model_id}
                >
                  {modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <ByokModelOption model={model} />
                    </SelectItem>
                  ))}
                </Select>
              ) : (
                <input
                  aria-describedby={modelHint ? modelHintId : undefined}
                  autoComplete="off"
                  className={fieldControlClassName}
                  disabled={disabled}
                  id={modelControlId}
                  onChange={(event) => {
                    setModelId(event.target.value);
                    test.reset();
                  }}
                  placeholder="provider/model-name"
                  spellCheck={false}
                  value={modelId}
                />
              )}
            </div>
            <Button
              disabled={disabled || input.base_url === ""}
              loading={models.isFetching}
              onClick={listModels}
              onMouseDown={(event) => event.preventDefault()}
              size="large"
            >
              {models.isFetching ? null : <Icon icon={RefreshIcon} size={16} />}
              List models
            </Button>
          </div>
          {modelHint || listedModels.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <p id={modelHintId}>{modelHint}</p>
              {listedModels.length > 0 ? (
                <button
                  className="text-foreground underline underline-offset-2 disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => setManualModelEntry((current) => !current)}
                  type="button"
                >
                  {manualModelEntry
                    ? "Choose from list"
                    : "Enter model ID manually"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {test.isSuccess ? (
          <FormFeedback tone="success">
            Connected to {test.data.base_url} through{" "}
            {byokProtocolLabels[test.data.protocol]}. {test.data.model_id} has{" "}
            {contextLabel(test.data.context_window)} of context.
          </FormFeedback>
        ) : null}
        {test.isError ? (
          <FormFeedback tone="danger">
            {modelSourceErrorCopy(
              test.error instanceof TeamHubError ? test.error.code : undefined,
            )}
          </FormFeedback>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-3">
        <Button
          disabled={disabled || !complete}
          loading={test.isPending}
          onClick={() => test.mutate({ byok: input, runtime })}
          size="large"
        >
          Test connection
        </Button>
        <Button
          disabled={disabled || !complete}
          loading={switcher.pending?.mode === "byok"}
          size="large"
          tone="primary"
          type="submit"
        >
          {active ? "Save" : "Save & Switch to BYOK"}
        </Button>
      </footer>
    </form>
  );
}
