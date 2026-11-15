/**
 * Controls whose own keys win over a page shortcut. A shortcut pressed here
 * would otherwise steal the keystroke while the person types or chooses.
 */
const fieldSelector = [
  "input",
  "textarea",
  "select",
  "dialog",
  "[contenteditable='true']",
  "[role='menu']",
  "[role='listbox']",
  "[role='alertdialog']",
  "[role='dialog']",
].join(", ");

const openOverlaySelector =
  "dialog[open], [role='menu'], [role='listbox'], [role='alertdialog'], [role='dialog']:not(dialog)";

/**
 * Whether a bare key event belongs to the page rather than to a field, a menu,
 * or an open dialog. A chord with any modifier, an IME composition in flight,
 * and an event another control already handled all stay with their owner.
 */
export function isShortcutKeyEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return false;
  }
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable) return false;
    if (target.closest(fieldSelector)) return false;
  }
  return !document.querySelector(openOverlaySelector);
}
