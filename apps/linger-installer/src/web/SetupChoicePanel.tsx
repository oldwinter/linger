import { useState } from "react";
import type { components } from "@linger/wire-contracts/linger-installer/types";
import {
  ByokPanel,
  byokAddressProblem,
  byokEndpoint,
  emptyByokDraft,
  type ByokDraft,
} from "./ByokPanel.js";
export type SetupReport = components["schemas"]["SetupReport"];
export type SetupChoice = components["schemas"]["SetupChoice"];
export type ByokConfiguration = components["schemas"]["ByokConfiguration"];
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
  const [byok, setByok] = useState<ByokDraft>(emptyByokDraft);
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
  const byokIncomplete =
    isByok && (!byok.modelId.trim() || Boolean(byokAddressProblem(byok)));
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
        {isByok && <ByokPanel draft={byok} onDraftChange={setByok} />}
      </div>
      <button
        className="button primary deploy-action"
        disabled={disabled || byokIncomplete}
        onClick={() => {
          if (isByok) {
            const payload: ByokConfiguration = {
              ...byokEndpoint(byok),
              modelId: byok.modelId.trim(),
              runtime: byok.runtime,
            };
            setByok((current) => ({ ...current, apiKey: "" }));
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
