import type { Metadata, Viewport } from "next";
import "./start.css";

export const metadata: Metadata = { title: "Request your solar offer", description: "Name and postcode, then a short call back." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// The root layout draws the planner masthead; start.css hides it on this route so the page can be embedded.
export default function StartLayout({ children }: { children: React.ReactNode }) {
  return <div className="start-root">{children}</div>;
}
