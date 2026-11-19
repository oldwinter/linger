import { LinkSquare02Icon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { RoomDocumentCollaborationSession } from "../room-document-collaboration";
import type { RoomDocumentEditor } from "../room-document-comment-schema";
import { type CanvasDocument, canvasText, readCanvas } from "./canvas-document";
import { canvasStatusKeys } from "./canvas-targets";

const agentEditingQuietMs = 3_000;

/**
 * Reads the canvas header block live and tells whether the Agent is writing:
 * Agents edit through the server, so a remote change to an already loaded
 * canvas while no other person is connected to the Document is theirs.
 */
export function useCanvas(
  editor: RoomDocumentEditor,
  awareness: RoomDocumentCollaborationSession["awareness"] | null | undefined,
) {
  const [canvas, setCanvas] = useState(() => readCanvas(editor.document));
  const [agentEditing, setAgentEditing] = useState(false);
  useLayoutEffect(() => {
    setCanvas(readCanvas(editor.document));
    // The initial sync arrives as remote changes too; only content that
    // changes after the canvas has loaded counts as the Agent writing.
    let loaded = readCanvas(editor.document)
      ? JSON.stringify(editor.document)
      : undefined;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = editor.onChange((changed, { getChanges }) => {
      const next = readCanvas(changed.document);
      setCanvas(next);
      const previous = loaded;
      loaded = next ? JSON.stringify(changed.document) : undefined;
      const remote = getChanges().some(
        (change) => change.source.type === "yjs-remote",
      );
      const othersPresent = (awareness?.getStates().size ?? 0) > 1;
      if (!remote || !previous || previous === loaded || othersPresent) return;
      setAgentEditing(true);
      clearTimeout(quiet);
      quiet = setTimeout(() => setAgentEditing(false), agentEditingQuietMs);
    });
    return () => {
      clearTimeout(quiet);
      unsubscribe?.();
    };
  }, [awareness, editor]);
  return { agentEditing, canvas };
}

/** Hides the header code block in the editor; the header shows it instead. */
export function canvasHiddenBlockRule(scope: string, canvas?: CanvasDocument) {
  return canvas
    ? `[data-knowledge-scope=${JSON.stringify(scope)}] .bn-block-outer[data-id=${JSON.stringify(canvas.blockId)}] { display: none; }`
    : "";
}

export function CanvasHeader({
  agentEditing,
  canvas,
  editable,
  editor,
  sender,
}: {
  agentEditing: boolean;
  canvas: CanvasDocument;
  editable: boolean;
  editor: RoomDocumentEditor;
  sender?: ReactNode;
}) {
  const save = (key: string, value: string) => {
    if ((canvas.fields[key] ?? "") === value) return;
    editor.updateBlock(canvas.blockId, {
      content: canvasText({
        ...canvas,
        fields: { ...canvas.fields, [key]: value },
      }),
    });
  };
  const mail = canvas.target.id === "gmail";
  const showAgentEditing = agentEditing && canvas.status !== "sent";
  const fields =
    canvas.target.fields.length > 0
      ? canvas.target.fields
      : Object.keys(canvas.fields)
          .filter(
            (key) => !(canvasStatusKeys as readonly string[]).includes(key),
          )
          .map((key) => ({ key, label: key, placeholder: undefined }));

  return (
    <section
      aria-label={`${canvas.target.label} canvas`}
      className="mb-5"
      data-canvas-target={canvas.target.id}
    >
      {!mail || showAgentEditing ? (
        <div className="flex min-h-8 items-center gap-2 text-xs text-app-muted">
          {canvas.target.id !== "gmail" ? (
            <span className="font-medium text-app-ink">
              {canvas.target.label}
            </span>
          ) : null}
          {!mail ? <CanvasStatus canvas={canvas} /> : null}
          {showAgentEditing ? (
            <span
              className="ml-auto inline-flex items-center gap-1"
              role="status"
            >
              <Icon icon={PencilEdit01Icon} size={14} />
              Agent is editing…
            </span>
          ) : null}
        </div>
      ) : null}
      {mail ? (
        <div className="mb-1 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="canvas-field-subject">
              Subject
            </label>
            <CanvasField
              className="text-[15px] font-semibold"
              editable={editable}
              id="canvas-field-subject"
              onSave={(value) => save("subject", value)}
              placeholder="Subject"
              value={canvas.fields.subject ?? ""}
            />
          </div>
          <span className="shrink-0 text-xs text-app-muted">
            <CanvasStatus canvas={canvas} compact />
          </span>
        </div>
      ) : null}
      <dl>
        {sender ? (
          <div className="flex min-h-11 items-center gap-3">
            <dt className="w-14 shrink-0 text-sm text-app-muted">From</dt>
            <dd className="min-w-0 flex-1 text-sm text-app-ink [overflow-wrap:anywhere]">
              {sender}
            </dd>
          </div>
        ) : null}
        {fields
          .filter((field) => !mail || field.key !== "subject")
          .map((field) => (
            <div
              className={cn(
                "flex items-center gap-3",
                !mail &&
                  "border-b border-app-border transition-colors duration-150 focus-within:border-app-muted/60 motion-reduce:transition-none",
              )}
              key={field.key}
            >
              <dt className="w-14 shrink-0 text-sm text-app-muted">
                <label htmlFor={`canvas-field-${field.key}`}>
                  {field.label}
                </label>
              </dt>
              <dd className="min-w-0 flex-1">
                <CanvasField
                  editable={editable}
                  id={`canvas-field-${field.key}`}
                  onSave={(value) => save(field.key, value)}
                  placeholder={field.placeholder}
                  value={canvas.fields[field.key] ?? ""}
                />
              </dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

function CanvasStatus({
  canvas,
  compact = false,
}: {
  canvas: CanvasDocument;
  compact?: boolean;
}) {
  if (canvas.status === "editing") return null;
  const label = canvas.status === "sent" ? "Sent" : "Draft saved";
  return canvas.link ? (
    <a
      aria-label={label}
      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
      href={canvas.link}
      rel="noreferrer"
      target="_blank"
    >
      <span
        className={compact && canvas.status === "draft" ? "sr-only" : undefined}
      >
        {label}
      </span>
      <Icon icon={LinkSquare02Icon} size={12} />
    </a>
  ) : (
    <span>{label}</span>
  );
}

function CanvasField({
  className = "text-sm",
  editable,
  id,
  onSave,
  placeholder,
  value,
}: {
  className?: string;
  editable: boolean;
  id: string;
  onSave: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  // The Agent may rewrite a field while it is shown; keep what is being typed.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      className={cn(
        "h-11 w-full border-0 bg-transparent text-app-ink outline-none shadow-none focus:outline-none focus:ring-0 placeholder:text-app-placeholder",
        className,
      )}
      id={id}
      onBlur={() => {
        focused.current = false;
        onSave(draft.trim());
      }}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing)
          event.currentTarget.blur();
      }}
      placeholder={editable ? placeholder : "None"}
      readOnly={!editable}
      value={draft}
    />
  );
}
