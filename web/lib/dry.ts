"use client";
import { useEffect, useState } from "react";

// ?dry=1 on the page URL: WhatsApp sends compose and log the message (kind "dry") but send nothing.
export const isDry = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("dry") === "1";

export function useDry() {
  const [dry, setDry] = useState(false);
  useEffect(() => { setDry(isDry()); }, []);
  return dry;
}
