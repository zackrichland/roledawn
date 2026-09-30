import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Interface type: Inter is the web fallback behind the SF system stack in
// globals.css (--font-sans). The variable file carries the optical-size axis,
// so headings pick the tighter display cut on their own.
const inter = Inter({
  axes: ["opsz"],
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
});

// Document preview only (--font-document): the résumé and cover-letter pages
// are set in Source Serif 4, the same face as the PDF. Not preloaded, so the
// file downloads only when a page actually shows a document.
const sourceSerif = Source_Serif_4({
  display: "swap",
  preload: false,
  subsets: ["latin", "latin-ext"],
  variable: "--font-source-serif",
  weight: ["400", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: {
    default: "RoleDawn",
    template: "%s | RoleDawn",
  },
  description:
    "RoleDawn finds the jobs that fit you, writes a real application for each one, and applies for you.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#f5f5f7" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${inter.variable} ${sourceSerif.variable}`} lang="en">
      <body>{children}</body>
    </html>
  );
}
