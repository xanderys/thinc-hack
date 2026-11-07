"""Text-only test call with a simulated homeowner (ElevenLabs agent testing).
Run: python3 voice/simulate.py out.json [widget]   (widget: form answers pre-filled as dynamic variables)"""
import json, sys, time, pathlib
from create_agent import call, HERE

PERSONA = ("You are Mia, a relaxed homeowner near Munich who asked about solar. Answer casually and briefly, a bit vague, "
           "one fact at a time and only when asked. Facts: you own a detached house, about 140 square metres, built 1985. "
           "Four of you live there. Electricity is about 110 euros a month, you do not know kWh. Gas boiler from 2003, "
           "no idea what heating costs. No electric car now, you plan to buy one next year, maybe 12,000 km a year. "
           "Postcode 85579. Nobody is home in the day. Nothing on the roof, no battery, no wallbox. Mostly you want lower bills; maybe 150 euros a month financed would feel fine. Thinking about next spring. "
           "Once, ask roughly what it would cost.")

WIDGET = len(sys.argv) > 2 and sys.argv[2] == "widget"
FORM_VARS = {"installer_id": "2a8ba8e2", "first_name": "Mia", "postcode": "85579", "house_type": "detached", "people": "4",
             "monthly_bill_eur": "125", "kwh_estimate": "4100", "heating": "Gas", "ev": "planned", "interests": "solar, battery",
             "first_question": "Roughly how big is the house inside, and when was it built?"}
if WIDGET:
    PERSONA = ("You are Mia, a relaxed homeowner who just filled in a solar form (postcode, house type, people, bill, heating, EV) "
               "and is now on the call. Answer casually and briefly, only what is asked. Facts: about 140 square metres, built 1985. "
               "Nobody is home in the day. The kWh figure sounds about right, you do not know your own. Gas boiler from 2003, "
               "about 1,800 euros a year for gas. EV planned next year, maybe 12,000 km a year. Nothing installed. "
               "Mostly you want lower bills; about 150 euros a month financed would feel fine. Next spring. "
               "If asked something you already put in the form, say so with mild surprise.")

state = json.loads((HERE / "agent.json").read_text())
test_id = call("POST", "/v1/convai/agent-testing/create", {
    "name": "Marquee intake: widget, form pre-filled" if WIDGET else "Marquee intake: chill family of four",
    "type": "simulation",
    "simulation_scenario": PERSONA,
    "simulation_max_turns": 30,
    **({"dynamic_variables": FORM_VARS} if WIDGET else {}),
    "success_conditions": (["The agent never asks again for the postcode, house type, number of people, monthly bill, heating type or whether there is an electric car.",
                            "The agent asks about living space, build year, daytime presence, heating age, EV mileage, existing installations, priority, monthly payment and timeline, then calls submit_intake."] if WIDGET else []) + ["The agent calls submit_intake with the household, bill, heating, EV plan and preference.",
                           "The agent gives no price quote."],
    "tool_mock_config": {"mocking_strategy": "selected", "mocked_tool_ids": [state["tool_id"]], "fallback_strategy": "raise_error"},
    "tool_mock_overrides": {state["tool_id"]: [{"mock_result": "Sent to the planner.", "parameter_conditions": [], "is_error": False}]},
})["id"]
inv = call("POST", f"/v1/convai/agents/{state['agent_id']}/run-tests", {"tests": [{"test_id": test_id}]})
while inv["test_runs"][0]["status"] == "pending":
    time.sleep(5)
    inv = call("GET", f"/v1/convai/test-invocations/{inv['id']}")
run = inv["test_runs"][0]
pathlib.Path(sys.argv[1]).write_text(json.dumps(run, indent=2))
print("status:", run["status"])
for t in run.get("agent_responses") or []:
    print(f"{t.get('role')}: {t.get('message') or ''}")
    for c in t.get("tool_calls") or []:
        print("TOOL", c.get("tool_name"), c.get("params_as_json"))
