import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { requireRoomRouteParam } from "./room-route-params";
import {
  roomDocumentsQueryKey,
  roomDocumentsQueryOptions,
} from "./room-queries";
import { canAddDocumentToRoom } from "./room-add-document";

/** Choose documents and bind them into this Room. */
export function RoomAddDocumentPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const roomId = requireRoomRouteParam(params.roomId, "Room");
  const headingId = useId();
  const library = useQuery({
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/library/documents", {
          params: { query: { limit: 50, view: "shareable" } },
        }),
      ),
    queryKey: ["teamhub", tenantId, "shareable-documents", "add-to-room"],
  });
  const roomDocuments = useQuery(
    roomDocumentsQueryOptions(client, tenantId, roomId),
  );
  const [chosen, setChosen] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inRoom = new Set([
    ...(roomDocuments.data?.items.map((document) => document.id) ?? []),
    ...added,
  ]);
  const available = (library.data?.items ?? []).filter(
    (document) => canAddDocumentToRoom(document) && !inRoom.has(document.id),
  );
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredAvailable = normalizedFilter
    ? available.filter((document) =>
        document.title.toLowerCase().includes(normalizedFilter),
      )
    : available;
  const already = (library.data?.items ?? []).filter(
    (document) => canAddDocumentToRoom(document) && inRoom.has(document.id),
  );
  const chat = `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;

  const add = async () => {
    if (pending || chosen.length === 0) return;
    setPending(true);
    setError(null);
    const saved = [...added];
    const toAdd = [...chosen];
    try {
      for (const documentId of toAdd) {
        if (saved.includes(documentId)) {
          setChosen((current) => current.filter((id) => id !== documentId));
          continue;
        }
        await teamHubData(
          client.api.PUT("/v0/rooms/{roomId}/documents/{documentId}", {
            params: { path: { documentId, roomId } },
          }),
        );
        saved.push(documentId);
        setAdded([...saved]);
        setChosen((current) => current.filter((id) => id !== documentId));
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The document could not be added.",
      );
    } finally {
      await queryClient.invalidateQueries({
        queryKey: roomDocumentsQueryKey(tenantId, roomId),
      });
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7"
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <Link
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to={chat}
          >
            <Icon icon={ArrowLeft01Icon} size={14} />
            Back to room
          </Link>
        </div>
        <header>
          <h2 className="text-xl text-foreground" id={headingId}>
            Add a document
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose documents to keep in this room. They stay yours, and the room
            can read them.
          </p>
        </header>
        {library.isPending || roomDocuments.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading documents.
          </p>
        ) : library.isError || roomDocuments.isError ? (
          <div className="flex items-center justify-between gap-3" role="alert">
            <p className="text-sm text-destructive">
              Documents could not be loaded.
            </p>
            <Button
              onClick={() => {
                if (library.isError) void library.refetch();
                if (roomDocuments.isError) void roomDocuments.refetch();
              }}
              size="compact"
              tone="secondary"
              type="button"
            >
              Retry
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            {available.length > 0 || filter ? (
              <label className="block">
                <span className="sr-only">Filter documents</span>
                <input
                  aria-label="Filter documents"
                  className="ui-field-control h-9 w-full text-sm text-foreground placeholder:text-app-placeholder"
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Search documents..."
                  type="search"
                  value={filter}
                />
              </label>
            ) : null}
            {filteredAvailable.length ? (
              <ul className="flex flex-col gap-2">
                {filteredAvailable.map((document) => (
                  <li key={document.id}>
                    <label
                      className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3 text-sm text-foreground"
                      htmlFor={`add-document-${document.id}`}
                    >
                      <input
                        checked={chosen.includes(document.id)}
                        disabled={pending}
                        id={`add-document-${document.id}`}
                        onChange={(event) => {
                          const on = event.target.checked;
                          setChosen((current) =>
                            on
                              ? [...current, document.id]
                              : current.filter((id) => id !== document.id),
                          );
                        }}
                        type="checkbox"
                      />
                      <span>{document.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : available.length ? (
              <p className="text-sm text-muted-foreground" role="status">
                No matching documents.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                No documents left to add.
              </p>
            )}
            {already.length ? (
              <section aria-labelledby="documents-already-in-room">
                <h3
                  className="text-sm text-foreground"
                  id="documents-already-in-room"
                >
                  Already in this room
                </h3>
                <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                  {already.map((document) => (
                    <li key={document.id}>{document.title}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {added.length ? (
              <p className="text-sm text-foreground" role="status">
                {added.length === 1
                  ? "Added 1 document to this room."
                  : `Added ${added.length} documents to this room.`}
              </p>
            ) : null}
            {available.length ? (
              <Button disabled={pending || chosen.length === 0} type="submit">
                {pending ? "Adding" : "Add to this room"}
              </Button>
            ) : null}
          </form>
        )}
      </div>
    </section>
  );
}
