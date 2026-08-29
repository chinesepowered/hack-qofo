import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CapyGuard — taste-tester for agent skills",
  description:
    "CapyGuard detonates untrusted agent skills and MCP servers in a sandbox, follows every instruction hop, and reports what they actually did — not what they claim to do.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdf7ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1920" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Progressive enhancement: if the network is unavailable at demo time,
            the rounded system-font fallbacks in globals.css take over cleanly. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Nunito:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
