import { defineMessages } from "@/i18n/messages";

/** Mermaid diagram previews in Files and Documents. */
export const mermaidPreviewMessages = defineMessages("mermaidPreview", {
  sourceTooLarge: "Mermaid source is too large to preview safely.",
  runtimeDidNotLoad: "Mermaid preview runtime did not load in time.",
  timedOut: "Mermaid preview exceeded the execution time limit.",
  outputTooLarge: "Mermaid preview output is too large to display safely.",
  outputNotSanitized: "Mermaid preview output could not be sanitized.",
  zoomToolbar: "Mermaid preview zoom",
  zoomDiagramOut: "Zoom diagram out",
  diagramZoom: "Diagram zoom",
  zoomDiagramIn: "Zoom diagram in",
  fitDiagram: "Fit diagram",
  diagramCanvas: "Diagram canvas",
});
