import { useState } from "react";
import type { components } from "@linger/wire-contracts/linger-installer/types";
import { request } from "./api.js";
export type SetupReport = components["schemas"]["SetupReport"];
export type SetupChoice = components["schemas"]["SetupChoice"];
export type ByokConfiguration = components["schemas"]["ByokConfiguration"];
type ByokCheckReport = components["schemas"]["ByokCheckReport"];
const byokProtocolLabels: Record<ByokCheckReport["protocol"], string> = {
  anthropic: "Anthropic Messages",
  "openai-chat": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
};
export type PanelChoice = SetupChoice | "byok";
export function bytes(value: number | null | undefined): string {
  if (value == null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit =
    value > 0
      ? Math.min(4, Math.max(0, Math.floor(Math.log(value) / Math.log(1024))))
      : 0;
  return `${(value / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
export function SetupChoicePanel({
  report,
  choice,
  onChange,
  onInstall,
  disabled,
  blocker,
}: {
  report: SetupReport;
  choice?: PanelChoice;
  onChange: (choice: PanelChoice) => void;
  onInstall: (byok?: ByokConfiguration) => void;
  disabled: boolean;
  blocker?: string;
}) {
  const [byokRuntime, setByokRuntime] =
    useState<NonNullable<ByokConfiguration["runtime"]>>("claude");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState("");
  const isByok = choice === "byok";
  const selected =
    choice === "local-models"
      ? report.localModels.estimate
      : !isByok
        ? report.runtimes.find((r) => r.choice === choice)?.estimate
        : undefined;
  const label = isByok
    ? "BYOK"
    : choice === "local-models"
      ? report.localModels.estimate.model || "Local models"
      : choice
        ? { codex: "Codex", claude: "Claude Code", pi: "Pi" }[choice]
        : "";
  const buildByok = (): ByokConfiguration => ({
    baseUrl: baseUrl.trim(),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    modelId: modelId.trim(),
    runtime: byokRuntime,
  });
  async function checkByok() {
    if (!baseUrl.trim() || !modelId.trim()) return;
    setChecking(true);
    setCheckNote("Checking endpoint…");
    try {
      const report = await request<ByokCheckReport>("/byok/check", buildByok());
      setCheckNote(
        `Ready · ${report.modelId} (${Math.round(report.contextWindow / 1000)}k context) through ${byokProtocolLabels[report.protocol]}`,
      );
    } catch (error) {
      setCheckNote(
        error instanceof Error ? error.message : "BYOK endpoint check failed.",
      );
    } finally {
      setChecking(false);
    }
  }
  const byokIncomplete = isByok && (!baseUrl.trim() || !modelId.trim());
  return (
    <section className="setup-choice" aria-label={"Deployment plan"}>
      <p className="recommended-plan">
        <span className="recommendation-tag">
          {choice === report.recommendation ? "Recommended" : "Selected"}
        </span>
        <strong>{label}</strong>
      </p>
      {selected && (
        <div className="setup-budget">
          <p>
            {"Download"} {bytes(selected.downloadBytes)} · {"Disk"}{" "}
            {bytes(selected.diskBytes)}
            {selected.memoryBytes != null
              ? ` · RAM ${bytes(selected.memoryBytes)}`
              : ""}
          </p>
          {selected.durationSeconds && (
            <p>
              {"About"} {Math.ceil(selected.durationSeconds.min / 60)}–
              {Math.ceil(selected.durationSeconds.max / 60)} {"minutes"}
            </p>
          )}
          {choice === "local-models" && (
            <p>
              {
                "Includes model loading. Review the exact GPU and resource plan before downloading."
              }
            </p>
          )}
        </div>
      )}
      {blocker && (
        <p
          className="setup-blocker"
          role="status"
          aria-label={"Before installation"}
        >
          {blocker}
        </p>
      )}
      <div className="harness-choices">
        <div role="radiogroup" aria-label={"Installation plan"}>
          {report.choices
            .filter((option) => option !== "local-models")
            .map((option) => {
              const runtime = report.runtimes.find((r) => r.choice === option);
              return (
                <label
                  className={`setup-option ${choice === option ? "selected" : ""}`}
                  key={option}
                >
                  <input
                    type="radio"
                    name="setup-choice"
                    value={option}
                    checked={choice === option}
                    onChange={() => onChange(option)}
                  />
                  <span>
                    <strong>
                      {
                        { codex: "Codex", claude: "Claude Code", pi: "Pi" }[
                          option
                        ]
                      }
                    </strong>
                    {report.recommendation === option ? " · Recommended" : ""}
                    <small>
                      {runtime?.installed
                        ? "Installed · will reuse"
                        : "Will install"}
                    </small>
                  </span>
                </label>
              );
            })}
          <label
            className={`setup-option ${isByok ? "selected" : ""}`}
            title="Bring Your Own Key — Connect your own OpenAI-compatible or Anthropic API endpoint, key, and model through Linger's local Bifrost gateway."
          >
            <input
              type="radio"
              name="setup-choice"
              value="byok"
              checked={isByok}
              onChange={() => onChange("byok")}
            />
            <span>
              <strong>{"BYOK"}</strong>
              <small>
                {
                  "Bring Your Own Key · Mounted on local Bifrost for all runtimes"
                }
              </small>
            </span>
          </label>
        </div>
      </div>
      {isByok && (
        <div className="byok-panel">
          <label>
            {"AI runtime"}
            <select
              value={byokRuntime}
              onChange={(event) => {
                setByokRuntime(
                  event.target.value as NonNullable<
                    ByokConfiguration["runtime"]
                  >,
                );
                // The runtime decides which API format is tried first.
                setCheckNote("");
              }}
            >
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="pi">Pi</option>
            </select>
          </label>
          <label>
            {"Endpoint URL"}
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              maxLength={2048}
            />
          </label>
          <label>
            {"API key"}
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Stored privately on this computer"
              maxLength={4096}
            />
          </label>
          <label>
            {"Model ID"}
            <input
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="gpt-5.4 or claude-sonnet-4-6"
              maxLength={256}
            />
          </label>
          <div className="byok-check-row">
            <button
              type="button"
              className="button compact"
              disabled={checking || byokIncomplete}
              onClick={() => void checkByok()}
            >
              {checking ? "Checking…" : "Check"}
            </button>
            {checkNote && <span role="status">{checkNote}</span>}
          </div>
        </div>
      )}
      <button
        className="button primary deploy-action"
        disabled={disabled || byokIncomplete}
        onClick={() => {
          if (isByok) {
            const payload = buildByok();
            setApiKey("");
            onInstall(payload);
          } else {
            onInstall();
          }
        }}
      >
        {"Install Linger"}
      </button>
    </section>
  );
}
