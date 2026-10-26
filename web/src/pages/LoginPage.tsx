import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  beginRobomapSsoHandoff,
  cleanAuthQuery,
  completeAccessToken,
  hasTriedSso,
  markSsoTried,
  oauthStartPath,
  sanitizeReturnUrl,
} from "../lib/robomapSso";
import { useAppStore } from "../store";
import { BrandMark } from "../components/Brand";

export function LoginPage() {
  const { user, authReady, setUser } = useAppStore();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = (location.state as { from?: string } | null)?.from;
  const returnUrl = sanitizeReturnUrl(params.get("returnUrl") || params.get("callbackUrl") || fromState);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const consuming = useRef(false);

  useEffect(() => {
    const accessToken = params.get("access_token");
    if (!accessToken || consuming.current) return;
    consuming.current = true;
    setBusy(true);
    completeAccessToken(accessToken, returnUrl)
      .then(({ user: sessionUser, returnUrl: next }) => {
        setUser(sessionUser);
        cleanAuthQuery();
        navigate(next.startsWith("/") ? next : "/app", { replace: true });
      })
      .catch((err: unknown) => {
        cleanAuthQuery();
        setError(err instanceof Error ? err.message : "Sign-in failed");
        setBusy(false);
        setShowForm(true);
      });
  }, [params, returnUrl, navigate, setUser]);

  useEffect(() => {
    if (!authReady || user || busy || consuming.current) return;
    if (params.get("access_token") || params.get("token")) return;
    if (params.get("error")) {
      setError("Sign-in failed. Please try again.");
      setShowForm(true);
      return;
    }
    if (params.get("sso") === "0") {
      markSsoTried();
      cleanAuthQuery(["sso"]);
      setShowForm(true);
      return;
    }
    if (hasTriedSso()) {
      setShowForm(true);
      return;
    }
    beginRobomapSsoHandoff(returnUrl);
  }, [authReady, user, busy, params, returnUrl]);

  if (authReady && user) {
    return <Navigate to={returnUrl} replace />;
  }

  if (!showForm && !error) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <BrandMark />
          <h1>Signing you in</h1>
          <p>Checking your Robomap account…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="brand">
          <BrandMark />
          Robomap Payments
        </Link>
        <h1>Welcome back</h1>
        <p>
          Sign in with the same Robomap account you use on{" "}
          <a href="https://app.robomap.ai/auth/login">app.robomap.ai</a>. If you are already logged
          in there, we will finish signing you in automatically.
        </p>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="form-stack">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={() => {
              try {
                sessionStorage.removeItem("robomap_sso_tried");
              } catch {
                /* ignore */
              }
              beginRobomapSsoHandoff(returnUrl);
            }}
          >
            Continue with Robomap
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={busy}
            onClick={() => {
              window.location.assign(oauthStartPath("google", returnUrl));
            }}
          >
            Continue with Google
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={busy}
            onClick={() => {
              window.location.assign(oauthStartPath("apple", returnUrl));
            }}
          >
            Continue with Apple
          </button>
        </div>
        <p className="auth-note">
          Uses the shared Robomap SSO handoff (<code>app=payments</code>). After the API allowlists
          this app, logged-in users skip this screen.
        </p>
      </div>
    </div>
  );
}
