"""Create or update the Marquee intake agent on ElevenLabs. Run: python3 voice/create_agent.py"""
import json, os, pathlib, urllib.request, urllib.error

HERE = pathlib.Path(__file__).parent
API = "https://api.elevenlabs.io"
VOICE_ID = "lcMyyd2HUfFzxdCaC4Ta"  # Lucy, Fresh & Casual (young British female, library voice added as "Rina (Lucy)")
LLM = "claude-haiku-5-5"
FIRST = "Hi, it's Rina from your installer, with a few quick questions for your design. What's the address of the house?"
# No required dynamic variables, so the agent also runs on the ElevenLabs talk-to page. The widget overrides the first
# message and sends the form answers as a contextual update (web/app/start/intake.ts formNote).
ASR_KEYWORDS = ["kilowatt hours", "square metres", "wallbox", "heat pump", "solar", "battery", "boiler", "postcode", "Strasse"]
OVERRIDES = {"conversation_config_override": {"agent": {"first_message": True}}}


def env(name):
    for p in (HERE / ".env", pathlib.Path.home() / ".config/marquee/elevenlabs.env"):
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"')
    return os.environ.get(name)


def key():
    return env("ELEVENLABS_API_KEY")


def step_tool():
    """intake_step: the engine picks the next question. Enabled when voice/.env has INTAKE_STEP_URL and INTAKE_SECRET."""
    fields = json.loads((HERE / "intake_fields.json").read_text())
    facts = {k: {"type": v["type"], "description": v["description"]} for k, v in fields.items() if k not in ("summary", "notes")}
    return {"tool_config": {
        "type": "webhook", "name": "intake_step",
        "description": "Call after every answer with all facts known so far. Returns the next question to ask, or done.",
        "response_timeout_secs": 5, "tool_error_handling_mode": "hide", "pre_tool_speech": "off",
        "api_schema": {
            "url": env("INTAKE_STEP_URL"), "method": "POST",
            "request_headers": {"X-Intake-Secret": env("INTAKE_SECRET")},
            "request_body_schema": {"type": "object", "required": ["lead_id", "facts_so_far"], "properties": {
                "lead_id": {"type": "string", "dynamic_variable": "system__conversation_id"},
                "facts_so_far": {"type": "object", "description": "Every fact known so far, from the note and the call. Leave out unknowns.",
                                 "properties": facts},
            }},
        },
    }}


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"xi-api-key": key(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path}: {e.code} {e.read().decode()[:800]}")


def main():
    state_path = HERE / "agent.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    # Facts are extracted after the call by ElevenLabs data collection (no client tool), so any page can end a call cleanly.
    fields = json.loads((HERE / "intake_fields.json").read_text())
    state.pop("tool_id", None)
    prompt = (HERE / "prompt.md").read_text()
    tool_ids = []
    if env("INTAKE_STEP_URL") and env("INTAKE_SECRET"):
        if state.get("step_tool_id"):
            call("PATCH", f"/v1/convai/tools/{state['step_tool_id']}", step_tool())
        else:
            state["step_tool_id"] = call("POST", "/v1/convai/tools", step_tool())["id"]
        tool_ids = [state["step_tool_id"]]
        prompt += "\n" + (HERE / "prompt_step.md").read_text()

    config = {
        "name": "Marquee intake",
        "conversation_config": {
            "agent": {
                "first_message": FIRST,
                "language": "en",
                "prompt": {
                    "prompt": prompt,
                    "llm": LLM,
                    "temperature": 0.6,
                    "tool_ids": tool_ids,
                    "built_in_tools": {"end_call": {"type": "system", "name": "end_call", "description": "",
                                                    "params": {"system_tool_type": "end_call"}}},
                },
            },
            "tts": {"voice_id": VOICE_ID, "model_id": "eleven_v4_turbo", "stability": 0.4, "similarity_boost": 0.8, "speed": 1.15},
            "conversation": {"max_duration_seconds": 420},
            "asr": {"keywords": ASR_KEYWORDS},
        },
        "platform_settings": {"data_collection": fields, "overrides": OVERRIDES},
    }
    if state.get("agent_id"):
        call("PATCH", f"/v1/convai/agents/{state['agent_id']}", config)
    else:
        state["agent_id"] = call("POST", "/v1/convai/agents/create", config)["agent_id"]
    state.update(voice_id=VOICE_ID, llm=LLM)
    state_path.write_text(json.dumps(state, indent=2) + "\n")
    print(json.dumps(state))


if __name__ == "__main__":
    main()
