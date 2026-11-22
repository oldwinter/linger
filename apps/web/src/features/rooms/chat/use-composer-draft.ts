import { useEffect, useId, useRef, useState } from "react";

import type { TeamHubMessageSkillReference } from "@/features/teamhub/teamhub-message-content";
import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";
import { translate } from "@/i18n/language";
import type {
  RoomComposerDocumentContext,
  RoomComposerDocumentReference,
} from "../room-drafts";
import { composerMessages } from "./composer.messages";
import type { MessageComposerDraft } from "./message-composer";
import {
  activeDocumentReferences,
  activeSkillReferences,
  type MessageDocumentOption,
  type MessageSkillOption,
} from "./message-composer-references";
import {
  activeMessageMentions,
  formatMentionToken,
  omitDepartedMentions,
} from "./message-mentions";
import type { ComposerVoiceState } from "./use-composer-voice";

export const TEAMHUB_MESSAGE_MAX_LENGTH = 50_000;

export interface ComposerDraftInput {
  agentOptionsReady?: boolean;
  catalogDocumentOptions: MessageDocumentOption[];
  documentOptionsReady?: boolean;
  initialDocumentContexts: RoomComposerDocumentContext[];
  initialDocumentReferences: RoomComposerDocumentReference[];
  initialMentions: TeamHubActorRef[];
  initialSkillReferences: TeamHubMessageSkillReference[];
  initialValue: string;
  mentionOptions: TeamHubActorRef[];
  onDraftStateChange?: (draft: MessageComposerDraft) => void;
  /** Members of the room. When one of them leaves, their mention leaves the draft. */
  roomMemberIds?: ReadonlySet<string>;
  skillOptions: MessageSkillOption[];
  voice: ComposerVoiceState;
}

/**
 * Owns the draft text, its structured references, the editor refs, and the
 * submission flags every other composer hook reads.
 */
export function useComposerDraft({
  agentOptionsReady,
  catalogDocumentOptions,
  documentOptionsReady,
  initialDocumentContexts,
  initialDocumentReferences,
  initialMentions,
  initialSkillReferences,
  initialValue,
  mentionOptions,
  onDraftStateChange,
  roomMemberIds,
  skillOptions,
  voice: { voiceMaterials, voiceMode, voicePrefixRef },
}: ComposerDraftInput) {
  const [body, setBody] = useState(initialValue);
  const bodyRef = useRef(initialValue);
  const visibleBody = voiceMode.entered ? voicePrefixRef.current : body;
  const [resolvedDocumentOptions, setResolvedDocumentOptions] = useState<
    MessageDocumentOption[]
  >([]);
  const documentOptions = [
    ...catalogDocumentOptions,
    ...resolvedDocumentOptions.filter(
      (resolved) =>
        !catalogDocumentOptions.some(
          (catalog) => catalog.documentId === resolved.documentId,
        ),
    ),
  ];
  const [documentContexts, setDocumentContexts] = useState(
    initialDocumentContexts,
  );
  const lengthStatusId = useId();
  const isComposing = useRef(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [resolvingDocumentLinks, setResolvingDocumentLinks] = useState(0);
  const resolvingDocumentLinksRef = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const selectedMentionsRef = useLazyRef(() =>
    activeMessageMentions(initialValue, initialMentions),
  );
  const selectedDocumentsRef = useLazyRef(() =>
    activeDocumentReferences(initialValue, initialDocumentReferences),
  );
  const selectedSkillsRef = useLazyRef(() =>
    activeSkillReferences(
      initialValue,
      initialSkillReferences,
      selectedMentionsRef.current,
    ),
  );
  const highlightContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const currentReferences = resolveReferences(body);
  const memberKey = roomMemberIds
    ? [...roomMemberIds].sort().join("\0")
    : undefined;
  useEffect(() => {
    if (!roomMemberIds || voiceMode.entered || submitting) return;
    const current = bodyRef.current;
    const caret = textareaRef.current?.selectionStart ?? current.length;
    const next = omitDepartedMentions(
      current,
      selectedMentionsRef.current,
      roomMemberIds,
      caret,
    );
    if (next.body === current) return;
    pendingCaretRef.current = next.caret;
    updateBody(next.body);
    // memberKey is the membership. updateBody reads the latest draft refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- membership is the trigger
  }, [memberKey]);

  function updateBody(
    nextBody: string,
    nextDocumentContexts = documentContexts,
    nextDocumentOptions = documentOptions,
  ) {
    bodyRef.current = nextBody;
    setBody(nextBody);
    setMessageError(
      nextBody.length > TEAMHUB_MESSAGE_MAX_LENGTH
        ? messageLengthError()
        : null,
    );
    const { documentReferences, selectedMentions, skillReferences } =
      resolveReferences(nextBody, nextDocumentOptions);
    // Unavailable mentions stay selected so a later send still blocks on them
    // instead of silently sending the token as plain text.
    selectedMentionsRef.current = selectedMentions;
    selectedDocumentsRef.current = documentReferences;
    selectedSkillsRef.current = skillReferences;
    onDraftStateChange?.({
      ...(voiceMaterials?.materials.length
        ? { voiceMaterials: voiceMaterials.materials }
        : {}),
      documentContexts: nextDocumentContexts,
      body: nextBody,
      documentReferences,
      mentions: selectedMentions,
      skillReferences,
    });
  }

  function resolveReferences(
    nextBody: string,
    nextDocumentOptions = documentOptions,
  ) {
    return resolveAvailableComposerReferences({
      body: nextBody,
      agentOptionsReady,
      documentOptions: nextDocumentOptions,
      documentOptionsReady,
      documentReferences: selectedDocumentsRef.current,
      mentionOptions,
      mentions: selectedMentionsRef.current,
      skillOptions,
      skillReferences: selectedSkillsRef.current,
    });
  }

  return {
    body,
    bodyRef,
    currentReferences,
    documentContexts,
    documentOptions,
    highlightContentRef,
    isComposing,
    lengthStatusId,
    messageError,
    pendingCaretRef,
    resolveReferences,
    resolvingDocumentLinks,
    resolvingDocumentLinksRef,
    selectedDocumentsRef,
    selectedMentionsRef,
    selectedSkillsRef,
    setDocumentContexts,
    setMessageError,
    setResolvedDocumentOptions,
    setResolvingDocumentLinks,
    setSubmitting,
    submitting,
    textareaRef,
    updateBody,
    visibleBody,
  };
}

export type ComposerDraft = ReturnType<typeof useComposerDraft>;

export type ComposerReferences = ReturnType<
  typeof resolveAvailableComposerReferences
>;

export function messageLengthError() {
  return translate(composerMessages.messageTooLong, {
    limit: TEAMHUB_MESSAGE_MAX_LENGTH,
  });
}

/** Names unavailable mentions; `nextStep` tells the user how to proceed. */
export function unavailableMentionsError(
  mentions: TeamHubActorRef[],
  nextStep: "remove" | "review",
) {
  return translate(
    nextStep === "remove"
      ? composerMessages.unavailableMentionsRemove
      : composerMessages.unavailableMentionsReview,
    {
      count: mentions.length,
      names: mentions
        .map(formatMentionToken)
        .join(translate(composerMessages.listSeparator)),
    },
  );
}

export function findDocumentOption(
  reference: RoomComposerDocumentReference,
  documentOptions: MessageDocumentOption[],
) {
  return documentOptions.find(
    (option) => option.documentId === reference.documentId,
  );
}

function useLazyRef<T>(initialize: () => T) {
  // A state initializer runs exactly once without mutating a ref during render,
  // which keeps the deferred construction this hook exists for.
  const [ref] = useState(() => ({ current: initialize() }));
  return ref;
}

function resolveAvailableComposerReferences({
  agentOptionsReady,
  body,
  documentOptions,
  documentOptionsReady,
  documentReferences,
  mentionOptions,
  mentions,
  skillOptions,
  skillReferences,
}: {
  agentOptionsReady?: boolean;
  body: string;
  documentOptions: MessageDocumentOption[];
  documentOptionsReady?: boolean;
  documentReferences: RoomComposerDocumentReference[];
  mentionOptions: TeamHubActorRef[];
  mentions: TeamHubActorRef[];
  skillOptions: MessageSkillOption[];
  skillReferences: TeamHubMessageSkillReference[];
}) {
  let pendingAvailability = false;
  const activeMentions = activeMessageMentions(body, mentions);
  const unavailableMentions: TeamHubActorRef[] = [];
  const availableMentions = activeMentions.filter((mention) => {
    // Identity is the actor, not its display name: a rename after the pick
    // keeps the selected mention, whose token is the one in the body.
    const current = mentionOptions.some(
      (option) =>
        option.id === mention.id && option.tenant_id === mention.tenant_id,
    );
    if (current) return true;
    if (agentOptionsReady === false) pendingAvailability = true;
    if (agentOptionsReady === true) unavailableMentions.push(mention);
    return agentOptionsReady !== true;
  });

  const activeDocuments = activeDocumentReferences(body, documentReferences);
  const availableDocuments = activeDocuments.filter((reference) => {
    if (findDocumentOption(reference, documentOptions)) return true;
    if (documentOptionsReady === false) pendingAvailability = true;
    return documentOptionsReady !== true;
  });

  const activeSkills = activeSkillReferences(
    body,
    skillReferences,
    availableMentions,
  );
  const availableSkills = activeSkills.filter((reference) => {
    const current = skillOptions.some(
      (option) =>
        option.agent.id === reference.target &&
        option.manifestVersion === reference.manifestVersion &&
        option.skillId === reference.skillId,
    );
    if (current) return true;
    if (agentOptionsReady === false) pendingAvailability = true;
    return agentOptionsReady !== true;
  });

  return {
    documentReferences: availableDocuments,
    mentions: availableMentions,
    pendingAvailability,
    selectedMentions: activeMentions,
    skillReferences: availableSkills,
    unavailableMentions,
  };
}
