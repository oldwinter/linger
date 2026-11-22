import { RichMessage } from "@/i18n/use-translation";

import { webSearchMessages as m } from "./web-search.messages";

const CODE_TAGS = {
  code: (text: string) => <code className="font-mono">{text}</code>,
};

/** Why no key field shows: the server has nothing to seal keys with. */
export function WebSearchKeysUnavailable() {
  return (
    <p className="text-app-muted">
      <RichMessage message={m.keysUnavailable} tags={CODE_TAGS} />
    </p>
  );
}
