#!/usr/bin/env bash
# Smoke check through the public URL. Usage: docs/smoke.sh [base_url]
B="${1:-https://marquee-reonic.vercel.app}"
fail=0
step() { if [ "$2" = "ok" ]; then echo "ok   $1"; else echo "FAIL $1: $3"; fail=1; fi; }
J='Content-Type: application/json'
HOME_IN='{"installer_id":"23c108b7","annual_demand_kwh":5000,"load_profile":"H0","has_ev":true,"has_wallbox":false,"heating_type":"Gas","has_solar":false,"has_storage":false}'

for p in / /check; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$B$p")
  [ "$c" = 200 ] && step "GET $p" ok || step "GET $p" bad "HTTP $c"
done

r=$(curl -s -X POST "$B/api/design" -H "$J" -d "{\"inputs\":$HOME_IN}")
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["design"]["pv_kwp"] is not None' 2>/dev/null \
  && step "POST /api/design pv_kwp" ok || step "POST /api/design pv_kwp" bad "$(echo "$r" | head -c 200)"

r=$(curl -s -X POST "$B/api/refine" -H "$J" -d "{\"inputs\":$HOME_IN,\"overrides\":{\"heatpump_kw\":\"include\"}}")
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["design"]["heatpump_kw"]' 2>/dev/null \
  && step "POST /api/refine heatpump include" ok || step "POST /api/refine heatpump include" bad "$(echo "$r" | head -c 200)"

r=$(curl -s -X POST "$B/api/validate" -H "$J" -d "{\"inputs\":$HOME_IN,\"design\":{\"pv_kwp\":8,\"inverter_kw\":8,\"battery_kwh\":25,\"heatpump_kw\":null,\"wallbox_kw\":null}}")
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert any(f["level"]=="implausible" for f in d["flags"])' 2>/dev/null \
  && step "POST /api/validate implausible" ok || step "POST /api/validate implausible" bad "$(echo "$r" | head -c 200)"

r=$(curl -s "$B/api/eval")
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["overall"]["design_match_share"] is not None' 2>/dev/null \
  && step "GET /api/eval design_match_share" ok || step "GET /api/eval design_match_share" bad "$(echo "$r" | head -c 200)"

# Engine v1.3 routes, straight to the engine
E="${ENGINE_URL:-https://xanders-mac-mini.tail3f074b.ts.net:8443}"
r=$(curl -s -X POST "$E/api/ask" -H "$J" -d "{\"inputs\":$HOME_IN}")
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["questions"]' 2>/dev/null \
  && step "engine POST /api/ask question" ok || step "engine POST /api/ask question" bad "$(echo "$r" | head -c 200)"
r=$(curl -s -X POST "$E/api/ask" -H "$J" -d "{\"inputs\":$HOME_IN,\"unknown\":[]}")
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["questions"]==[]' 2>/dev/null \
  && step "engine POST /api/ask empty unknown" ok || step "engine POST /api/ask empty unknown" bad "$(echo "$r" | head -c 200)"
r=$(curl -s "$E/api/inbox?limit=20")
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);d=d if isinstance(d,list) else d.get("rows",d.get("items",[]));assert len(d)==20' 2>/dev/null \
  && step "engine GET /api/inbox 20 rows" ok || step "engine GET /api/inbox 20 rows" bad "$(echo "$r" | head -c 200)"

# Web LLM routes (hero lead read from web/lib/demo.ts)
LEAD=$(python3 -c 'import re,json;print(json.dumps(re.search(r"HERO_LEAD = `(.*?)`",open("web/lib/demo.ts").read(),re.S).group(1)))')
r=$(curl -s -m 60 -X POST "$B/api/read" -H "$J" -d "{\"lead\":$LEAD}")
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["found"] and all(f["quote"] for f in d["found"])' 2>/dev/null \
  && step "POST /api/read found[] with quotes" ok || step "POST /api/read found[] with quotes" bad "$(echo "$r" | head -c 200)"
r=$(curl -s -m 60 -X POST "$B/api/write" -H "$J" -d '{"facts":["PV 7.65 kWp","Battery 10 kWh","Payback 10.6 years"],"mode":"planner"}')
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["grounded"] is True' 2>/dev/null \
  && step "POST /api/write grounded" ok || step "POST /api/write grounded" bad "$(echo "$r" | head -c 200)"
for p in /classic /classic/check; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$B$p")
  [ "$c" = 200 ] && step "GET $p" ok || step "GET $p" bad "HTTP $c"
done

r=$(curl -s "$B/api/inbox?limit=20")
echo "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);d=d if isinstance(d,list) else d.get("rows",d.get("items",[]));assert len(d)==20' 2>/dev/null \
  && step "web GET /api/inbox 20 rows" ok || step "web GET /api/inbox 20 rows" bad "$(echo "$r" | head -c 200)"

exit $fail
