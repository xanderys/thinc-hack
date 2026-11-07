# Marquee intake (voice)

An ElevenLabs agent ("Sam") that runs the planner's first call with the homeowner in the browser, then hands the facts to the planner as engine inputs.

- `SCRIPT.md`: call design. `prompt.md`: system prompt. `submit_intake.json`: the client tool.
- `create_agent.py`: creates or updates tool and agent, writes `agent.json`. Key from `voice/.env` or `~/.config/marquee/elevenlabs.env` (`ELEVENLABS_API_KEY`).
- `simulate.py out.json`: text-only test call with a simulated homeowner, `submit_intake` mocked.
- `MarqueeCall.tsx` + `intake.ts`: the React component and the mapping to `HomeInputs`.

Agent: public, voice Chris, LLM `claude-haiku-5-5`, TTS `eleven_v4_turbo`, calls capped at 7 minutes. Ids in `agent.json`.

## Recreate
```
python3 voice/create_agent.py          # updates in place while agent.json has ids
python3 voice/simulate.py /tmp/sim.json
```

## Wire into web/ (STAGE)
1. `cd web && npm i @elevenlabs/react@1.21.1`
2. Copy `voice/MarqueeCall.tsx` and `voice/intake.ts` into `web/components/` (same folder).
3. `web/.env.local` and Vercel env: `NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_4201m6v70wckem7sd6nq4mkt40s4`. No key is needed in web/.
4. Render it where the lead starts:
```tsx
<MarqueeCall
  agentId={process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID}
  installerId={installerId}
  address={address}
  onIntake={(facts, inputs) => designFrom(inputs)}  // POST /api/design { inputs }
/>
```
It renders nothing when `agentId` is empty. `onIntake` fires before Sam's closing line, so the design can appear as the call ends. `facts.summary`, `facts.timeline`, `facts.budget_monthly_eur`, `facts.notes` and `facts.estimated_fields` are for the planner's view; mark any field in `estimated_fields` as estimated, the rest as stated.

## Intake to engine
| Intake | HomeInputs |
|---|---|
| `annual_demand_kwh`, else `monthly_bill_eur` x 12 / 0.37, else household (2: 2,500, 3: 3,500, 4: 4,500, +1,000 each) | `annual_demand_kwh` |
| `monthly_bill_eur` with stated kWh: implied price; bill only: 37 | `electricity_price_ct_kwh` |
| `num_inhabitants`, `home_office` | `num_inhabitants`, `load_profile` (1 + home office: HomeOfficeOnePerson, 4: FamilyOfFour, else H0) |
| `house_size_sqm`, `house_built_year` | same |
| `heating_type`, `heating_cost_per_year_eur`, `heating_demand_kwh` | same; missing type: Unknown |
| `ev` now or planned, `ev_annual_km` | `has_ev` true, `ev_annual_km` (default 12,000) |
| `has_solar`, `existing_solar_kwp`, `has_storage`, `existing_storage_kwh`, `has_wallbox` | same |
| `address` (postcode or street) | `address`; the planner's address prop wins |
| `preference` | `preference` |
| `is_owner`, `property_type`, `heating_age`, `ev_planned_when`, `timeline`, `budget_monthly_eur`, `budget`, `notes`, `summary` | planner only, no engine field |

Planned EVs count as `has_ev`, so the design covers next year's demand.
