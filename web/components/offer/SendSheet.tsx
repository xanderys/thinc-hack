// The sheet that opens once a proposal is Complete: who it goes to, the link, the channel, the engine's own message, one Send.
// WhatsApp goes through the engine (POST /api/leads/{id}/send {channel}); Email waits for a sender (none is set up);
// SMS has no provider. Copy link copies the link and tells the engine too, so the lead reads Sent. Opens with a spring, crossfades under Reduce Motion.
import { useEffect, useRef, useState } from "react";
import { call, send } from "@/lib/client";
import { useDry } from "@/lib/dry";
import { useWhatsAppPreview } from "@/components/whatsapp";
import s from "./offer.module.css";

type Channel = "whatsapp" | "email" | "copy" | "sms";
const CHANNELS: { k: Channel; label: string; off?: string }[] = [
  { k: "whatsapp", label: "WhatsApp" },
  { k: "email", label: "Email", off: "No email sender set up" },
  { k: "copy", label: "Copy link" },
  { k: "sms", label: "SMS", off: "No SMS provider" },
];

// The clipboard API first; a hidden textarea with execCommand where the browser refuses it (some embedded views).
async function copyText(x: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(x); return true; } catch { /* fall back */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = x; ta.setAttribute("readonly", ""); Object.assign(ta.style, { position: "fixed", opacity: "0", left: "-9999px" });
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}


export default function SendSheet({ leadId, name, link, version, onClose, onSent }: {
  leadId: string; name: string; link: string; version?: number | null; onClose: () => void; onSent: (version?: number) => void;
}) {
  const [ch, setCh] = useState<Channel>("whatsapp");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "copied">("idle");
  const dry = useDry();   // ?dry=1: the engine composes and logs the message, sends nothing, the lead stays Complete
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [stored, setStored] = useState<string | null>(null);   // the text the engine logged for the last send
  const preview = useWhatsAppPreview(leadId, "send");   // the engine's exact text (a dry run until its preview route lands)
  const msg = stored ?? preview.text;
  const href = preview.link ?? link;
  // Esc closes the sheet first (capture phase), before the Proposed Design pass or the board hear it.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.stopImmediatePropagation(); e.preventDefault(); onClose(); };
    addEventListener("keydown", esc, true);
    box.current?.focus();
    return () => removeEventListener("keydown", esc, true);
  }, [onClose]);
  // Both WhatsApp and Copy link tell the engine (POST /send), so the lead reads Sent either way; a 409 means the lead
  // is no longer Complete (a change after saving) and shows the engine's words.
  const go = async () => {
    setErr(null);
    if (ch === "copy" && !(await copyText(href))) setErr("Could not copy here: select the link above and copy it.");
    setState("busy");
    // The version as the lead holds it now (saving Complete moved it), so base_version never trails a fresh save.
    const cur = await call<{ version?: number }>(`/api/leads/${encodeURIComponent(leadId)}`);
    const base = cur.ok && cur.data.version != null ? cur.data.version : version;
    const r = await send<{ version?: number; status?: string; sent?: { text?: string } }>(`/api/leads/${encodeURIComponent(leadId)}/send`, { channel: ch, ...(base != null ? { base_version: base } : {}), ...(dry ? { dry: true } : {}) }, `send-${ch}`);
    if (!r.ok) { setState("idle"); setErr(r.error); return; }
    if (r.data?.sent?.text) setStored(r.data.sent.text);
    setState(ch === "copy" ? "copied" : "sent");
    if (!dry) onSent(r.data?.version);
  };
  return (
    <div className={s.sheetWrap} data-esc-first>
      <div className={s.sheetScrim} onClick={onClose} aria-hidden="true" />
      <div ref={box} className={s.sheet} role="dialog" aria-modal="true" aria-label="Send the proposal" tabIndex={-1}>
        <h2 className={s.sheetH}>Send the proposal</h2>
        <p className={s.sheetTo}><b>{name || "Homeowner"}</b> <a href={href} target="_blank" rel="noreferrer">{href.replace(/^https?:\/\//, "")}</a></p>
        {state === "sent" ? (
          <p className={s.sheetDone} role="status">{dry ? "Dry run, not sent" : "Sent, waiting for the homeowner"}</p>
        ) : (
          <>
            <div className={s.sheetCh} role="radiogroup" aria-label="Channel">
              {CHANNELS.map((c) => (
                <button key={c.k} type="button" role="radio" aria-checked={ch === c.k} disabled={!!c.off} title={c.off} onClick={() => { setCh(c.k); setState("idle"); setErr(null); }}>{c.label}</button>
              ))}
            </div>
            {msg ? <p className={s.sheetMsg}>{msg}</p>
              : preview.error ? <p className={s.failS} role="alert">{preview.error} <button type="button" className="btn ghost" onClick={preview.retry}>Try again</button></p>
              : <p className={s.sheetMsg} aria-busy="true">&nbsp;</p>}
            {state === "copied" && <p className={s.sheetDone} role="status">{err ? "Marked as sent" : "Link copied"}{dry ? ", dry run, not sent" : ", waiting for the homeowner"}</p>}
            {err && <p className={s.failS} role="alert">{err}</p>}
          </>
        )}
        <div className={s.sheetGo}>
          <button type="button" className="btn ghost" onClick={onClose}>{state === "sent" ? "Done" : "Close"}</button>
          {state !== "sent" && <button type="button" className="btn" onClick={go} disabled={state === "busy"} aria-busy={state === "busy" || undefined}>{ch === "copy" ? "Copy link" : "Send"}</button>}
        </div>
      </div>
    </div>
  );
}
