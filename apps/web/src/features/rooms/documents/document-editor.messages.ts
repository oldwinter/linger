import { defineMessages } from "@/i18n/messages";

/**
 * The Document editor chrome around BlockNote: the editor region, the file
 * panel, the slash menu's Mermaid item, image upload status and the Mermaid
 * code block toolbar. BlockNote's own menus use its bundled dictionary.
 * File names, code and Mermaid error details are data.
 */
export const documentEditorMessages = defineMessages("documentEditor", {
  editor: "Room Document editor",
  loadingEditor: "Loading Room Document editor",
  blockUpdateFailed:
    "The file was uploaded, but the Document block could not be updated. Try inserting it again.",
  uploadFailed: "Document Asset upload failed.",
  assetSizeUnsupported: "Document Asset size is outside the supported range.",
  assetChangedWhileReading: "Document Asset changed while it was being read.",
  upload: "Upload",
  chooseFile: "Choose a file",
  // The slash menu group of the Mermaid item; BlockNote's own group for
  // other blocks is the same word in Chinese, so the two groups merge.
  slashGroupOther: "Other",
  mermaidSubtext: "Create an editable Mermaid diagram",
  mermaidTitle: "Mermaid diagram",
  uploadingFile: "Uploading {filename}",
  loadingFile: "Loading {filename}",
  fileUnavailable: "{filename} is unavailable",
  // The name of a pasted image that has no file name.
  image: "image",
  source: "Source",
  preview: "Preview",
  copySource: "Copy source",
  selectSourceToCopy: "Select source to copy",
  addMermaidSource: "Add Mermaid source to see the diagram.",
  mermaidSourceUnavailable: "Mermaid source is unavailable.",
  mermaidPreview: "Mermaid diagram preview",
  // {message} is the parser's own error text.
  mermaidSyntaxError: "Mermaid syntax error: {message}",
  mermaidSyntaxErrorPlain: "Mermaid syntax error.",
  loadingDocument: "Loading document…",
  embeddedMediaOmitted: "Embedded media omitted.",
  showLess: "Show less",
  viewMore: "View more",
});
