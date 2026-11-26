import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  DashboardSpeed01Icon,
} from "@hugeicons/core-free-icons";
import {
  AnimatePresence,
  m as motionElem,
  useReducedMotion,
} from "motion/react";
import { useState } from "react";

import { Icon } from "@/components/ui/icon";
import type { Language } from "@/i18n/language";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import {
  clampPct,
  formatInteger,
  formatMs,
  formatRate,
} from "./system-monitor-format";
import { systemMonitorMessages as m } from "./system-monitor.messages";
import type {
  SystemTelemetryInference,
  SystemTelemetryRequest,
  SystemTelemetrySlot,
} from "./system-monitor-queries";

function stageBadgeTone(stage: SystemTelemetryRequest["stage"]): string {
  switch (stage) {
    case "decoding":
      return "bg-app-success/15 text-app-success";
    case "prefilling":
      return "bg-app-info/15 text-app-info";
    case "queued":
      return "bg-app-warning/15 text-app-warning";
    case "completed":
      return "bg-muted text-muted-foreground";
  }
}

function resolveDisplayedSlots(
  inference: SystemTelemetryInference,
): readonly SystemTelemetrySlot[] {
  if (inference.slots.length > 0) {
    return inference.slots.slice(0, 8);
  }
  if (inference.total_slots <= 0) {
    return [];
  }
  return Array.from(
    { length: Math.min(8, inference.total_slots) },
    (_, index) => {
      const matchingReq = inference.requests.find(
        (request) =>
          request.slot_id === index &&
          (request.stage === "prefilling" || request.stage === "decoding"),
      );
      return {
        id: index,
        model_id:
          matchingReq?.model_id ?? inference.loaded_models[0]?.id ?? "local",
        busy: Boolean(matchingReq),
        n_ctx: inference.loaded_models[0]?.context_window ?? null,
        prompt_tokens: matchingReq?.prompt_tokens ?? null,
        prompt_processed: matchingReq?.prompt_processed ?? null,
        cached_prompt_tokens: matchingReq?.cached_prompt_tokens ?? null,
        decoded_tokens: matchingReq?.decoded_tokens ?? null,
        live_decode_tok_s: matchingReq?.live_decode_tok_s ?? null,
        client: matchingReq?.client ?? null,
      };
    },
  );
}

export function InferenceLedgerPanel({
  inference,
}: {
  readonly inference: SystemTelemetryInference;
}) {
  const { language, t } = useTranslation();
  const [expandedReqId, setExpandedReqId] = useState<string | null>(
    () => inference.requests[0]?.id ?? null,
  );
  const displayedSlots = resolveDisplayedSlots(inference);

  return (
    <section
      aria-label={t(m.ledgerRegion)}
      className="rounded-xl border border-border bg-card p-4 lg:col-span-7"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Icon icon={DashboardSpeed01Icon} size={15} />
            {t(m.ledgerTitle)}
          </h2>
          <p className="text-xs text-muted-foreground">{t(m.ledgerSubtitle)}</p>
        </div>
      </div>

      <SlotStripGrid
        inference={inference}
        language={language}
        slots={displayedSlots}
      />

      {inference.requests.length > 0 ? (
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {inference.requests.slice(0, 8).map((request) => (
            <RequestLedgerRow
              isOpen={expandedReqId === request.id}
              key={request.id}
              language={language}
              onToggle={() =>
                setExpandedReqId(
                  expandedReqId === request.id ? null : request.id,
                )
              }
              request={request}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-border bg-background/40 px-4 py-6 text-center text-xs text-muted-foreground">
          {t(m.noRequestsYet)}
        </div>
      )}
    </section>
  );
}

function SlotStripGrid({
  inference,
  language,
  slots,
}: {
  readonly inference: SystemTelemetryInference;
  readonly language: Language;
  readonly slots: readonly SystemTelemetrySlot[];
}) {
  const { t } = useTranslation();

  if (slots.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
        {t(m.noSlotsActive)}
      </div>
    );
  }

  return (
    <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {slots.map((slot) => {
        const cap =
          slot.n_ctx && slot.n_ctx > 0
            ? slot.n_ctx
            : (inference.loaded_models.find(
                (model) => model.id === slot.model_id,
              )?.context_window ?? 32_768);
        const cached = slot.cached_prompt_tokens ?? 0;
        const processed = slot.prompt_processed ?? 0;
        const decoded = slot.decoded_tokens ?? 0;
        const cachedPct = clampPct((cached / Math.max(1, cap)) * 100);
        const prefillPct = clampPct(
          (Math.max(0, processed - cached) / Math.max(1, cap)) * 100,
        );
        const decodePct = clampPct((decoded / Math.max(1, cap)) * 100);

        const statusDetail = !slot.busy
          ? t(m.slotIdle)
          : slot.live_decode_tok_s != null && slot.live_decode_tok_s > 0
            ? `${slot.client ? `${slot.client} · ` : ""}${formatRate(slot.live_decode_tok_s, language)} ${t(m.tokPerSec)}`
            : slot.client
              ? `${slot.client} · ${t(m.slotPrefilling)}`
              : t(m.slotBusy);

        return (
          <div
            className="rounded-lg border border-border/80 bg-background/60 px-2.5 py-2 text-[11px] tabular-nums"
            key={`${slot.model_id}-${slot.id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-medium text-foreground">
                {t(m.slotLabel, { id: slot.id })}
              </span>
              <span className="truncate text-muted-foreground">
                {statusDetail}
              </span>
            </div>
            <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                style={{
                  width: `${cachedPct}%`,
                  backgroundColor: "var(--telemetry-kv)",
                }}
              />
              <span
                style={{
                  width: `${prefillPct}%`,
                  backgroundColor: "var(--telemetry-compute)",
                }}
              />
              <span
                style={{
                  width: `${decodePct}%`,
                  backgroundColor: "var(--telemetry-weights)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RequestLedgerRow({
  isOpen,
  language,
  onToggle,
  request,
}: {
  readonly isOpen: boolean;
  readonly language: Language;
  readonly onToggle: () => void;
  readonly request: SystemTelemetryRequest;
}) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  const stageText =
    request.stage === "queued"
      ? t(m.stageQueued)
      : request.stage === "prefilling"
        ? t(m.stagePrefilling)
        : request.stage === "decoding"
          ? t(m.stageDecoding)
          : t(m.stageCompleted);

  const gw = Math.max(0, request.gateway_ms);
  const pre = Math.max(0, request.prefill_ms);
  const dec = Math.max(0, request.decode_ms);
  const barTotal = Math.max(1, gw + pre + dec);
  const prefixHitPct =
    request.prompt_tokens > 0
      ? Math.round((request.cached_prompt_tokens / request.prompt_tokens) * 100)
      : null;

  return (
    <div className="bg-background/40">
      <button
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        onClick={onToggle}
        type="button"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            className="shrink-0 text-muted-foreground"
            icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
            size={13}
          />
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
              stageBadgeTone(request.stage),
            )}
          >
            {stageText}
          </span>
          <span className="truncate font-medium text-foreground">
            {request.client}
          </span>
          <span className="hidden truncate text-muted-foreground sm:inline">
            {request.model_name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] tabular-nums text-muted-foreground">
          <span>
            {t(m.requestTtft, {
              value: formatMs(request.ttft_ms, language),
            })}
          </span>
          <span>
            {formatInteger(request.decoded_tokens, language)} {t(m.tokensUnit)}
          </span>
          <span className="w-18 text-right font-semibold text-foreground">
            {request.live_decode_tok_s != null && request.live_decode_tok_s > 0
              ? `${formatRate(request.live_decode_tok_s, language)} ${t(m.tokPerSec)}`
              : t(m.unavailableValue)}
          </span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen ? (
          <motionElem.div
            animate={{ opacity: 1, y: 0 }}
            className="border-t border-border/60 bg-muted/30 px-3 py-2.5 text-[11px] tabular-nums"
            data-request-waterfall={request.id}
            exit={{ opacity: 0, y: -2 }}
            initial={
              reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -2 }
            }
            transition={{ duration: reducedMotion ? 0 : 0.14 }}
          >
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {gw > 0 ? (
                <span
                  style={{
                    width: `${(gw / barTotal) * 100}%`,
                    backgroundColor: "var(--telemetry-apps)",
                  }}
                />
              ) : null}
              {pre > 0 ? (
                <span
                  style={{
                    width: `${(pre / barTotal) * 100}%`,
                    backgroundColor: "var(--telemetry-compute)",
                  }}
                />
              ) : null}
              {dec > 0 ? (
                <span
                  style={{
                    width: `${(dec / barTotal) * 100}%`,
                    backgroundColor: "var(--telemetry-weights)",
                  }}
                />
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  {t(m.waterfallGateway)}{" "}
                  <strong className="text-foreground">
                    {formatMs(request.gateway_ms, language)}
                  </strong>
                </span>
                <span>
                  {t(m.waterfallPrefill)}{" "}
                  <strong className="text-foreground">
                    {formatMs(request.prefill_ms, language)}
                  </strong>{" "}
                  ({formatInteger(request.prompt_processed, language)}/
                  {formatInteger(request.prompt_tokens, language)}{" "}
                  {t(m.tokensUnit)})
                </span>
                {prefixHitPct != null ? (
                  <span>
                    {t(m.waterfallPrefixHit)}{" "}
                    <strong className="text-foreground">{prefixHitPct}%</strong>
                  </span>
                ) : null}
              </div>
              <span>
                {t(m.waterfallDecode)}{" "}
                <strong className="text-foreground">
                  {formatMs(request.decode_ms, language)}
                </strong>
                {request.context_used_pct != null
                  ? ` · ${t(m.waterfallContext, {
                      pct: formatInteger(request.context_used_pct, language),
                    })}`
                  : ""}
              </span>
            </div>
          </motionElem.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
