interface DesktopConnectorOAuth {
  prepare(): Promise<string>;
  onReturn(callback: (connectedAccountId?: string) => void): () => void;
}

export function desktopConnectorOAuth() {
  return typeof window === "undefined"
    ? undefined
    : (window as { lingerDesktop?: { connectorOAuth?: DesktopConnectorOAuth } })
        .lingerDesktop?.connectorOAuth;
}
