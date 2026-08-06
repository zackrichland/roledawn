import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mobile QA preview",
  robots: { index: false, follow: false },
};

export default function MobilePreviewPage() {
  return (
    <main className="mobile-preview-page">
      <div className="mobile-preview-copy">
        <span className="prototype-badge">Internal QA</span>
        <h1>390 px dashboard preview</h1>
        <p>The frame creates a real 390 px browsing context so the dashboard’s mobile media queries and bottom navigation can be inspected from the desktop test window.</p>
      </div>
      <div className="device-frame">
        <div className="device-frame__speaker" aria-hidden="true" />
        <iframe src="/dashboard" title="RoleDawn dashboard at 390 pixels wide" />
      </div>
    </main>
  );
}
