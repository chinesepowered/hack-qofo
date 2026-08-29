import type { Metadata, Viewport } from "next";
import { Baloo_2, JetBrains_Mono, Nunito } from "next/font/google";
import "./globals.css";

/**
 * Fonts are fetched at build time and served from our own origin, so the demo
 * never depends on Google Fonts being reachable from the venue wifi.
 */
const display = Baloo_2({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display-face",
  display: "swap",
});

const body = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-face",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-face",
  display: "swap",
});

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
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
