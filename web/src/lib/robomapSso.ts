/**
 * Client SSO helpers mirroring aeo/src/lib/robomapSso.ts.
 *
 * Flow:
 * 1. beginRobomapSsoHandoff() → /auth/sso/start → api.robomap.ai/auth/sso/handoff?app=payments
 * 2. API redirects back to /login?access_token=...&returnUrl=... (or ?sso=0 if logged out)
 * 3. completeAccessToken() POSTs the token to /api/auth/session (server validates)
 */

export const ROBOMAP_SSO_TRIED = "robomap_sso_tried";
export const SSO_APP = "payments";

export type PaymentsUser = {
  id: string;
  email: string;
  name: string;
  tag?: string | null;
};

/** Sanitize return/callback URL to a same-origin relative path. */
export function sanitizeReturnUrl(raw: string | null | undefined, fallback = "/app"): string {
  if (raw && raw !== "/") {
    if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/auth/")) {
      return fallback;
    }
    return raw;
  }
  return fallback;
}

export function markSsoTried(): void {
  try {
    sessionStorage.setItem(ROBOMAP_SSO_TRIED, "1");
  } catch {
    /* ignore */
  }
}

export function hasTriedSso(): boolean {
  try {
    return sessionStorage.getItem(ROBOMAP_SSO_TRIED) === "1";
  } catch {
    return false;
  }
}

/** Kick off SSO handoff via the payments BFF (keeps app key server-side). */
export function beginRobomapSsoHandoff(returnUrl: string): void {
  if (hasTriedSso()) return;
  markSsoTried();
  const url = new URL("/auth/sso/start", window.location.origin);
  const safe = sanitizeReturnUrl(returnUrl);
  if (safe && safe !== "/") {
    url.searchParams.set("returnUrl", safe);
  }
  window.location.replace(url.toString());
}

/** Strip SSO query params after consume / bounce. */
export function cleanAuthQuery(extraKeys: string[] = []): void {
  const url = new URL(window.location.href);
  ["access_token", "provider", "returnUrl", "registered", "sso", "error", "token", ...extraKeys].forEach(
    (key) => url.searchParams.delete(key),
  );
  const qs = url.searchParams.toString();
  window.history.replaceState({}, "", url.pathname + (qs ? `?${qs}` : "") + url.hash);
}

export async function fetchSessionUser(): Promise<PaymentsUser | null> {
  const res = await fetch("/api/auth/me", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { authenticated?: boolean; user?: PaymentsUser };
  if (!data.authenticated || !data.user?.email) return null;
  return data.user;
}

export async function completeAccessToken(
  accessToken: string,
  returnUrl?: string | null,
): Promise<{ user: PaymentsUser; returnUrl: string }> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      access_token: accessToken,
      returnUrl: sanitizeReturnUrl(returnUrl),
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    user?: PaymentsUser;
    returnUrl?: string;
  };
  if (!res.ok || !payload.user) {
    throw new Error(payload.error || "Sign-in failed");
  }
  markSsoTried();
  return {
    user: payload.user,
    returnUrl: sanitizeReturnUrl(payload.returnUrl || returnUrl),
  };
}

export async function logoutSession(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
}

export function oauthStartPath(provider: "google" | "apple", returnUrl: string): string {
  const url = new URL(`/auth/oauth/${provider}`, window.location.origin);
  const safe = sanitizeReturnUrl(returnUrl);
  if (safe && safe !== "/") url.searchParams.set("returnUrl", safe);
  return url.pathname + url.search;
}
