"use client";
import { useCallback, useEffect, useState } from "react";
import type { LeadWhatsApp } from "@/lib/api";
import { call, send } from "@/lib/client";

export type WhatsAppPreviewKind = "ask" | "send";
export type WhatsAppPreview = { text: string | null; link: string | null; busy: boolean; error: string | null; retry: () => void };

const textOf = (b: unknown): string | null => {
  if (typeof b === "string") return b;
  if (!b || typeof b !== "object") return null;
  const o = b as { text?: unknown; message?: { text?: unknown }; sent?: { text?: unknown }; whatsapp?: LeadWhatsApp };
  if (typeof o.text === "string") return o.text;
  if (typeof o.message?.text === "string") return o.message.text;
  if (typeof o.sent?.text === "string") return o.sent.text;
  const dry = o.whatsapp?.messages?.filter((m) => m.kind === "dry").at(-1);
  return dry?.text ?? null;
};
const linkOf = (b: unknown): string | null => {
  const o = b as { link?: unknown; sent?: { link?: unknown } } | null;
  return typeof o?.link === "string" ? o.link : typeof o?.sent?.link === "string" ? o.sent.link : null;
};

// Exactly what the engine will send for this lead: its own composed text, with the proposal link on this page's origin.
// GET /api/leads/{id}/whatsapp/preview?kind=ask|send&origin=...; until that route answers, a dry run (composed and logged
// as kind "dry", nothing sent) supplies the text. Shared by the WhatsApp chip and the Offer send sheet.
export function useWhatsAppPreview(leadId: string | null, kind: WhatsAppPreviewKind, enabled = true): WhatsAppPreview {
  const [out, setOut] = useState<{ text: string | null; link: string | null; error: string | null }>({ text: null, link: null, error: null });
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  const retry = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    if (!leadId || !enabled) return;
    let stop = false;
    setBusy(true);
    (async () => {
      const origin = window.location.origin;
      const id = encodeURIComponent(leadId);
      const g = await call<unknown>(`/api/leads/${id}/whatsapp/preview?kind=${kind}&origin=${encodeURIComponent(origin)}`);
      let res: { ok: boolean; body?: unknown; error?: string } = g.ok ? { ok: true, body: g.data } : { ok: false, error: g.error };
      if (!g.ok && (g.status === 404 || g.status === 405)) {
        const d = kind === "ask"
          ? await send<unknown>(`/api/leads/${id}/whatsapp/ask?dry=1`, { dry: true, origin }, "whatsapp-preview")
          : await send<unknown>(`/api/leads/${id}/send?dry=1`, { channel: "whatsapp", dry: true, origin }, "send-preview");
        res = d.ok ? { ok: true, body: d.data } : { ok: false, error: d.error };
      }
      if (stop) return;
      const text = res.ok ? textOf(res.body) : null;
      setOut(res.ok && text ? { text, link: linkOf(res.body), error: null } : { text: null, link: null, error: res.error ?? "The engine returned no message text." });
      setBusy(false);
    })();
    return () => { stop = true; };
  }, [leadId, kind, enabled, n]);

  return { ...out, busy, retry };
}
