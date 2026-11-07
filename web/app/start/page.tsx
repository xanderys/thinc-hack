import Start from "./Start";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "agent_4201m6v70wckem7sd6nq4mkt40s4";

export default async function Page({ searchParams }: { searchParams: Promise<{ installer?: string }> }) {
  const { installer } = await searchParams;
  return <Start agentId={AGENT_ID} installerId={installer === "23c108b7" ? "23c108b7" : "2a8ba8e2"} />;
}
