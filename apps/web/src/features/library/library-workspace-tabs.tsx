import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { useT } from "@/i18n/use-translation";

import { libraryMessages as m } from "./library.messages";

/** Each view's texts are messages, worded when they are shown. */
export const workspaceTabs = [
  { empty: m.ownedEmpty, id: "owned", label: m.myPages },
  { empty: m.sharedEmpty, id: "shared", label: m.sharedWithMe },
  { empty: undefined, id: "meetings", label: m.meetings },
] as const;
export type WorkspaceTab = (typeof workspaceTabs)[number]["id"];

export function WorkspaceTabs({
  onChange,
  value,
}: {
  onChange: (tab: WorkspaceTab) => void;
  value: WorkspaceTab;
}) {
  const t = useT();
  return (
    <UnderlineTabs
      items={workspaceTabs.map(({ id, label }) => ({ id, label: t(label) }))}
      label={t(m.libraryViews)}
      onChange={onChange}
      value={value}
    />
  );
}
