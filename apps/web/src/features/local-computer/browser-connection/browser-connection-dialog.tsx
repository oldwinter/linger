import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useInRouterContext } from "react-router";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormFeedback } from "@/components/ui/form-feedback";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Select, SelectItem } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubBrowserConnectionStatus } from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { RichMessage, useT } from "@/i18n/use-translation";

import { computersMessages } from "../computers.messages";
import { localComputersQueryOptions } from "../local-computer-queries";
import {
  browserConnectionQueryKey,
  browserConnectionQueryOptions,
  configureBrowserConnection,
  disconnectBrowserConnection,
} from "./browser-connection-api";
import {
  browserConnectionErrorMessage,
  browserConnectionStateCopy,
  PLAYWRIGHT_EXTENSION_URL,
} from "./browser-connection-copy";

type PendingAction = "configure" | "disconnect" | null;

/**
 * Connects browser tools on one of the user's Local Computers to their own
 * Chrome. The pasted token lives only in this component's input state until
 * it is sent; it never enters a Message, Card, query cache, or storage.
 */
export function BrowserConnectionDialog({
  computerId: lockedComputerId,
  onClose,
  reason,
  tenantId,
}: {
  /** Connects only this Computer, such as the one a chat card names. */
  computerId?: string;
  onClose: () => void;
  /** Why the guide opened, such as an Agent waiting for Chrome. */
  reason?: string;
  tenantId: string;
}) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const inventory = useQuery(localComputersQueryOptions(client, tenantId));
  const computers = inventory.data?.items ?? [];
  const [requestedComputerId, setRequestedComputerId] =
    useState(lockedComputerId);
  // A locked Computer never falls back to another one.
  const computer = lockedComputerId
    ? computers.find(({ computer_id }) => computer_id === lockedComputerId)
    : (computers.find(
        ({ computer_id }) => computer_id === requestedComputerId,
      ) ??
      computers.find(({ status }) => status === "online") ??
      computers[0]);
  const online = computer?.status === "online";
  const status = useQuery({
    ...browserConnectionQueryOptions(
      client,
      tenantId,
      computer?.computer_id ?? "",
    ),
    enabled: Boolean(computer && online),
  });
  const [pastedToken, setPastedToken] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  // The error is kept, not its text, so the text follows the language.
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);

  function selectComputer(computerId: string) {
    setRequestedComputerId(computerId);
    setPastedToken("");
    setEditing(false);
    setConfirmingDisconnect(false);
    setFailure(null);
  }

  async function run(
    action: Exclude<PendingAction, null>,
    send: () => Promise<TeamHubBrowserConnectionStatus>,
    onSuccess?: () => void,
  ) {
    if (!computer) return;
    const computerId = computer.computer_id;
    setPending(action);
    setFailure(null);
    try {
      const next = await send();
      queryClient.setQueryData(
        browserConnectionQueryKey(tenantId, computerId),
        next,
      );
      onSuccess?.();
      setEditing(false);
    } catch (error) {
      setFailure({ error });
    } finally {
      setPending(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!computer || pending || !pastedToken.trim()) return;
    const token = pastedToken;
    // Clear the token only after the request succeeds so a transient failure
    // does not force the user to copy it again.
    void run(
      "configure",
      () =>
        configureBrowserConnection(
          client,
          tenantId,
          computer.computer_id,
          token,
        ),
      () => setPastedToken(""),
    );
  }

  function requestClose() {
    if (pending) return;
    setPastedToken("");
    onClose();
  }

  const current = status.data;
  const unsupported = current?.state === "unsupported";
  // A damaged saved connection fails the status read; a new paste replaces it.
  const savedConnectionInvalid =
    status.error instanceof TeamHubError &&
    status.error.code === "BROWSER_CONNECTION_INVALID";
  const showForm =
    online &&
    (status.isSuccess || savedConnectionInvalid) &&
    !unsupported &&
    (editing || !isLinked(current));

  return (
    <ModalDialog
      description={t(computersMessages.connectMyBrowserIntro)}
      onClose={requestClose}
      size="sm"
      title={t(computersMessages.connectMyBrowser)}
    >
      <div className="space-y-5 px-5 py-4">
        {reason ? (
          <p className="text-sm font-medium text-foreground">{reason}</p>
        ) : null}

        {inventory.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(computersMessages.loadingComputers)}
          </p>
        ) : inventory.isError ? (
          <FormFeedback tone="danger">
            {t(computersMessages.cannotLoadComputers)}
          </FormFeedback>
        ) : !computer ? (
          <FormFeedback tone="info">
            {lockedComputerId ? (
              t(computersMessages.computerNoLongerConnected)
            ) : (
              <>
                You don&apos;t have a Local Computer yet. Connect one in{" "}
                <ComputersSettingsLink
                  onNavigate={requestClose}
                  tenantId={tenantId}
                />{" "}
                first. Cloud Computers can&apos;t use your browser.
              </>
            )}
          </FormFeedback>
        ) : (
          <div className="space-y-5">
            {lockedComputerId ? (
              <p className="text-sm text-foreground">
                <RichMessage
                  message={computersMessages.computerNamed}
                  tags={{
                    name: (text) => <span className="font-medium">{text}</span>,
                  }}
                  values={{ computer: computer.display_name }}
                />
              </p>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">
                  {t(computersMessages.computer)}
                </span>
                <Select
                  aria-label={t(computersMessages.computer)}
                  className="ui-field-control w-full text-sm"
                  disabled={pending !== null}
                  onValueChange={selectComputer}
                  value={computer.computer_id}
                >
                  {computers.map((item) => (
                    <SelectItem key={item.computer_id} value={item.computer_id}>
                      {item.status === "online"
                        ? item.display_name
                        : t(computersMessages.computerOfflineOption, {
                            computer: item.display_name,
                          })}
                    </SelectItem>
                  ))}
                </Select>
              </label>
            )}

            <BrowserConnectionStatusSection
              current={current}
              error={status.error}
              loading={online && status.isPending}
              online={online}
            />

            {online &&
            current &&
            !unsupported &&
            isLinked(current) &&
            !editing ? (
              confirmingDisconnect ? (
                <div
                  aria-label="Confirm browser disconnection"
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                >
                  <span className="text-sm text-foreground">
                    Disconnect Chrome?
                  </span>
                  <Button
                    disabled={pending !== null}
                    loading={pending === "disconnect"}
                    onClick={() =>
                      void run("disconnect", () =>
                        disconnectBrowserConnection(
                          client,
                          tenantId,
                          computer.computer_id,
                        ),
                      ).finally(() => setConfirmingDisconnect(false))
                    }
                    tone="danger"
                  >
                    {pending === "disconnect"
                      ? t(computersMessages.disconnecting)
                      : t(computersMessages.disconnect)}
                  </Button>
                  <Button
                    disabled={pending !== null}
                    onClick={() => setConfirmingDisconnect(false)}
                    tone="ghost"
                  >
                    {t(commonMessages.cancel)}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={pending !== null}
                    onClick={() => {
                      setFailure(null);
                      setConfirmingDisconnect(false);
                      setEditing(true);
                    }}
                  >
                    {t(computersMessages.reconfigure)}
                  </Button>
                  <Button
                    disabled={pending !== null}
                    onClick={() => {
                      setFailure(null);
                      setConfirmingDisconnect(true);
                    }}
                    tone="danger"
                  >
                    {t(computersMessages.disconnect)}
                  </Button>
                </div>
              )
            ) : null}

            {showForm ? (
              <form className="space-y-4" onSubmit={submit}>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
                  <li>
                    <RichMessage
                      message={computersMessages.installExtensionStep}
                      tags={{
                        link: (text) => (
                          <a
                            className="inline-flex items-center gap-1 font-medium text-app-link underline-offset-2 hover:underline"
                            href={PLAYWRIGHT_EXTENSION_URL}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {text}
                            <Icon icon={LinkSquare02Icon} size={14} />
                          </a>
                        ),
                      }}
                    />
                  </li>
                  <li>
                    <RichMessage
                      message={computersMessages.copyTokenStep}
                      tags={{
                        code: (text) => (
                          <code className="break-all text-xs">{text}</code>
                        ),
                      }}
                    />
                  </li>
                  <li>{t(computersMessages.pasteTokenStep)}</li>
                </ol>
                <Field
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  data-1p-ignore=""
                  data-lpignore="true"
                  disabled={pending !== null}
                  label={t(computersMessages.extensionToken)}
                  name="playwright-extension-token"
                  onChange={(event) => {
                    setFailure(null);
                    setPastedToken(event.target.value);
                  }}
                  placeholder={t(computersMessages.pasteToken)}
                  spellCheck={false}
                  type="password"
                  value={pastedToken}
                />
                <div className="flex justify-end gap-2">
                  {editing ? (
                    <Button
                      disabled={pending !== null}
                      onClick={() => {
                        setPastedToken("");
                        setEditing(false);
                      }}
                    >
                      {t(commonMessages.cancel)}
                    </Button>
                  ) : null}
                  <Button
                    disabled={pending !== null || !pastedToken.trim()}
                    loading={pending === "configure"}
                    tone="primary"
                    type="submit"
                  >
                    {pending === "configure"
                      ? t(computersMessages.connectingUpToMinute)
                      : t(computersMessages.connect)}
                  </Button>
                </div>
              </form>
            ) : null}

            {failure ? (
              <FormFeedback tone="danger">
                {browserConnectionErrorMessage(failure.error, t)}
              </FormFeedback>
            ) : null}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}

function ComputersSettingsLink({
  onNavigate,
  tenantId,
}: {
  onNavigate: () => void;
  tenantId: string;
}) {
  const inRouter = useInRouterContext();
  const to = `/t/${encodeURIComponent(tenantId)}/settings/computers`;
  const className =
    "font-medium text-app-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (inRouter) {
    return (
      <Link className={className} onClick={onNavigate} to={to}>
        Settings › Computers
      </Link>
    );
  }
  return (
    <a className={className} href={to} onClick={onNavigate}>
      Settings › Computers
    </a>
  );
}

function BrowserConnectionStatusSection({
  current,
  error,
  loading,
  online,
}: {
  current: TeamHubBrowserConnectionStatus | undefined;
  error: unknown;
  loading: boolean;
  online: boolean;
}) {
  const t = useT();
  if (!online) {
    return (
      <FormFeedback tone="info">
        {t(computersMessages.browserComputerOffline)}
      </FormFeedback>
    );
  }
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t(computersMessages.checkingBrowserStatus)}
      </p>
    );
  }
  if (!current) {
    return (
      <FormFeedback tone="danger">
        {browserConnectionErrorMessage(error, t)}
      </FormFeedback>
    );
  }
  return <BrowserConnectionSummary status={current} />;
}

function BrowserConnectionSummary({
  status,
}: {
  status: TeamHubBrowserConnectionStatus;
}) {
  const t = useT();
  const copy = browserConnectionStateCopy(status.state, t);
  return (
    <div className="space-y-2" role="status">
      <StatusPill tone={copy.tone}>{copy.short}</StatusPill>
      <p className="text-sm text-foreground">{copy.label}</p>
      {status.message ? (
        <p className="text-sm text-muted-foreground">{status.message}</p>
      ) : null}
    </div>
  );
}

// A user Chrome connection exists, even when the Computer reports a problem.
function isLinked(status: TeamHubBrowserConnectionStatus | undefined) {
  return status?.mode === "user_chrome";
}
