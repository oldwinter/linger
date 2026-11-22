import { cn } from "@/lib/cn";
import { BubbleChatIcon } from "@hugeicons/core-free-icons";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import { meetingActionChecklist } from "./meeting-action-checklist";
import { followUpProgress, followUpTexts } from "./meeting-follow-ups";
import type { MeetingOutcome, MeetingTopic } from "./meeting-overview";
import { meetingsExtrasMessages } from "./meetings-extras.messages";
import { meetingsMessages as m } from "./meetings.messages";
import { topicStartSeconds } from "./topic-playback";

/**
 * Topic cards cycle through categorical Nature tints (500 shell at 10%,
 * 700 title); order carries no priority or status.
 */
const topicTints = [
  "bg-bluebell-500/10 text-bluebell-700",
  "bg-rain-500/10 text-rain-700",
  "bg-lichen-500/10 text-lichen-700",
  "bg-sun-500/10 text-sun-700",
  "bg-bubblegum-500/10 text-bubblegum-700",
] as const;

// Section headings and the None observed line stay as the stored page words
// them: they are its fixed format, and the table of contents and section
// links are keyed on them.
/** Shares the knowledge document's column and H2 around these sections. */
const sectionFrame = "mb-3 w-full";
const sectionHeadingText =
  "text-[22px] font-[580] leading-[1.35] tracking-[-0.01em] text-app-ink";
const sectionHeading = cn("mb-2 mt-7", sectionHeadingText);
/** The outcomes H2 sits in a row so Copy actions can share its line. */
const sectionHeadingRow = "mb-2 mt-7 flex items-center justify-between gap-3";

/** Long card text reads better in two columns than three. */
const LONG_TOPIC_TEXT = 120;

/** The topic's clock. With a recording, it starts playback at that moment. */
function TopicTime({
  onPlayTopic,
  topic,
}: {
  onPlayTopic?: (seconds: number) => void;
  topic: MeetingTopic;
}) {
  const time = topic.time;
  if (!time) return null;
  const start = onPlayTopic ? topicStartSeconds(time) : null;
  const className =
    "shrink-0 self-start pt-px text-[12px] font-medium tabular-nums opacity-60";
  if (start === null || !onPlayTopic) {
    return <span className={className}>{time}</span>;
  }
  return (
    <button
      aria-label={`Play ${topic.title} from ${time}`}
      className={`${className} underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      onClick={() => onPlayTopic(start)}
      type="button"
    >
      {time}
    </button>
  );
}

function TopicSpoken({
  lines,
  onRead,
}: {
  lines: string[] | "empty" | "failed" | "loading" | undefined;
  onRead: () => void;
}) {
  return (
    <div className="px-2 pb-1">
      <button
        className="text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onRead}
        type="button"
      >
        {lines && lines !== "loading" ? "Hide what was said" : "What was said"}
      </button>
      {lines === "loading" ? (
        <p className="mt-1 text-xs text-app-muted" role="status">
          Reading the recording.
        </p>
      ) : null}
      {lines === "empty" ? (
        <p className="mt-1 text-xs text-app-muted" role="status">
          Nothing from the recording begins in this stretch.
        </p>
      ) : null}
      {lines === "failed" ? (
        <p className="mt-1 text-xs text-app-danger" role="alert">
          The recording could not be read.
        </p>
      ) : null}
      {Array.isArray(lines) ? (
        <ul aria-label="What was said" className="mt-1 flex flex-col gap-1">
          {lines.map((line, index) => (
            <li
              className="text-xs leading-5 text-app-body"
              key={`${index}-${line}`}
            >
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The Session page's Meeting Summary section, shown in place as one card per
 * topic. The heading matches the knowledge document's H2 around it.
 */
export function MeetingOverviewCard({
  onPlayTopic,
  onReadSpoken,
  topics,
}: {
  /** Starts the recording at a topic. Absent when this meeting has no recording. */
  onPlayTopic?: (seconds: number) => void;
  /** Reads the recording's lines that begin inside a topic's clock. */
  onReadSpoken?: (range: string) => Promise<string[]>;
  topics: MeetingTopic[];
}) {
  const t = useT();
  const [spoken, setSpoken] = useState<
    | { lines: string[] | "empty" | "failed" | "loading"; time: string }
    | undefined
  >();
  const longTopics = topics.some(
    (topic) =>
      (topic.intro ?? "").length +
        topic.points.map((point) => point.text).join("").length >
      LONG_TOPIC_TEXT,
  );
  return (
    <section
      aria-label={t(m.overview)}
      className={cn("@container", sectionFrame)}
    >
      <h2 className={sectionHeading}>
        {t(meetingsExtrasMessages.meetingSummary)}
      </h2>
      <ol
        aria-label={t(m.topics)}
        className={cn(
          "grid grid-cols-1 gap-3 rounded-xl border border-app-border bg-app-surface p-4 md:p-5 @lg:grid-cols-2",
          !longTopics && "@3xl:grid-cols-3",
        )}
      >
        {topics.map((topic, index) => (
          <li
            className={cn(
              "flex flex-col rounded-lg p-1.5",
              topicTints[index % topicTints.length],
            )}
            key={index}
          >
            <div className="flex items-center gap-2 px-2 pb-1.5 pt-1 text-[14px] font-semibold">
              <Icon className="shrink-0" icon={BubbleChatIcon} size={14} />
              <span className="text-xs font-medium tabular-nums opacity-60">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 break-words">{topic.title}</span>
              {topic.time ? (
                <TopicTime onPlayTopic={onPlayTopic} topic={topic} />
              ) : null}
            </div>
            <div className="flex-1 rounded-md bg-app-surface px-3 py-2.5 text-[14px] leading-relaxed text-app-body">
              {topic.intro ? (
                <p className="text-app-muted">
                  <RichText text={topic.intro} />
                </p>
              ) : null}
              {topic.points.length > 0 ? (
                <ul
                  className={cn(
                    "list-disc space-y-1 pl-4 marker:text-app-muted",
                    topic.intro && "mt-1.5",
                  )}
                >
                  {topic.points.map((point, pointIndex) => (
                    <li key={pointIndex}>
                      <RichText text={point.text} />
                      {point.children.length > 0 ? (
                        <ul className="mt-1 list-[circle] space-y-1 pl-4">
                          {point.children.map((child, childIndex) => (
                            <li key={childIndex}>
                              <RichText text={child} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {topic.time && onReadSpoken ? (
              <TopicSpoken
                lines={spoken?.time === topic.time ? spoken.lines : undefined}
                onRead={() => {
                  const time = topic.time;
                  if (!time || !onReadSpoken) return;
                  if (spoken?.time === time && spoken.lines !== "loading") {
                    setSpoken(undefined);
                    return;
                  }
                  setSpoken({ lines: "loading", time });
                  void onReadSpoken(time).then(
                    (lines) =>
                      setSpoken({
                        lines: lines.length > 0 ? lines : "empty",
                        time,
                      }),
                    () => setSpoken({ lines: "failed", time }),
                  );
                }}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The Session page's Keywords as tags. */
export function MeetingKeywords({
  keywords,
  title,
}: {
  keywords: string[];
  title: string;
}) {
  const t = useT();
  return (
    <section aria-label={title} className={sectionFrame}>
      <h2 className={sectionHeading}>{title}</h2>
      <ul className="flex flex-wrap gap-1.5" aria-label={t(m.keywords)}>
        {keywords.map((keyword) => (
          <li
            className="rounded-full border border-app-border bg-app-surface px-2.5 py-0.5 text-[14px] leading-5 text-app-body"
            key={keyword}
          >
            {keyword}
          </li>
        ))}
      </ul>
    </section>
  );
}

const outcomeTints: Record<NonNullable<MeetingOutcome["label"]>, string> = {
  Decision: "border-app-info/30 bg-app-info/10 text-app-info",
  Completed:
    "border-(--app-status-success-border) bg-(--app-status-success-surface) text-(--app-status-success-text)",
  Action:
    "border-(--app-status-warning-border) bg-(--app-status-warning-surface) text-(--app-status-warning-text)",
};

// The stored page marks each entry in English; the tag names its kind in
// the language on screen.
const outcomeNames: Record<
  NonNullable<MeetingOutcome["label"]>,
  Message<string>
> = {
  Decision: m.outcomeDecision,
  Completed: m.outcomeCompleted,
  Action: m.outcomeAction,
};

/**
 * Decisions And Outcomes or Action Items, each entry led by its kind as a
 * tag instead of the `Decision:` / `Completed:` / `Action:` prefix. A Track
 * button stages an Action in the Another Me Chat; a Copy actions button hands
 * the section's Actions to the reader as a checklist. Each is absent without
 * its handler, and Copy actions also without an Action that has text.
 */
export function MeetingOutcomes({
  checks,
  copyStatus,
  onCopyActions,
  onTrack,
  outcomes,
  title,
}: {
  /** Local checks for a to-do list. Decisions stay read-only without this. */
  checks?: {
    checked: ReadonlySet<string>;
    onToggle: (text: string) => void;
    ready: boolean;
  };
  copyStatus?: "copied" | "failed";
  onCopyActions?: (checklist: string) => void;
  onTrack?: (action: string) => void;
  outcomes: MeetingOutcome[];
  title: string;
}) {
  const t = useT();
  const checklist = meetingActionChecklist(outcomes);
  const items = new Set(followUpTexts(outcomes));
  const progress = checks
    ? followUpProgress([...items], [...checks.checked])
    : null;
  return (
    <section aria-label={title} className={sectionFrame}>
      <div className={sectionHeadingRow}>
        <h2 className={sectionHeadingText}>{title}</h2>
        {onCopyActions && checklist ? (
          <Button
            onClick={() => onCopyActions(checklist)}
            size="compact"
            tone="ghost"
          >
            Copy actions
          </Button>
        ) : null}
      </div>
      {copyStatus === "copied" ? (
        <p className="mb-2 text-xs text-app-muted" role="status">
          Copied
        </p>
      ) : null}
      {copyStatus === "failed" ? (
        <p className="mb-2 text-xs text-app-danger" role="alert">
          Copy failed. Select the actions and copy them yourself.
        </p>
      ) : null}
      {progress && progress.total > 0 ? (
        <p className="mb-2 text-sm text-app-muted">
          {progress.done} of {progress.total} done
        </p>
      ) : null}
      {outcomes.length === 0 ? (
        <p className="text-[15px] leading-relaxed text-app-body">
          {t(meetingsExtrasMessages.noneObserved)}
        </p>
      ) : null}
      <ul className="space-y-2.5 text-[15px] leading-relaxed text-app-body">
        {outcomes.map((item, index) => {
          const text = item.text.trim();
          const checkable = checks !== undefined && items.has(text);
          const done = checkable && checks.checked.has(text);
          return (
            <li className="flex items-start gap-2.5" key={index}>
              {checkable ? (
                <input
                  aria-label={text}
                  checked={done}
                  className="mt-1 size-4 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                  disabled={!checks.ready}
                  onChange={() => checks.onToggle(text)}
                  type="checkbox"
                />
              ) : null}
              {item.label ? (
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded-md border px-1.5 text-[12px] font-medium leading-5",
                    outcomeTints[item.label],
                  )}
                >
                  {t(outcomeNames[item.label])}
                </span>
              ) : null}
              <div
                className={cn("min-w-0", done && "text-app-muted line-through")}
              >
                <RichText text={item.text} />
                {item.children.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[14px] text-app-muted marker:text-app-muted">
                    {item.children.map((child, childIndex) => (
                      <li key={childIndex}>
                        <RichText text={child} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {item.label === "Action" && onTrack ? (
                <Button
                  aria-label={`Track action: ${item.text}`}
                  className="ml-auto"
                  onClick={() => onTrack(item.text)}
                  size="compact"
                  tone="ghost"
                >
                  Track
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Plain text with the `**bold**` emphasis the Session page carries. */
function RichText({ text }: { text: string }) {
  return text.split(/\*\*(.+?)\*\*/gu).map((part, index) =>
    index % 2 === 1 ? (
      <strong className="font-semibold text-app-ink" key={index}>
        {part}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
