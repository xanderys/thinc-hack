import type { Metadata, Viewport } from "next";
import "./start.css";

export const metadata: Metadata = { title: "Your energy design", description: "A few taps and a short call for your solar design" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// The root layout draws the planner masthead; start.css hides it on this route so the page can be embedded.
export default function StartLayout({ children }: { children: React.ReactNode }) {
  return <div className="start-root">{children}</div>;
}
