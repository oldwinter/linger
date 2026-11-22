import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  isVoiceDocumentSelection,
  readRoomComposerDraft,
  writeRoomComposerDraft,
  type RoomDraftScope,
  type VoiceDocumentSelection,
} from "../../room-drafts";
import type { TeamHubRoom } from "@/features/teamhub/teamhub-types";
import { translate } from "@/i18n/language";
import { voiceChatMessages as m } from "./voice-chat.messages";

export interface VoiceMaterials {
  /** Room whose next voice turn receives these materials. */
  roomId: string;
  /** False while collecting from another Room: only Message text crosses over. */
  acceptsDocuments: boolean;
  materials: VoiceDocumentSelection[];
  error?: string;
  addSelection: (input: Omit<VoiceDocumentSelection, "id">) => boolean;
  remove: (id: string) => void;
  /** Selections are offered only while Voice Mode is on. */
  voiceModeEntered: boolean;
  setVoiceModeEntered: (entered: boolean) => void;
}

export const VoiceMaterialsContext = createContext<VoiceMaterials | undefined>(
  undefined,
);

/**
 * Voice materials follow the Voice Mode entry: every Room's main composer,
 * group or direct, but not a Thread.
 */
export function roomOffersVoiceMaterials(room: Pick<TeamHubRoom, "kind">) {
  return room.kind !== "thread";
}

interface VoiceMaterialsProviderProps {
  children: ReactNode;
  enabled: boolean;
  scope: RoomDraftScope;
  /**
   * Collects from another Room for a Voice Mode session running in `scope`'s
   * Room: selection is always on and Documents are refused, so no cross-Room
   * Document grant is ever needed.
   */
  remote?: boolean;
}

/** Room-scoped, explicit user selections; never a screen/clipboard collector. */
export function VoiceMaterialsProvider(props: VoiceMaterialsProviderProps) {
  const { scope } = props;
  return (
    <ScopedVoiceMaterialsProvider
      key={`${scope.accountId}/${scope.tenantId}/${scope.roomId}/${props.remote ? "remote" : "local"}`}
      {...props}
    />
  );
}

function ScopedVoiceMaterialsProvider({
  children,
  enabled,
  remote = false,
  scope,
}: VoiceMaterialsProviderProps) {
  const [materials, setMaterials] = useState(
    () => readRoomComposerDraft(scope).voiceMaterials ?? [],
  );
  const materialsRef = useRef(materials);
  const [error, setError] = useState<string>();
  const [voiceModeEntered, setEntered] = useState(false);
  // Away from its Room, the session's direct sender also edits this draft.
  const current = () =>
    remote
      ? (readRoomComposerDraft(scope).voiceMaterials ?? [])
      : materialsRef.current;
  const store = (next: VoiceDocumentSelection[]) => {
    materialsRef.current = next;
    setMaterials(next);
    setError(undefined);
    writeRoomComposerDraft(scope, {
      ...readRoomComposerDraft(scope),
      voiceMaterials: next,
    });
  };
  const value: VoiceMaterials = {
    roomId: scope.roomId,
    acceptsDocuments: !remote,
    materials,
    error,
    addSelection(input) {
      if (!enabled) return false;
      if (remote && input.documentId) {
        setError(translate(m.onlyMessageText));
        return false;
      }
      const selection = {
        ...input,
        quote: input.quote.trim(),
        id:
          globalThis.crypto?.randomUUID?.() ??
          `voice-material-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      };
      if (!isVoiceDocumentSelection(selection)) {
        setError(translate(m.selectionTooLong, { characters: 10_000 }));
        return false;
      }
      const existing = current();
      if (
        existing.some(
          (item) =>
            item.documentId === selection.documentId &&
            item.messageId === selection.messageId &&
            item.versionId === selection.versionId &&
            item.quote === selection.quote,
        )
      )
        return true;
      if (
        existing.length >= 5 ||
        existing.reduce(
          (count, item) => count + item.quote.length,
          selection.quote.length,
        ) > 20_000
      ) {
        setError(
          translate(m.tooManySelections, { characters: 20_000, selections: 5 }),
        );
        return false;
      }
      store([...existing, selection]);
      return true;
    },
    remove(id) {
      store(current().filter((item) => item.id !== id));
    },
    // Collecting for a session in another Room means Voice Mode is on.
    voiceModeEntered: remote || voiceModeEntered,
    setVoiceModeEntered(entered) {
      setEntered(entered);
    },
  };
  return (
    <VoiceMaterialsContext.Provider value={enabled ? value : undefined}>
      {children}
    </VoiceMaterialsContext.Provider>
  );
}

export function useOptionalVoiceMaterials() {
  return useContext(VoiceMaterialsContext);
}
