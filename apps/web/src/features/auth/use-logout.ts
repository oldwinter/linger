import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import {
  deleteRoomDocumentLocalCopies,
  hasUnsavedRoomDocumentChanges,
} from "@/features/rooms/documents/room-document-local-copies";
import {
  clearTeamHubQueries,
  teamHubIdentityQueryOptions,
} from "@/features/rooms/room-queries";
import { teamHubDone } from "@/features/teamhub/teamhub-api";
import {
  announceTeamHubAuthenticationRequired,
  beginTeamHubSignOut,
} from "@/features/teamhub/teamhub-authentication";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { authMessages } from "./auth.messages";
import { safeAuthenticationReturnTo } from "./authentication-return-to";
import { clearInterruptedPage } from "./interrupted-page";

/** The English source; the confirmation itself follows the language on screen. */
export const LOGOUT_UNSAVED_DOCUMENT_MESSAGE =
  authMessages.logoutUnsavedDocuments.source;

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
      const { browserRoomMessageOutbox } =
        await import("@/features/rooms/chat/room-message-outbox");
      await browserRoomMessageOutbox.clearAccount(identity.account.id);
      const endSignOut = beginTeamHubSignOut();
      try {
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
        clearTeamHubQueries(queryClient);
        queryClient.clear();
        const { clearLocalAuthenticatedStorage } =
          await import("./local-authenticated-state");
        clearLocalAuthenticatedStorage();
        // The editors here have unmounted; editors in other tabs close when the
        // deletion reaches them and cannot reopen without the Session. A copy
        // that fails to delete goes at the account's next logout.
        await deleteRoomDocumentLocalCopies({
          actorIds: identity.actors.map((actor) => actor.id),
        }).catch(() => undefined);
        announceTeamHubAuthenticationRequired();
      } finally {
        endSignOut();
      }
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
