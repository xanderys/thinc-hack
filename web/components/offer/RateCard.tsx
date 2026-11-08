// The arithmetic behind the kit sheet's prices, in an "i": one line per priced row. The data has no prices, so the
// heading says what every figure is.
import Info from "./Info";
import s from "./offer.module.css";

export default function RateCard({ calc }: { calc: string[] }) {
  if (!calc.length) return null;
  return (
    <Info label="How the price is worked out">
      <p className={s.rateH}>Not the installer&rsquo;s price list</p>
      <ul className={s.rateCalc}>{calc.map((c) => <li key={c}>{c}</li>)}</ul>
    </Info>
  );
}
