"""Pull every Marquee intake call (transcript + submitted facts) from ElevenLabs into voice/logs/ (gitignored).
Run: python3 voice/logs.py            (sync all, print a one-line summary per call)
     python3 voice/logs.py <conv_id>  (print that call's transcript)"""
import json, os, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
AGENT = json.loads((HERE / "agent.json").read_text())["agent_id"]
OUT = HERE / "logs"


def key():
    for f in (HERE / ".env", Path.home() / ".config/marquee/elevenlabs.env"):
        if f.exists():
            for line in f.read_text().splitlines():
                if line.startswith("ELEVENLABS_API_KEY="):
                    return line.split("=", 1)[1].strip()
    return os.environ["ELEVENLABS_API_KEY"]


def get(path):
    req = urllib.request.Request("https://api.elevenlabs.io" + path, headers={"xi-api-key": key()})
    return json.load(urllib.request.urlopen(req, timeout=30))


def sync():
    OUT.mkdir(exist_ok=True)
    cursor, rows = None, []
    while True:
        q = f"/v1/convai/conversations?agent_id={AGENT}&page_size=100" + (f"&cursor={cursor}" if cursor else "")
        page = get(q)
        rows += page.get("conversations", [])
        cursor = page.get("next_cursor")
        if not page.get("has_more"):
            break
    for c in rows:
        f = OUT / f"{c['conversation_id']}.json"
        if not f.exists() or c.get("status") != "done":
            f.write_text(json.dumps(get(f"/v1/convai/conversations/{c['conversation_id']}"), indent=1))
        d = json.loads(f.read_text())
        tools = [t for m in d.get("transcript", []) for t in (m.get("tool_calls") or []) if t.get("tool_name") == "submit_intake"]
        when = time.strftime("%d %b %H:%M", time.localtime(c.get("start_time_unix_secs", 0)))
        print(f"{when}  {c['conversation_id']}  {c.get('call_duration_secs', 0):>4}s  {c.get('message_count', 0):>3} turns  intake={'yes' if tools else 'no'}")


def show(cid):
    d = json.loads((OUT / f"{cid}.json").read_text()) if (OUT / f"{cid}.json").exists() else get(f"/v1/convai/conversations/{cid}")
    for m in d.get("transcript", []):
        if m.get("message"):
            print(f"{m['role']:>5}: {m['message']}")
        for t in m.get("tool_calls") or []:
            print(f" tool: {t.get('tool_name')} {t.get('params_as_json', '')}")


if __name__ == "__main__":
    show(sys.argv[1]) if len(sys.argv) > 1 else sync()
