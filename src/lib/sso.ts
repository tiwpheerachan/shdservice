// Central SSO endpoints (SHD). client_id is public; the API key that authorizes
// the verify call is server-only (CENTRAL_API_KEY).
export const SSO = {
  clientId: process.env.SSO_CLIENT_ID || "cli_168eb7414da1a2e2",
  authorizeUrl: "https://sso.shd-technology.co.th/api/v1/sso/authorize",
  verifyUrl: "https://sso.shd-technology.co.th/api/v1/sso/verify",
  sessionUrl: "https://sso.shd-technology.co.th/api/v1/sso/session",
};

export const STATE_COOKIE = "os_state";
export const DEFAULT_AFTER_LOGIN = "/jobs/dashboard";
