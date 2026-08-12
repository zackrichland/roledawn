import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mobile QA preview",
  robots: { index: false, follow: false },
};

export default function MobilePreviewPage() {
  return (
    <main className="mobile-preview-page">
      <div className="mobile-preview-copy">
        <span className="qa-badge">Internal QA</span>
        <h1>390 px dashboard preview</h1>
        <p>The frame creates a 390 px browsing context for the authenticated queue.</p>
      </div>
      <iframe className="mobile-preview-frame" src="/dashboard" title="RoleDawn candidate queue at 390 pixels wide" />
    </main>
  );
}
