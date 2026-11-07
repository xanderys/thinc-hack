"""Text-only test call with a simulated homeowner (ElevenLabs agent testing).
Run: python3 voice/simulate.py out.json [plain|dontknow]"""
import json, sys, time, pathlib
from create_agent import call, HERE

KIND = sys.argv[2] if len(sys.argv) > 2 else "plain"
PERSONAS = {
    "plain": ("You are Mia, a relaxed homeowner near Munich. Answer casually and briefly, only what is asked. Postcode 85579, "
              "detached, 140 square metres, four of you, nobody home in the day, about 110 euros a month for electricity, "
              "gas boiler from 2003, about 1,800 euros a year, EV next year at 12,000 km, nothing installed, want lower bills, "
              "150 euros a month financed is fine, next spring. Once, ask roughly what it would cost."),
    "dontknow": ("You are Jay, a busy, impatient homeowner in London (postcode WC2B 6EL), flat, three people, all out at work in the day. "
                 "You pay about 300 pounds a month for electricity. You do NOT know the size of the flat, the heating type, its age "
                 "or its cost: answer 'no idea, mate' to each of those, and if asked a second time or offered options, get annoyed. "
                 "No car, nothing installed, you want independence, as soon as possible. No idea about monthly payment. "
                 "After the recap ask 'is that all?'"),
}
CONDITIONS = {
    "plain": ["The agent gives no price quote.", "The agent ends with a one-sentence recap, says bye and ends the call."],
    "dontknow": ["After any 'don't know' answer the agent moves to a different question, never repeats or rephrases it and never offers options or ranges.",
                 "The agent never asks when the house was built.",
                 "The agent does not apply 37 cent per kWh to pounds.",
                 "The agent ends with a one-sentence recap, says 'Perfect, thanks! Bye bye.' and ends the call."],
}

state = json.loads((HERE / "agent.json").read_text())
test_id = call("POST", "/v1/convai/agent-testing/create", {
    "name": f"Marquee intake: {KIND}",
    "type": "simulation",
    "simulation_scenario": PERSONAS[KIND],
    "simulation_max_turns": 30,
    "success_conditions": CONDITIONS[KIND],
})["id"]
inv = call("POST", f"/v1/convai/agents/{state['agent_id']}/run-tests", {"tests": [{"test_id": test_id}]})
while inv["test_runs"][0]["status"] == "pending":
    time.sleep(5)
    inv = call("GET", f"/v1/convai/test-invocations/{inv['id']}")
run = inv["test_runs"][0]
pathlib.Path(sys.argv[1]).write_text(json.dumps(run, indent=2))
print("status:", run["status"], json.dumps(run.get("condition_result"))[:600])
for t in run.get("agent_responses") or []:
    print(f"{t.get('role')}: {t.get('message') or ''}")
    for c in t.get("tool_calls") or []:
        print("TOOL", c.get("tool_name"), c.get("params_as_json"))
