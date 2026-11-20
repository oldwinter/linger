import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { browserRoomMessageOutbox } from "@/features/rooms/chat/room-message-outbox";
import {
  deleteRoomDocumentLocalCopies,
  hasUnsavedRoomDocumentChanges,
} from "@/features/rooms/documents/room-document-local-copies";
import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { teamHubDone } from "@/features/teamhub/teamhub-api";
import { announceTeamHubAuthenticationRequired } from "@/features/teamhub/teamhub-authentication";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { safeAuthenticationReturnTo } from "./authentication-return-to";
import { clearInterruptedPage } from "./interrupted-page";
import { clearLocalAuthenticatedState } from "./local-authenticated-state";

export const LOGOUT_ERROR_MESSAGE = "Could not confirm logout. Please retry.";
export const LOGOUT_UNSAVED_DOCUMENT_MESSAGE =
  "Some Document edits are not saved yet. Log out and discard them?";

export interface PendingLogoutConfirmation {
  readonly cancel: () => void;
  readonly confirm: () => void;
}

const confirmationListeners = new Set<() => void>();
let pendingLogoutConfirmation: PendingLogoutConfirmation | null = null;

function setPendingLogoutConfirmation(
  next: PendingLogoutConfirmation | null,
): void {
  if (pendingLogoutConfirmation === next) return;
  pendingLogoutConfirmation = next;
  for (const listener of confirmationListeners) listener();
}

export function subscribeLogoutConfirmation(listener: () => void): () => void {
  confirmationListeners.add(listener);
  return () => {
    confirmationListeners.delete(listener);
  };
}

export function getLogoutConfirmationSnapshot(): PendingLogoutConfirmation | null {
  return pendingLogoutConfirmation;
}

export function useLogout({ returnTo }: { returnTo?: string } = {}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pending = useRef(false);
  const confirmationRef = useRef<PendingLogoutConfirmation | null>(null);
  const [confirmingUnsavedDocuments, setConfirmingUnsavedDocuments] =
    useState(false);

  const mutation = useMutation({
    retry: false,
    mutationFn: async () => {
      const identity = await queryClient.ensureQueryData(
        teamHubIdentityQueryOptions(client),
      );
      await browserRoomMessageOutbox.clearAccount(identity.account.id);
      await teamHubDone(client.api.POST("/v0/auth/logout"));
      clearInterruptedPage();
      const safeReturnTo = safeAuthenticationReturnTo(returnTo ?? null);
      await navigate(
        safeReturnTo
          ? `/login?return_to=${encodeURIComponent(safeReturnTo)}`
          : "/login",
        { replace: true },
      );
      // Let the router unmount protected query consumers before clearing them.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      clearLocalAuthenticatedState(queryClient);
      // The editors here have unmounted; editors in other tabs close when the
      // deletion reaches them and cannot reopen without the Session. A copy
      // that fails to delete goes at the account's next logout.
      await deleteRoomDocumentLocalCopies({
        actorIds: identity.actors.map((actor) => actor.id),
      }).catch(() => undefined);
      announceTeamHubAuthenticationRequired();
    },
    onSettled: () => {
      pending.current = false;
    },
  });

  useEffect(() => {
    return () => {
      if (
        confirmationRef.current &&
        pendingLogoutConfirmation === confirmationRef.current
      ) {
        setPendingLogoutConfirmation(null);
      }
      confirmationRef.current = null;
    };
  }, []);

  function clearConfirmation() {
    if (
      confirmationRef.current &&
      pendingLogoutConfirmation === confirmationRef.current
    ) {
      setPendingLogoutConfirmation(null);
    }
    confirmationRef.current = null;
    setConfirmingUnsavedDocuments(false);
  }

  function runLogout() {
    if (pending.current) return;
    clearConfirmation();
    pending.current = true;
    mutation.mutate();
  }

  return {
    cancelLogout: clearConfirmation,
    confirmLogout: runLogout,
    confirmingUnsavedDocuments,
    error: mutation.error,
    isPending: mutation.isPending,
    mutate: () => {
      if (pending.current) return;
      if (hasUnsavedRoomDocumentChanges()) {
        if (confirmationRef.current) return;
        const request: PendingLogoutConfirmation = {
          cancel: () => clearConfirmation(),
          confirm: () => runLogout(),
        };
        confirmationRef.current = request;
        setConfirmingUnsavedDocuments(true);
        setPendingLogoutConfirmation(request);
        return;
      }
      runLogout();
    },
  };
}
