// Renders the parts-list icons from the scene's own parts (components/spatial/kitMeshes.ts) into public/kit/*.png:
// 72 px squares (36 px at 2x), transparent, one fixed three-quarter camera for every part, the scene's hemisphere
// and sun light, a soft ground shadow, no edge lines. Module stacks in 5 heights, battery towers in 6.
// Run after changing kitMeshes.ts:  node scripts/render-kit-icons.mjs
// Needs Chromium and playwright-core: CHROMIUM=<path to Chromium binary> PLAYWRIGHT_CORE=<path to playwright-core>.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const pw = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const out = path.join(web, "public", "kit");
fs.mkdirSync(out, { recursive: true });

const tx = (f) => ts.transpileModule(fs.readFileSync(path.join(web, f), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const bandsJs = tx("components/spatial/kitBands.ts");
const kitJs = ts.transpileModule(fs.readFileSync(path.join(web, "components/spatial/kitMeshes.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;

const page = `<!doctype html><script type="importmap">{"imports":{"three":"/three.module.js","three/examples/jsm/":"/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import * as K from "/kit.js";
const SIZE = 72, SS = 4; // render at 4x, step down to 72 for clean edges
const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
r.setPixelRatio(1); r.setSize(SIZE * SS, SIZE * SS); r.setClearColor(0x000000, 0);
r.outputColorSpace = THREE.SRGBColorSpace;
r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
// The scene's camera angle for every part: 35 degrees round from the front, 26 degrees above.
const az = 35 * Math.PI / 180, el = 26 * Math.PI / 180;
const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
const SUN = new THREE.Vector3(-20, 30, 25).normalize();
// The shadow comes from a near-overhead light that adds no light (a ShadowMaterial ignores intensity), so it sits
// under the part as a soft contact shadow instead of a long one that would shrink the part in its square.
const DROP = new THREE.Vector3(-0.35, 1, 0.25).normalize();

function shot(make, frameObj) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d1c5, 1.9)); // the scene's lights (scene.ts)
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.copy(SUN).multiplyScalar(10);
  const drop = new THREE.DirectionalLight(0xffffff, 0);
  drop.position.copy(DROP).multiplyScalar(10); drop.castShadow = true;
  drop.shadow.mapSize.set(1024, 1024); drop.shadow.radius = 6; drop.shadow.bias = -0.0005;
  const sc = drop.shadow.camera; sc.left = sc.bottom = -3; sc.right = sc.top = 3; sc.near = 0.1; sc.far = 30;
  scene.add(sun, sun.target, drop, drop.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ color: 0x0a0c14, opacity: 0.28 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const obj = make();
  obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // Stand every part on the ground: the wallbox's cable loop hangs below the unit's base.
  const lift = (o) => { o.updateMatrixWorld(true); o.position.y -= new THREE.Box3().setFromObject(o).min.y; o.updateMatrixWorld(true); };
  lift(obj); if (frameObj) lift(frameObj);
  scene.add(obj);
  // Frame: the largest variant of this part plus its shadow on the ground, squared, centred, a little air.
  const fo = frameObj ?? obj;
  fo.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(fo), pts = [];
  for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
    const p = new THREE.Vector3(x, y, z); pts.push(p);
    pts.push(p.clone().addScaledVector(DROP, -p.y / DROP.y)); // its shadow on y = 0
  }
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const c = bb.getCenter(new THREE.Vector3());
  cam.position.copy(c).addScaledVector(dir, 20); cam.lookAt(c); cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  pts.forEach((p) => { const q = p.clone().applyMatrix4(inv); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
  const half = Math.max(x1 - x0, y1 - y0) / 2 * 1.04, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  cam.left = mx - half; cam.right = mx + half; cam.top = my + half; cam.bottom = my - half; cam.updateProjectionMatrix();
  r.render(scene, cam);
  // Step down 288 -> 144 -> 72.
  let src = r.domElement;
  for (let s = SIZE * SS / 2; s >= SIZE; s /= 2) {
    const cv = document.createElement("canvas"); cv.width = cv.height = s;
    const g = cv.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, s, s); src = cv;
  }
  scene.traverse((o) => { o.geometry?.dispose?.(); });
  return src.toDataURL("image/png");
}

const res = {};
const tallStack = K.moduleStack(5), tallBattery = K.battery(6);
for (let n = 1; n <= 5; n++) res["modules-" + n] = shot(() => K.moduleStack(n), tallStack);
for (let n = 1; n <= 6; n++) res["battery-" + n] = shot(() => K.battery(n), tallBattery);
res.inverter = shot(K.inverter);
res.wallbox = shot(K.wallbox);
res.heatpump = shot(K.heatPump);
res.cabinet = shot(K.cabinet);
window.__icons = res;
</script>`;

const files = {
  "/": ["text/html", page],
  "/kit.js": ["text/javascript", kitJs],
  "/kitBands": ["text/javascript", bandsJs], // kitMeshes.ts imports "./kitBands"
  "/three.module.js": ["text/javascript", fs.readFileSync(path.join(web, "node_modules/three/build/three.module.js"))],
  "/three.core.js": ["text/javascript", fs.readFileSync(path.join(web, "node_modules/three/build/three.core.js"))],
};
const jsm = path.join(web, "node_modules/three/examples/jsm");
const server = http.createServer((q, s) => {
  if (q.url.startsWith("/jsm/")) {
    const f = path.join(jsm, path.normalize(q.url.slice(5)));
    if (!f.startsWith(jsm) || !fs.existsSync(f)) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { "content-type": "text/javascript" }); s.end(fs.readFileSync(f)); return;
  }
  const f = files[q.url];
  if (!f) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { "content-type": f[0] }); s.end(f[1]);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const tab = await browser.newPage();
  const errs = [];
  tab.on("pageerror", (e) => errs.push(String(e)));
  tab.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await tab.goto(`http://127.0.0.1:${server.address().port}/`);
  const icons = await tab.waitForFunction(() => window.__icons, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch((e) => { throw new Error(errs.join("\n") || String(e)); });
  for (const [name, url] of Object.entries(icons)) fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
  console.log(`wrote ${Object.keys(icons).length} icons to public/kit`);
} finally {
  await browser.close();
  server.close();
}
