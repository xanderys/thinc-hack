"use client";
// Planner-side web call with the Marquee intake agent (no form). Needs `npm i @elevenlabs/react@1.21.1` in web/.
// Renders nothing without an agent id, so it can sit behind an env flag.
import { useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import type { toHomeInputs, IntakeFacts, InstallerId } from "@/app/start/intake";

export interface MarqueeCallProps {
  agentId?: string; // NEXT_PUBLIC_ELEVENLABS_AGENT_ID
  installerId: InstallerId;
  // Called once the call is analysed (a few seconds after it ends), from GET /start/lead/<conversation_id>.
  onIntake: (facts: IntakeFacts, inputs: ReturnType<typeof toHomeInputs>, design: unknown) => void;
}

export default function MarqueeCall(props: MarqueeCallProps) {
  if (!props.agentId) return null;
  return (
    <ConversationProvider>
      <Call {...props} agentId={props.agentId} />
    </ConversationProvider>
  );
}

type Line = { who: "Homeowner" | "Rina"; text: string };

function Call({ agentId, installerId, onIntake }: MarqueeCallProps & { agentId: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const onIntakeRef = useRef(onIntake);
  onIntakeRef.current = onIntake;

  const convId = useRef<string | null>(null);

  const fetchLead = async (id: string) => {
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`/start/lead/${id}`, { cache: "no-store" });
      const body = await r.json().catch(() => ({ error: `lead returned ${r.status}` }));
      if (r.status === 202) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
      if (!r.ok) return setError(body.error ?? `lead returned ${r.status}`);
      onIntakeRef.current(body.facts, body.inputs, body.design);
      return setSent(true);
    }
    setError("The call is still being analysed. Try again in a minute.");
  };

  const conversation = useConversation({
    onConnect: ({ conversationId }) => { convId.current = conversationId; },
    onDisconnect: () => { if (convId.current) fetchLead(convId.current); },
    onMessage: ({ message, role }) => {
      const text = message.replace(/\[[^\]]*\]\s*/g, "").trim();
      const who: Line["who"] = role === "user" ? "Homeowner" : "Rina";
      if (text) setLines((l) => [...l, { who, text }].slice(-6));
    },
    onError: (message) => setError(String(message)),
  });

  const live = conversation.status === "connected" || conversation.status === "connecting";

  const toggle = () => {
    if (live) return conversation.endSession();
    setError(null);
    setLines([]);
    setSent(false);
    convId.current = null;
    conversation.startSession({ agentId, connectionType: "webrtc", dynamicVariables: { installer_id: installerId } });
  };

  return (
    <section style={{ borderTop: "1px solid var(--rule, #D6D1C5)", paddingTop: 12 }}>
      <button type="button" onClick={toggle}>
        {live ? "End call" : "Call the homeowner"}
      </button>
      {live && (
        <span style={{ marginLeft: 10, fontSize: 13, color: "var(--ink-2, #4A4C55)" }}>
          {conversation.status === "connecting" ? "Connecting" : conversation.isSpeaking ? "Rina is speaking" : "Listening"}
        </span>
      )}
      {sent && <span style={{ marginLeft: 10, fontSize: 13 }}>Design ready</span>}
      {error && (
        <p role="alert" style={{ fontSize: 13 }}>
          {error} <button type="button" onClick={toggle}>Retry</button>
        </p>
      )}
      {lines.length > 0 && (
        <ol aria-live="polite" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", fontSize: 14 }}>
          {lines.map((l, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              <strong style={{ fontWeight: 600 }}>{l.who}:</strong> {l.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
