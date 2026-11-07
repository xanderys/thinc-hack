// Where the solar goes over a typical year. The battery and car split appear only when the engine sends them.
import type { Design, Economics } from "@/lib/api";
import { n0 } from "@/lib/stage";

export default function Flow({ e, design, hasEv, moved }: { e: Economics; design: Design; hasEv: boolean; moved: boolean }) {
  const a = e.annual;
  if (!a) return null;
  const sun = Math.max(1, a.pv_yield_kwh);
  const w = (v: number) => 3 + 24 * Math.min(1, v / sun);
  const split = a.home_from_pv_kwh != null;
  const bat = design.battery_kwh != null && a.battery_charged_kwh != null ? a.battery_charged_kwh : null;
  const car = hasEv && split && a.ev_from_pv_kwh != null ? a.ev_from_pv_kwh : null;
  const used = split ? a.home_from_pv_kwh! : a.self_consumed_kwh;
  const usedLabel = split ? "Home" : hasEv ? "Home and car" : "Home";
  const nv = moved ? "nv moved" : "nv";
  return (
    <figure className="s-flow">
      <figcaption className="s-h3">Where does the power go</figcaption>
      <svg viewBox="0 0 460 250" role="img" aria-label={`Solar ${n0(a.pv_yield_kwh)} kWh a year: ${n0(a.fed_in_kwh)} sold to the grid, ${n0(a.self_consumed_kwh)} used in the house.`}>
        {bat != null && <path className="stream" strokeWidth={w(bat)} d="M196 58 V120 Q196 140 176 140 H128" />}
        <path className="stream" strokeWidth={w(used)} d={car != null ? "M214 58 V190" : "M226 58 V190"} />
        {car != null && <path className="stream" strokeWidth={w(car)} d="M244 58 V190" />}
        <path className="stream" strokeWidth={w(a.fed_in_kwh)} d="M266 58 V120 Q266 140 286 140 H332" />
        {car == null && <path className="gridin" d="M388 162 V205 Q388 214 379 214 H310" />}
        <rect className="node sun" x="170" y="10" width="120" height="48" /><text className="nk" x="182" y="29">Solar</text><text className={nv} x="182" y="48">{n0(a.pv_yield_kwh)} kWh</text>
        {bat != null && <><rect className="node" x="10" y="116" width="118" height="48" /><text className="nk" x="22" y="135">Battery</text><text className={nv} x="22" y="154">{n0(bat)} kWh</text></>}
        <rect className="node" x="332" y="116" width="118" height="48" /><text className="nk" x="344" y="135">Sold to grid</text><text className={nv} x="344" y="154">{n0(a.fed_in_kwh)} kWh</text>
        {car != null ? <>
          <rect className="node" x="110" y="190" width="120" height="48" /><text className="nk" x="122" y="209">{usedLabel}</text><text className={nv} x="122" y="228">{n0(used)} kWh</text>
          <rect className="node" x="236" y="190" width="120" height="48" /><text className="nk" x="248" y="209">Car</text><text className={nv} x="248" y="228">{n0(car)} kWh</text>
        </> : <>
          <rect className="node" x="150" y="190" width="160" height="48" /><text className="nk" x="162" y="209">{usedLabel}</text><text className={nv} x="162" y="228">{n0(used)} kWh</text>
          <text className="nk" x="322" y="236">Bought {n0(a.grid_import_kwh)}</text>
        </>}
      </svg>
      <p className="s-flowcap">
        {hasEv && a.ev_charge_kwh != null ? <>The car needs <span className="num">{n0(a.ev_charge_kwh)} kWh</span> a year; </> : null}
        <span className="num">{n0(a.grid_import_kwh)} kWh</span> {hasEv && a.ev_charge_kwh != null ? "still comes" : "a year still comes"} from the grid.
      </p>
    </figure>
  );
}
