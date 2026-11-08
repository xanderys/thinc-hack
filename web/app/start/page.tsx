import Start from "./Start";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "agent_4201m6v70wckem7sd6nq4mkt40s4";

// ?test=1 marks the lead as a scratch lead (docs/api.md v2.9), left out of the planner inbox.
export default async function Page({ searchParams }: { searchParams: Promise<{ installer?: string; test?: string }> }) {
  const { installer, test } = await searchParams;
  return <Start agentId={AGENT_ID} installerId={installer === "23c108b7" ? "23c108b7" : "2a8ba8e2"} test={test === "1"} />;
}
