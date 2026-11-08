import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Serif } from "next/font/google";
import Masthead from "@/components/Masthead";
import CopilotShell from "@/components/copilot/CopilotShell";
import "./globals.css";

// Reonic's type: Geist for UI and headings, Geist Mono for figures, Noto Serif used sparingly (all SIL OFL).
const sans = Geist({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"], display: "swap" });
const serif = Noto_Serif({ variable: "--font-serif", subsets: ["latin"], weight: ["400"], display: "swap" });

export const metadata: Metadata = { title: "Planner", description: "System design from home facts" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <Masthead />
        <main>{children}</main>
        <CopilotShell />
      </body>
    </html>
  );
}
