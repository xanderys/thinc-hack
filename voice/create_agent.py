"""Create or update the Marquee intake agent on ElevenLabs. Run: python3 voice/create_agent.py"""
import json, os, pathlib, urllib.request, urllib.error

HERE = pathlib.Path(__file__).parent
API = "https://api.elevenlabs.io"
VOICE_ID = "iP95p4xoKVk53GoZ742B"  # Chris: casual, down-to-earth, conversational
LLM = "claude-haiku-5-5"
FIRST = "Hi, it's Sam from the solar team. I'll ask a few quick things about your home so your planner can sketch a first design. Takes about three minutes, is now okay?"


def key():
    for p in (HERE / ".env", pathlib.Path.home() / ".config/marquee/elevenlabs.env"):
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith("ELEVENLABS_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"')
    return os.environ["ELEVENLABS_API_KEY"]


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
    tool = {"tool_config": json.loads((HERE / "submit_intake.json").read_text())}
    if state.get("tool_id"):
        call("PATCH", f"/v1/convai/tools/{state['tool_id']}", tool)
    else:
        state["tool_id"] = call("POST", "/v1/convai/tools", tool)["id"]

    config = {
        "name": "Marquee intake",
        "conversation_config": {
            "agent": {
                "first_message": FIRST,
                "language": "en",
                "prompt": {
                    "prompt": (HERE / "prompt.md").read_text(),
                    "llm": LLM,
                    "temperature": 0.6,
                    "tool_ids": [state["tool_id"]],
                    "built_in_tools": {"end_call": {"type": "system", "name": "end_call", "description": "",
                                                    "params": {"system_tool_type": "end_call"}}},
                },
            },
            "tts": {"voice_id": VOICE_ID, "model_id": "eleven_v4_turbo", "stability": 0.4, "similarity_boost": 0.8, "speed": 1.0},
            "conversation": {"max_duration_seconds": 420},
        },
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
