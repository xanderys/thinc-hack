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

exit $fail
