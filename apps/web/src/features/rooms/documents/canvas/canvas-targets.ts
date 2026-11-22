// Where a canvas is delivered. Adding a target only needs an entry here and
// the matching skills/builtin/canvas target guide for the Agent.

import type { Message } from "@/i18n/messages";
import { canvasMessages } from "./canvas.messages";

/**
 * A field of the canvas header. A registered target words its fields with
 * messages; a field read from an unknown target shows its key as it is.
 */
export interface CanvasTargetField {
  key: string;
  label: string | Message<string>;
  placeholder?: string | Message<string>;
}

export interface CanvasTarget {
  id: string;
  label: string;
  fields: CanvasTargetField[];
}

export const canvasTargets: Record<string, CanvasTarget> = {
  gmail: {
    id: "gmail",
    label: "Gmail",
    fields: [
      { key: "to", label: canvasMessages.to, placeholder: "name@example.com" },
      {
        key: "cc",
        label: canvasMessages.cc,
        placeholder: canvasMessages.addRecipients,
      },
      { key: "subject", label: canvasMessages.subject },
    ],
  },
};

/** Fields every canvas shares, whatever its target. */
export const canvasStatusKeys = ["status", "link", "external_id"] as const;
