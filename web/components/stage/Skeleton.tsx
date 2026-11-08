/** The open card's final layout at its final size, shimmering until the lead lands: step cards left, the house right. */
export default function OpenSkeleton() {
  return (
    <div className="st-skel" aria-busy="true" aria-label="Opening the house">
      <div className="st-skel-l">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="s-skel st-skel-card" />)}</div>
      <span className="s-skel st-skel-house" />
    </div>
  );
}
