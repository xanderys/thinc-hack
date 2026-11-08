// The sheet that opens once a proposal is Complete: who it goes to, the link, the channel, Rina's message, one Send.
// WhatsApp goes through the engine (POST /api/leads/{id}/send {channel}); Email waits for a sender (none is set up);
// SMS has no provider. Copy link copies and changes nothing on the lead. Opens with a spring, crossfades under Reduce Motion.
import { useEffect, useRef, useState } from "react";
import { send } from "@/lib/client";
import s from "./offer.module.css";

type Channel = "whatsapp" | "email" | "link" | "sms";
const CHANNELS: { k: Channel; label: string; off?: string }[] = [
  { k: "whatsapp", label: "WhatsApp" },
  { k: "email", label: "Email", off: "No email sender set up" },
  { k: "link", label: "Copy link" },
  { k: "sms", label: "SMS", off: "No SMS provider" },
];

export function rinaMessage(name: string, brand: string, link: string) {
  const first = name.trim().split(/\s+/)[0] || "there";
  return `Hi ${first}, it's Rina from ${brand}. Your solar proposal is ready: ${link}\nIt shows the system, the price and what it saves you each year. You can sign it there, or reply here with any question.`;
}

export default function SendSheet({ leadId, name, brand, link, onClose, onSent }: {
  leadId: string; name: string; brand: string; link: string; onClose: () => void; onSent: () => void;
}) {
  const [ch, setCh] = useState<Channel>("whatsapp");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "copied">("idle");
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const msg = rinaMessage(name, brand, link);
  // Esc closes the sheet first (capture phase), before the Proposed Design pass or the board hear it.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.stopImmediatePropagation(); e.preventDefault(); onClose(); };
    addEventListener("keydown", esc, true);
    box.current?.focus();
    return () => removeEventListener("keydown", esc, true);
  }, [onClose]);
  const go = async () => {
    setErr(null);
    if (ch === "link") {
      try { await navigator.clipboard.writeText(link); setState("copied"); } catch (e) { setErr(`Could not copy: ${(e as Error).message}`); }
      return;
    }
    setState("busy");
    const r = await send<{ status?: string }>(`/api/leads/${encodeURIComponent(leadId)}/send`, { channel: ch }, `send-${ch}`);
    if (!r.ok) { setState("idle"); setErr(r.error); return; }
    setState("sent"); onSent();
  };
  return (
    <div className={s.sheetWrap} data-esc-first>
      <div className={s.sheetScrim} onClick={onClose} aria-hidden="true" />
      <div ref={box} className={s.sheet} role="dialog" aria-modal="true" aria-label="Send the proposal" tabIndex={-1}>
        <h2 className={s.sheetH}>Send the proposal</h2>
        <p className={s.sheetTo}><b>{name || "Homeowner"}</b> <a href={link} target="_blank" rel="noreferrer">{link.replace(/^https?:\/\//, "")}</a></p>
        {state === "sent" ? (
          <p className={s.sheetDone} role="status">Sent, waiting for the homeowner</p>
        ) : (
          <>
            <div className={s.sheetCh} role="radiogroup" aria-label="Channel">
              {CHANNELS.map((c) => (
                <button key={c.k} type="button" role="radio" aria-checked={ch === c.k} disabled={!!c.off} title={c.off} onClick={() => { setCh(c.k); setState("idle"); setErr(null); }}>{c.label}</button>
              ))}
            </div>
            <p className={s.sheetMsg}>{msg}</p>
            {state === "copied" && <p className={s.sheetDone} role="status">Link copied</p>}
            {err && <p className={s.failS} role="alert">{err}</p>}
          </>
        )}
        <div className={s.sheetGo}>
          <button type="button" className="btn ghost" onClick={onClose}>{state === "sent" ? "Done" : "Close"}</button>
          {state !== "sent" && <button type="button" className="btn" onClick={go} disabled={state === "busy"}>{state === "busy" ? "Sending" : ch === "link" ? "Copy link" : "Send"}</button>}
        </div>
      </div>
    </div>
  );
}
