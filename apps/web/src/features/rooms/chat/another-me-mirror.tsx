import { createContext, useContext, type ReactNode } from "react";

/** The person Another Me wears while their chat is open. */
export interface AnotherMeMirror {
  actorId: string;
  name: string;
}

const AnotherMeMirrorContext = createContext<AnotherMeMirror | undefined>(
  undefined,
);

export function AnotherMeMirrorProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: AnotherMeMirror;
}) {
  return (
    <AnotherMeMirrorContext value={value}>{children}</AnotherMeMirrorContext>
  );
}

export function useAnotherMeMirror() {
  return useContext(AnotherMeMirrorContext);
}
