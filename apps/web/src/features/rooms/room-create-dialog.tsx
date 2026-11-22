import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { TeamHubError } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomCreateInput } from "@/features/teamhub/teamhub-types";
import { useT } from "@/i18n/use-translation";

import { roomDialogMessages as m } from "./room-dialogs.messages";
import { requireRoomScope, tenantRoomsQueryOptions } from "./room-queries";

export function RoomCreateDialog({
  onClose,
  tenantId,
}: {
  onClose: () => void;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  const serverErrorId = useId();
  const [name, setName] = useState("");
  const createRoom = useMutation({
    mutationFn: (input: TeamHubRoomCreateInput) =>
      teamHubData(
        client.api.POST("/v0/tenants/{tenantId}/rooms", {
          params: { path: { tenantId } },
          body: input,
        }),
      ).then((room) => requireRoomScope(room, tenantId, room.id)),
    onSuccess: async (room) => {
      await queryClient.invalidateQueries({
        queryKey: tenantRoomsQueryOptions(client, tenantId).queryKey,
      });
      onClose();
      await navigate(`/t/${tenantId}/rooms/${room.id}/chat`, {
        state: { newRoomId: room.id },
      });
    },
  });
  // Warn while typing like Slack does, so a duplicate name is caught before
  // submitting; the server ROOM_NAME_TAKEN conflict stays the authority.
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const trimmedName = name.trim();
  const duplicateName =
    trimmedName.length > 0 &&
    (rooms.data?.items ?? []).some(
      (room) =>
        room.kind === "room" &&
        room.name.trim().toLocaleLowerCase() ===
          trimmedName.toLocaleLowerCase(),
    );

  // TeamHub's own message is shown as it is; an unknown outcome is worded here.
  const failure = createRoom.error
    ? createRoom.error instanceof TeamHubError
      ? createRoom.error.message
      : t(m.createUnconfirmed)
    : undefined;
  // Names only have to be unique among the Rooms this Human is in, so the
  // conflicting Room is always one they can see.
  const nameTakenMessage = t(m.nameTaken);
  const fieldError = duplicateName ? nameTakenMessage : undefined;
  const serverFailureMessage = duplicateName
    ? undefined
    : createRoom.error instanceof Error &&
        "code" in createRoom.error &&
        createRoom.error.code === "ROOM_NAME_TAKEN"
      ? nameTakenMessage
      : failure;

  useEffect(() => {
    formRef.current?.querySelector("input")?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (name.trim() && !duplicateName && !createRoom.isPending) {
      const input: TeamHubRoomCreateInput = {
        name: name.trim(),
      };
      createRoom.mutate(input);
    }
  }

  function requestClose() {
    if (!createRoom.isPending) onClose();
  }

  return (
    <ModalDialog
      onClose={requestClose}
      size="md"
      title={t(m.createRoom)}
      footer={
        <Button
          disabled={!trimmedName || duplicateName}
          form={formId}
          loading={createRoom.isPending}
          tone="primary"
          type="submit"
        >
          {t(m.createRoom)}
        </Button>
      }
    >
      <form
        className="px-5 py-4"
        id={formId}
        onSubmit={handleSubmit}
        ref={formRef}
      >
        <Field
          {...(serverFailureMessage
            ? {
                "aria-describedby": serverErrorId,
                "aria-invalid": true,
              }
            : {})}
          disabled={createRoom.isPending}
          error={fieldError}
          label={t(m.roomName)}
          maxLength={120}
          onChange={(event) => {
            if (createRoom.error) createRoom.reset();
            setName(event.target.value);
          }}
          placeholder={t(m.roomName)}
          value={name}
        />

        {serverFailureMessage ? (
          <p
            className="mt-1.5 text-xs text-destructive"
            id={serverErrorId}
            role="alert"
          >
            {serverFailureMessage}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  );
}
