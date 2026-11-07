// Isometric line drawing of the home. Draws only what the design includes.
function drawHouse(el, d) {
  const s = el.dataset.scale ? Number(el.dataset.scale) : 22, c = Math.cos(Math.PI / 6), n = 0.5;
  const ox = 230, oy = 120;
  const P = (x, y, z) => [ox + (x - y) * c * s, oy + (x + y) * n * s - z * s];
  const pts = (a) => a.map((p) => P(...p).map((v) => v.toFixed(1)).join(",")).join(" ");
  const poly = (a, cls) => `<polygon class="${cls}" points="${pts(a)}"/>`;
  const line = (a, b, cls) => { const [x1, y1] = P(...a), [x2, y2] = P(...b); return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; };
  const L = 10, D = 7, H = 4.6, R = 7.6, M = D / 2;
  let g = "";
  // ground shadow plate
  g += poly([[-1.5, -1, 0], [L + 5.5, -1, 0], [L + 5.5, D + 5, 0], [-1.5, D + 5, 0]], "ground");
  // walls
  g += poly([[0, D, 0], [L, D, 0], [L, D, H], [0, D, H]], "wall");
  g += poly([[L, 0, 0], [L, D, 0], [L, D, H], [L, M, R], [L, 0, H]], "wall side");
  // roof, front slope and the edge of the back slope
  g += poly([[0, M, R], [L, M, R], [L, 0, H], [0, 0, H]], "roof back");
  g += poly([[0, M, R], [L, M, R], [L, D, H], [0, D, H]], "roof");
  g += line([0, M, R], [0, D, H], "edge");
  // windows and door
  for (const x of [1.4, 4.0, 7.6]) g += poly([[x, D, 1.9], [x + 1.3, D, 1.9], [x + 1.3, D, 3.5], [x, D, 3.5]], "win");
  g += poly([[5.8, D, 0], [6.9, D, 0], [6.9, D, 2.6], [5.8, D, 2.6]], "win");
  g += poly([[L, 2.2, 1.9], [L, 3.4, 1.9], [L, 3.4, 3.5], [L, 2.2, 3.5]], "win");
  // panels on the front slope, 0.45 kWp each
  const count = d.pv ? Math.round(d.pv / 0.45) : 0, cols = 8, rows = Math.ceil(count / cols);
  const u0 = 0.5, u1 = L - 0.5, cw = (u1 - u0) / cols, rh = 0.88 / Math.max(rows, 3);
  const at = (u, t) => [u, D - (D - M) * t, H + (R - H) * t];
  for (let k = 0; k < count; k++) {
    const i = k % cols, j = Math.floor(k / cols), t0 = 0.08 + j * rh, t1 = t0 + rh * 0.92;
    g += poly([at(u0 + i * cw + 0.06, t0), at(u0 + (i + 1) * cw - 0.06, t0), at(u0 + (i + 1) * cw - 0.06, t1), at(u0 + i * cw + 0.06, t1)], "panel");
  }
  // battery on the side wall
  const bat = [[L, 4.6, 0.2], [L, 5.8, 0.2], [L, 5.8, 2.0], [L, 4.6, 2.0]];
  g += d.battery ? poly(bat, "box") : poly(bat, "ghost");
  // heat pump outside the side wall
  const hp = (x0) => [[[x0, 5.4, 0], [x0 + 1.2, 5.4, 0], [x0 + 1.2, 5.4, 1.3], [x0, 5.4, 1.3]], [[x0, 4.4, 1.3], [x0 + 1.2, 4.4, 1.3], [x0 + 1.2, 5.4, 1.3], [x0, 5.4, 1.3]], [[x0 + 1.2, 4.4, 0], [x0 + 1.2, 5.4, 0], [x0 + 1.2, 5.4, 1.3], [x0 + 1.2, 4.4, 1.3]]];
  for (const f of hp(L + 1.0)) g += poly(f, d.heatpump ? "box" : "ghost");
  // wallbox on the front wall and the car in front of it
  g += poly([[0.5, D, 1.0], [1.1, D, 1.0], [1.1, D, 2.0], [0.5, D, 2.0]], d.wallbox ? "box" : "ghost");
  if (d.wallbox) {
    const cx = 1.6, cy = D + 1.6, cl = 4.4, cwid = 1.9, ch = 1.1;
    g += poly([[cx, cy + cwid, 0.25], [cx + cl, cy + cwid, 0.25], [cx + cl, cy + cwid, ch], [cx, cy + cwid, ch]], "car");
    g += poly([[cx + cl, cy, 0.25], [cx + cl, cy + cwid, 0.25], [cx + cl, cy + cwid, ch], [cx + cl, cy, ch]], "car");
    g += poly([[cx, cy, ch], [cx + cl, cy, ch], [cx + cl, cy + cwid, ch], [cx, cy + cwid, ch]], "car top");
    const k0 = cx + 1.1, k1 = cx + 3.2, y0 = cy + 0.2, y1 = cy + cwid - 0.2, z1 = ch + 0.75;
    g += poly([[k0, y1, ch], [k1, y1, ch], [k1 - 0.3, y1, z1], [k0 + 0.4, y1, z1]], "car");
    g += poly([[k1, y0, ch], [k1, y1, ch], [k1 - 0.3, y1, z1], [k1 - 0.3, y0, z1]], "car");
    g += poly([[k0 + 0.4, y0, z1], [k1 - 0.3, y0, z1], [k1 - 0.3, y1, z1], [k0 + 0.4, y1, z1]], "car top");
    const [a1, b1] = P(0.8, D, 1.0), [a2, b2] = P(cx + 0.6, cy + cwid, 0.6);
    g += `<path class="cable" d="M${a1},${b1} C${a1},${b1 + 30} ${a2 + 10},${b2 + 4} ${a2},${b2}"/>`;
  }
  // labels
  const tag = (p, dx, dy, text, off) => { const [x, y] = P(...p); return `<line class="lead" x1="${x}" y1="${y}" x2="${x + dx}" y2="${y + dy}"/><text class="${off ? "tag off" : "tag"}" x="${x + dx + (dx < 0 ? -4 : 4)}" y="${y + dy + 4}" text-anchor="${dx < 0 ? "end" : "start"}">${text}</text>`; };
  g += tag([L / 2 + 2, D - 1.2, H + 1.6], 120, -96, d.pv ? `${d.pv} kWp` : "No PV", !d.pv);
  g += tag([L, 5.2, 1.1], 92, -6, d.battery ? `${d.battery} kWh` : "No battery", !d.battery);
  g += tag([L + 1.6, 4.9, 1.3], 70, 26, d.heatpump ? `${d.heatpump} kW` : "No heat pump", !d.heatpump);
  g += tag([0.8, D, 2.0], -60, -40, d.wallbox ? `${d.wallbox} kW` : "No charger", !d.wallbox);
  el.innerHTML = `<svg viewBox="0 0 520 420" role="img" aria-label="The home with the proposed system">${g}</svg>`;
}
