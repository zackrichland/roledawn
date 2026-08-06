import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mobile landing QA preview",
  robots: { index: false, follow: false },
};

export default function MobileLandingPreviewPage() {
  return (
    <main className="mobile-preview-page">
      <div className="mobile-preview-copy">
        <span className="prototype-badge">Internal QA</span>
        <h1>390 px landing preview</h1>
        <p>The frame creates a real 390 px browsing context so the landing page’s typography, cards, menu, and tactile artwork can be inspected from the desktop test window.</p>
      </div>
      <div className="device-frame">
        <div className="device-frame__speaker" aria-hidden="true" />
        <iframe src="/" title="RoleDawn landing page at 390 pixels wide" />
      </div>
    </main>
  );
}
