"use client";
// Stub of the copilot shell's useCopilotContext() ({leadId?, name?}); the shell (web/components/copilot) replaces it.
import { useEffect, useState } from "react";

export type CopilotContext = { leadId?: string; name?: string };
const idOf = () => (typeof location !== "undefined" ? location.pathname.match(/^\/h\/([^/]+)/)?.[1] : undefined);

export function useCopilotContext(): CopilotContext {
  const [leadId, setLeadId] = useState<string | undefined>(undefined);
  const [name, setName] = useState<string | undefined>(undefined);
  useEffect(() => {
    const tick = () => setLeadId(idOf() ? decodeURIComponent(idOf()!) : undefined);
    tick(); const iv = setInterval(tick, 300); addEventListener("popstate", tick);
    return () => { clearInterval(iv); removeEventListener("popstate", tick); };
  }, []);
  useEffect(() => {
    setName(undefined); if (!leadId) return; let stop = false;
    fetch(`/api/leads/${encodeURIComponent(leadId)}`).then((r) => r.json()).then((j) => { if (!stop) setName(j?.customer_name); }).catch(() => {});
    return () => { stop = true; };
  }, [leadId]);
  return { leadId, name };
}
