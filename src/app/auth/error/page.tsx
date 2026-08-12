import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main
      style={{
        alignItems: "center",
        background: "#f7f8f7",
        display: "flex",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "24px",
      }}
    >
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e3e7e5",
          borderRadius: "24px",
          maxWidth: "440px",
          padding: "40px",
          width: "100%",
        }}
      >
        <p
          style={{
            color: "#174a3a",
            fontSize: "14px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            margin: "0 0 24px",
            textTransform: "uppercase",
          }}
        >
          RoleDawn
        </p>
        <h1
          style={{
            color: "#0d1724",
            fontSize: "36px",
            letterSpacing: "-0.04em",
            lineHeight: 1.05,
            margin: "0 0 12px",
          }}
        >
          That sign-in link did not work
        </h1>
        <p
          style={{
            color: "#68717f",
            fontSize: "16px",
            lineHeight: 1.55,
            margin: "0 0 28px",
          }}
        >
          It may be expired or already used. Request a fresh link to continue.
        </p>
        <Link
          href="/login"
          style={{
            background: "#0d1724",
            borderRadius: "12px",
            color: "#ffffff",
            display: "inline-flex",
            fontSize: "16px",
            fontWeight: 700,
            justifyContent: "center",
            minHeight: "52px",
            padding: "0 18px",
            textDecoration: "none",
            alignItems: "center",
          }}
        >
          Request another link
        </Link>
      </section>
    </main>
  );
}
