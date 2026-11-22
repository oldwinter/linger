import { Fragment, useSyncExternalStore, type ReactNode } from "react";

import {
  getTranslation,
  subscribeToLanguage,
  type Translation,
} from "./language";
import {
  formatMessageParts,
  type Message,
  type MessageSource,
  type MessageTags,
  type MessageValues,
} from "./messages";

/** The language on screen; the component renders again when it changes. */
export function useTranslation(): Translation {
  return useSyncExternalStore(
    subscribeToLanguage,
    getTranslation,
    getTranslation,
  );
}

/** `t(message, values)` for the language on screen. */
export function useT() {
  return useTranslation().t;
}

type RichMessageProps<S extends MessageSource> = {
  message: Message<S>;
  /** Wraps the text of each `<name>…</name>` span of the message. */
  tags: Readonly<Record<MessageTags<S>, (text: string) => ReactNode>>;
} & ([keyof MessageValues<S>] extends [never]
  ? { values?: undefined }
  : { values: MessageValues<S> });

/**
 * A message with elements inside the sentence, such as a link or a product
 * name in bold. The translation decides where each span sits.
 */
export function RichMessage<S extends MessageSource>({
  message,
  tags,
  values,
}: RichMessageProps<S>) {
  const { catalog, language } = useTranslation();
  const render: Readonly<
    Record<string, ((text: string) => ReactNode) | undefined>
  > = tags;
  return formatMessageParts(message, language, catalog, values).map(
    (part, index) => (
      <Fragment key={index}>
        {part.tag ? (render[part.tag]?.(part.text) ?? part.text) : part.text}
      </Fragment>
    ),
  );
}
