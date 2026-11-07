"use client";
// Planner-side web call with the Marquee intake agent (no form). Needs `npm i @elevenlabs/react@1.21.1` in web/.
// Renders nothing without an agent id, so it can sit behind an env flag.
import { useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { formVariables, toHomeInputs, type IntakeFacts, type InstallerId } from "@/app/start/intake";

export interface MarqueeCallProps {
  agentId?: string; // NEXT_PUBLIC_ELEVENLABS_AGENT_ID
  installerId: InstallerId;
  address?: string; // planner's address wins over the one said on the call
  onIntake: (facts: IntakeFacts, inputs: ReturnType<typeof toHomeInputs>) => void;
}

export default function MarqueeCall(props: MarqueeCallProps) {
  if (!props.agentId) return null;
  return (
    <ConversationProvider>
      <Call {...props} agentId={props.agentId} />
    </ConversationProvider>
  );
}

type Line = { who: "Homeowner" | "Sam"; text: string };

function Call({ agentId, installerId, address, onIntake }: MarqueeCallProps & { agentId: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const onIntakeRef = useRef(onIntake);
  onIntakeRef.current = onIntake;

  const conversation = useConversation({
    clientTools: {
      submit_intake: (facts: IntakeFacts) => {
        onIntakeRef.current(facts, toHomeInputs(facts, installerId, address ?? facts.address));
        setSent(true);
        return "Sent to the planner.";
      },
    },
    onMessage: ({ message, role }) => {
      const text = message.replace(/\[[^\]]*\]\s*/g, "").trim();
      const who: Line["who"] = role === "user" ? "Homeowner" : "Sam";
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
    conversation.startSession({ agentId, connectionType: "webrtc", dynamicVariables: formVariables(undefined, installerId) });
  };

  return (
    <section style={{ borderTop: "1px solid var(--rule, #D6D1C5)", paddingTop: 12 }}>
      <button type="button" onClick={toggle}>
        {live ? "End call" : "Call the homeowner"}
      </button>
      {live && (
        <span style={{ marginLeft: 10, fontSize: 13, color: "var(--ink-2, #4A4C55)" }}>
          {conversation.status === "connecting" ? "Connecting" : conversation.isSpeaking ? "Sam is speaking" : "Listening"}
        </span>
      )}
      {sent && <span style={{ marginLeft: 10, fontSize: 13 }}>Facts sent to the planner</span>}
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
