"use client";

import { useActionState, type CSSProperties } from "react";

import {
  requestMagicLink,
  signInAsLocalTestUser,
  signInWithGoogle,
  type GoogleOAuthActionState,
  type LocalTestLoginActionState,
  type MagicLinkActionState,
} from "@/app/login/actions";

const INITIAL_MAGIC_STATE: MagicLinkActionState = {
  status: "idle",
  message: "",
};

const INITIAL_TEST_STATE: LocalTestLoginActionState = {
  status: "idle",
  message: "",
};

const INITIAL_GOOGLE_STATE: GoogleOAuthActionState = {
  status: "idle",
  message: "",
};

const styles: Record<string, CSSProperties> = {
  page: { alignItems: "center", background: "#f6f7f9", display: "flex", justifyContent: "center", minHeight: "100vh", padding: "24px" },
  card: { background: "#ffffff", border: "1px solid #e2e6ed", borderRadius: "24px", boxShadow: "0 24px 60px rgba(17, 27, 62, 0.08)", maxWidth: "440px", padding: "40px", width: "100%" },
  eyebrow: { color: "#5267bb", fontSize: "14px", fontWeight: 700, letterSpacing: "0.08em", margin: "0 0 24px", textTransform: "uppercase" },
  heading: { color: "#0d1724", fontSize: "36px", letterSpacing: "-0.04em", lineHeight: 1.05, margin: "0 0 12px" },
  copy: { color: "#68717f", fontSize: "16px", lineHeight: 1.55, margin: "0 0 28px" },
  label: { color: "#27323f", display: "block", fontSize: "14px", fontWeight: 650, marginBottom: "8px" },
  input: { border: "1px solid #cfd6d3", borderRadius: "12px", color: "#0d1724", font: "inherit", fontSize: "16px", minHeight: "52px", padding: "0 14px", width: "100%" },
  button: { background: "#0d1724", border: 0, borderRadius: "12px", color: "#ffffff", cursor: "pointer", display: "block", font: "inherit", fontSize: "16px", fontWeight: 700, marginTop: "16px", minHeight: "52px", padding: "15px 18px", textAlign: "center", textDecoration: "none", width: "100%" },
  secondaryButton: { background: "#ffffff", border: "1px solid #cfd6d3", borderRadius: "12px", color: "#0d1724", cursor: "pointer", display: "block", font: "inherit", fontSize: "16px", fontWeight: 700, marginTop: "12px", minHeight: "52px", padding: "14px 18px", textAlign: "center", width: "100%" },
  googleButton: { alignItems: "center", background: "#ffffff", border: "1px solid #cfd6d3", borderRadius: "12px", color: "#0d1724", cursor: "pointer", display: "flex", font: "inherit", fontSize: "16px", fontWeight: 700, gap: "10px", justifyContent: "center", minHeight: "52px", padding: "14px 18px", textAlign: "center", width: "100%" },
  divider: { alignItems: "center", color: "#8a929d", display: "flex", fontSize: "13px", gap: "12px", margin: "20px 0" },
  dividerLine: { background: "#e5e8ec", flex: 1, height: "1px" },
  status: { color: "#4d5967", fontSize: "14px", lineHeight: 1.45, margin: "14px 0 0" },
  note: { borderTop: "1px solid #e8ebe9", color: "#77808c", fontSize: "13px", lineHeight: 1.45, margin: "28px 0 0", paddingTop: "20px" },
  testPanel: { background: "#f3f5fc", border: "1px solid #dce2f5", borderRadius: "16px", marginTop: "24px", padding: "16px" },
  testTitle: { color: "#344b9b", display: "block", fontSize: "14px", marginBottom: "4px" },
  testCopy: { color: "#58646f", fontSize: "13px", lineHeight: 1.45, margin: 0 },
};

export function LoginForm({
  googleSignInAvailable,
  localTestLoginAvailable,
  nextPath,
}: {
  googleSignInAvailable: boolean;
  localTestLoginAvailable: boolean;
  nextPath: string;
}) {
  const [magicState, magicAction, magicPending] = useActionState(requestMagicLink, INITIAL_MAGIC_STATE);
  const [testState, testAction, testPending] = useActionState(signInAsLocalTestUser, INITIAL_TEST_STATE);
  const [googleState, googleAction, googlePending] = useActionState(signInWithGoogle, INITIAL_GOOGLE_STATE);

  return (
    <main style={styles.page}>
      <section aria-labelledby="login-heading" style={styles.card}>
        <p style={styles.eyebrow}>RoleDawn</p>
        <h1 id="login-heading" style={styles.heading}>Sign in to your job search</h1>
        <p style={styles.copy}>
          {googleSignInAvailable
            ? "Continue with Google or use a secure, one-time email link. No password to remember."
            : "Use a secure, one-time email link. No password to remember."}
        </p>

        {googleSignInAvailable ? (
          <>
            <form action={googleAction}>
              <input name="next" type="hidden" value={nextPath} />
              <button disabled={googlePending} style={styles.googleButton} type="submit">
                <span aria-hidden="true">G</span>
                {googlePending ? "Opening Google…" : "Continue with Google"}
              </button>
            </form>
            {googleState.message ? (
              <p aria-live="polite" role="alert" style={styles.status}>{googleState.message}</p>
            ) : null}
          </>
        ) : null}

        {googleSignInAvailable ? (
          <div aria-hidden="true" style={styles.divider}>
            <span style={styles.dividerLine} />
            <span>or</span>
            <span style={styles.dividerLine} />
          </div>
        ) : null}

        <form action={magicAction}>
          <input name="next" type="hidden" value={nextPath} />
          <label htmlFor="email" style={styles.label}>Email address</label>
          <input aria-describedby="login-status" autoComplete="email" autoFocus id="email" inputMode="email" maxLength={254} name="email" placeholder="you@example.com" required style={styles.input} type="email" />
          <button disabled={magicPending} style={styles.button} type="submit">{magicPending ? "Sending…" : "Email me a sign-in link"}</button>
        </form>

        <p aria-live="polite" id="login-status" role={magicState.status === "error" ? "alert" : "status"} style={styles.status}>{magicState.message}</p>

        {localTestLoginAvailable ? (
          <section aria-label="Local database testing" style={styles.testPanel}>
            <strong style={styles.testTitle}>Local database testing</strong>
            <p style={styles.testCopy}>Creates a normal Supabase session for one fixed test candidate. This still exercises RLS and the persistent queue.</p>
            <form action={testAction}>
              <input name="next" type="hidden" value={nextPath} />
              <button disabled={testPending} style={styles.secondaryButton} type="submit">{testPending ? "Opening test candidate…" : "Continue as database test candidate"}</button>
            </form>
            {testState.message ? <p role="alert" style={styles.status}>{testState.message}</p> : null}
          </section>
        ) : null}

        <p style={styles.note}>Your résumé, answers, and applications stay private to your account.</p>
      </section>
    </main>
  );
}
