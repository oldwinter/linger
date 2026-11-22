import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WikiProfileEditor } from "./wiki-profile-editor";

const markdown = "# Avery\n\n## Background\n\nAvery leads research.";

function renderEditor(error?: string) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <WikiProfileEditor
      error={error}
      markdown={markdown}
      onCancel={onCancel}
      onSave={onSave}
      pending={false}
    />,
  );
  return { ...view, onCancel, onSave };
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("WikiProfileEditor", () => {
  it("edits the whole Profile Markdown and saves it", () => {
    const { onSave } = renderEditor();
    const text = screen.getByRole("textbox", { name: "Profile Markdown" });
    expect(text).toHaveValue(markdown);
    // Nothing to save until the Markdown changes.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const edited = markdown.replace("research", "research and hiring");
    fireEvent.change(text, { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(edited);
  });

  it("cancels immediately when clean and shows the save error", () => {
    const { onCancel } = renderEditor("Line 3: unknown section.");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Line 3: unknown section.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("warns on beforeunload and confirms before discarding dirty edits on Cancel", () => {
    const { onCancel, unmount } = renderEditor();
    const text = screen.getByRole("textbox", { name: "Profile Markdown" });

    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    const edited = markdown.replace("research", "platform engineering");
    fireEvent.change(text, { target: { value: edited } });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Discard unsaved changes?" }),
    ).toBeNull();
    expect(text).toHaveValue(edited);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const reopened = screen.getByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Discard changes" }),
    );
    expect(onCancel).toHaveBeenCalledOnce();

    unmount();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});
