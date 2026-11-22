import {
  ArrowRight02Icon,
  ComputerIcon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormFeedback } from "@/components/ui/form-feedback";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";

import { authMessages as m } from "./auth.messages";
import { AuthShell } from "./auth-shell";
import { safeAuthenticationReturnTo } from "./authentication-return-to";
import {
  type DesktopLocalAccount,
  useDesktopLocalAccount,
} from "./desktop-local-account";
import {
  type AuthenticationResult,
  useTeamHubAuthentication,
} from "./teamhub-authentication";

type AuthenticationController = ReturnType<typeof useTeamHubAuthentication>;

export function TeamHubLoginPage({
  onAuthenticated,
}: {
  onAuthenticated?: (result: AuthenticationResult) => Promise<void> | void;
}) {
  const [searchParams] = useSearchParams();
  const returnTo = safeAuthenticationReturnTo(searchParams.get("return_to"));
  const authentication = useTeamHubAuthentication({
    onAuthenticated,
    returnTo,
  });
  const localAccount = useDesktopLocalAccount();
  const t = useT();
  const authenticationNotice =
    searchParams.get("reason") === "session-expired"
      ? t(m.sessionExpired)
      : null;

  return (
    <AuthShell subtitle={t(m.loginSubtitle)} title={t(m.loginTitle)}>
      {authenticationNotice ? (
        <div className="mb-4">
          <FormFeedback tone="danger">{authenticationNotice}</FormFeedback>
        </div>
      ) : null}
      {localAccount ? (
        <LocalAccountSignIn
          account={localAccount}
          authentication={authentication}
        />
      ) : null}
      <AuthenticationForm authentication={authentication} />
    </AuthShell>
  );
}

function LocalAccountSignIn({
  account,
  authentication,
}: {
  account: DesktopLocalAccount;
  authentication: AuthenticationController;
}) {
  const { isSubmitting, submittingMethod } = authentication.state;
  const desktopSubmitting = submittingMethod === "desktop";
  const t = useT();

  return (
    <div className="auth-local-account">
      <Button
        className="w-full"
        disabled={isSubmitting}
        loading={desktopSubmitting}
        onClick={() => {
          void authentication.signInWithDesktopAccount(account);
        }}
        size="large"
        tone="secondary"
        type="button"
      >
        {desktopSubmitting ? null : <Icon icon={ComputerIcon} size={16} />}
        <span>{t(m.localAccountSignIn)}</span>
      </Button>
      <div className="auth-divider">
        <span />
        <span>{t(m.or)}</span>
        <span />
      </div>
    </div>
  );
}

function AuthenticationForm({
  authentication,
}: {
  authentication: AuthenticationController;
}) {
  const {
    email,
    error,
    fieldErrors,
    isSubmitting,
    password,
    submittingMethod,
  } = authentication.state;
  const { changeField, handleSubmit } = authentication;
  const credentialsSubmitting = submittingMethod === "credentials";
  const formError = !fieldErrors.email && !fieldErrors.password ? error : null;
  const t = useT();

  return (
    <form
      className="auth-form"
      noValidate
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <Field
        autoComplete="email"
        disabled={isSubmitting}
        error={fieldErrors.email}
        label={t(m.email)}
        onChange={(event) => changeField("email", event.target.value)}
        placeholder="you@company.com"
        type="email"
        value={email}
      />
      <PasswordField
        autoComplete="current-password"
        disabled={isSubmitting}
        error={fieldErrors.password}
        label={t(m.password)}
        onChange={(value) => changeField("password", value)}
        value={password}
      />
      {formError ? (
        <FormFeedback tone="danger">{formError}</FormFeedback>
      ) : null}
      <Button
        className="auth-submit w-full"
        disabled={isSubmitting}
        loading={credentialsSubmitting}
        size="large"
        type="submit"
        tone="primary"
      >
        <span>{t(m.logIn)}</span>
        {credentialsSubmitting ? null : (
          <Icon icon={ArrowRight02Icon} size={16} />
        )}
      </Button>
    </form>
  );
}

function PasswordField({
  autoComplete,
  disabled,
  error,
  label,
  onChange,
  value,
}: {
  autoComplete: string;
  disabled?: boolean;
  error?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [visible, setVisible] = useState(false);
  const t = useT();

  return (
    <Field
      autoComplete={autoComplete}
      disabled={disabled}
      error={error}
      label={label}
      onChange={(event) => onChange(event.target.value)}
      suffix={
        <button
          aria-label={t(visible ? m.hidePassword : m.showPassword)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? (
            <Icon icon={ViewOffIcon} size={16} />
          ) : (
            <Icon icon={ViewIcon} size={16} />
          )}
        </button>
      }
      type={visible ? "text" : "password"}
      value={value}
    />
  );
}
