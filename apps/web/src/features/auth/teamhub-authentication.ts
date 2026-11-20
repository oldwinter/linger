import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useReducer, useRef } from "react";
import { useNavigate } from "react-router";

import {
  clearTeamHubQueries,
  teamHubSessionQueryKey,
  teamHubIdentityQueryKey,
} from "@/features/rooms/room-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { announceTeamHubAuthenticated } from "@/features/teamhub/teamhub-authentication";
import { TeamHubError } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubSession } from "@/features/teamhub/teamhub-types";

import { authenticationOperation } from "./authentication-operation";
import type { DesktopLocalAccount } from "./desktop-local-account";
import { takeInterruptedPage } from "./interrupted-page";

export interface AuthenticationResult {
  kind: "login";
  session: TeamHubSession;
}

export type AuthenticationSubmittingMethod = "credentials" | "desktop" | null;

export interface AuthenticationFieldErrors {
  email?: string;
  password?: string;
}

interface AuthenticationState {
  email: string;
  error: string | null;
  fieldErrors: AuthenticationFieldErrors;
  isSubmitting: boolean;
  password: string;
  submittingMethod: AuthenticationSubmittingMethod;
}

type AuthenticationAction =
  | { field: "email" | "password"; type: "change-field"; value: string }
  | {
      error: string;
      fieldErrors: AuthenticationFieldErrors;
      type: "validation-error";
    }
  | { error: string; type: "operation-error" }
  | { type: "submit-finished" }
  | {
      method: Exclude<AuthenticationSubmittingMethod, null>;
      type: "submit-start";
    };

const initialAuthenticationState: AuthenticationState = {
  email: "",
  error: null,
  fieldErrors: {},
  isSubmitting: false,
  password: "",
  submittingMethod: null,
};

function authenticationReducer(
  state: AuthenticationState,
  action: AuthenticationAction,
): AuthenticationState {
  switch (action.type) {
    case "change-field": {
      const fieldErrors = { ...state.fieldErrors };
      delete fieldErrors[action.field];
      return {
        ...state,
        [action.field]: action.value,
        error: null,
        fieldErrors,
      };
    }
    case "validation-error":
      return {
        ...state,
        error: action.error,
        fieldErrors: action.fieldErrors,
      };
    case "operation-error":
      return { ...state, error: action.error, fieldErrors: {} };
    case "submit-start":
      return {
        ...state,
        error: null,
        fieldErrors: {},
        isSubmitting: true,
        submittingMethod: action.method,
      };
    case "submit-finished":
      return { ...state, isSubmitting: false, submittingMethod: null };
  }
}

export function useTeamHubAuthentication(input: {
  onAuthenticated?: (result: AuthenticationResult) => Promise<void> | void;
  returnTo?: string | null;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const activeSubmit = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      activeSubmit.current?.abort();
      activeSubmit.current = null;
    },
    [],
  );
  const [state, dispatch] = useReducer(
    authenticationReducer,
    initialAuthenticationState,
  );

  async function completeAuthentication(signal: AbortSignal) {
    let session: TeamHubSession;
    try {
      session = await authenticationOperation(signal, (signal) =>
        teamHubData(client.api.GET("/v0/session", { signal })),
      );
    } catch (error) {
      if (error instanceof TeamHubError && error.status === 401) {
        throw new TeamHubError({
          code: "SESSION_NOT_ESTABLISHED",
          message:
            "Linger could not establish a browser session. Use the secure workspace address or contact your workspace administrator.",
          status: 401,
        });
      }
      throw error;
    }
    signal.throwIfAborted();
    clearTeamHubQueries(queryClient);
    queryClient.setQueryData(teamHubSessionQueryKey, session);
    queryClient.setQueryData(teamHubIdentityQueryKey, session.identity);
    const result: AuthenticationResult = { kind: "login", session };
    const interrupted = takeInterruptedPage();
    announceTeamHubAuthenticated();
    if (input.onAuthenticated)
      await authenticationOperation(signal, async () =>
        input.onAuthenticated!(result),
      );
    else {
      const tenantId = session.identity.actors[0]?.tenant_id;
      await navigate(
        input.returnTo ??
          interrupted ??
          (tenantId ? `/t/${encodeURIComponent(tenantId)}/rooms` : "/"),
        { replace: true },
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeSubmit.current) return;
    const email = state.email.trim().toLowerCase();
    if (!email) {
      const message = "Enter a valid email address.";
      dispatch({
        error: message,
        fieldErrors: { email: message },
        type: "validation-error",
      });
      return;
    }
    await runAttempt("credentials", async (signal) => {
      await authenticationOperation(signal, (signal) =>
        teamHubData(
          client.api.POST("/v0/auth/login", {
            body: { identifier: email, password: state.password },
            signal,
          }),
        ),
      );
      return true;
    });
  }

  // The desktop app signs this window in with the account of the Linger on
  // this computer and sets the Session cookie; the page only confirms it.
  async function signInWithDesktopAccount(account: DesktopLocalAccount) {
    await runAttempt("desktop", async (signal) => {
      const result = await authenticationOperation(signal, () =>
        account.signIn().catch(() => ({
          message: DESKTOP_ACCOUNT_UNAVAILABLE,
          ok: false as const,
        })),
      );
      if (result.ok) return true;
      dispatch({ error: result.message, type: "operation-error" });
      return false;
    });
  }

  async function runAttempt(
    method: Exclude<AuthenticationSubmittingMethod, null>,
    signIn: (signal: AbortSignal) => Promise<boolean>,
  ) {
    if (activeSubmit.current) return;
    const attempt = new AbortController();
    activeSubmit.current = attempt;
    dispatch({ method, type: "submit-start" });
    try {
      const signedIn = await signIn(attempt.signal);
      attempt.signal.throwIfAborted();
      if (signedIn) await completeAuthentication(attempt.signal);
    } catch (error) {
      if (activeSubmit.current === attempt)
        dispatch({
          error: readAuthenticationError(error),
          type: "operation-error",
        });
    } finally {
      if (activeSubmit.current === attempt) {
        activeSubmit.current = null;
        dispatch({ type: "submit-finished" });
      }
    }
  }

  return {
    changeField: (field: "email" | "password", value: string) =>
      dispatch({ field, type: "change-field", value }),
    handleSubmit,
    signInWithDesktopAccount,
    state,
  };
}

const DESKTOP_ACCOUNT_UNAVAILABLE =
  "This computer's account could not be used. Log in with your email and password.";

function readAuthenticationError(error: unknown) {
  if (error instanceof TeamHubError) return error.message;
  return "TeamHub could not be reached. Try again.";
}
