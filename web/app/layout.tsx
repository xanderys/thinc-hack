import type { Metadata } from "next";
import localFont from "next/font/local";
import Masthead from "@/components/Masthead";
import "./globals.css";

// All three families are SIL OFL; files copied from the Clase Labs repo.
const sans = localFont({ variable: "--font-sans", display: "swap", src: [
  { path: "../public/fonts/instrument-sans-400.woff2", weight: "400" },
  { path: "../public/fonts/instrument-sans-500.woff2", weight: "500" },
  { path: "../public/fonts/instrument-sans-600.woff2", weight: "600" },
] });
const serif = localFont({ variable: "--font-serif", display: "swap", src: [{ path: "../public/fonts/instrument-serif-400.woff2", weight: "400" }] });
const mono = localFont({ variable: "--font-mono", display: "swap", src: [
  { path: "../public/fonts/ibm-plex-mono-400.woff2", weight: "400" },
  { path: "../public/fonts/ibm-plex-mono-500.woff2", weight: "500" },
] });

export const metadata: Metadata = { title: "Planner", description: "System design from home facts" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <Masthead />
        <main>{children}</main>
      </body>
    </html>
  );
}
