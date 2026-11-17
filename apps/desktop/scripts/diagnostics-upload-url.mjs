// The hosted diagnostics receiver a build carries, from
// LINGER_DIAGNOSTICS_UPLOAD_URL. The release pipeline provides it; forks,
// local builds and self-hosted builds have none, so Send Diagnostics stays
// hidden unless config.json names a receiver. The error never repeats the
// value, which comes from a secret.
export function hostedDiagnosticsUploadUrl(value) {
  const url = value?.trim();
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (parsed?.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error(
      "LINGER_DIAGNOSTICS_UPLOAD_URL must be an https URL without a user name or password",
    );
  return url;
}
