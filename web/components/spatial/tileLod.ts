// Detail policy for the photo tiles: full screen-space detail within about 25 m of the house, coarse beyond.
// Outside the near sphere the context is painted white (whiteContext.ts), so its geometry barely matters and
// refining it only costs downloads, memory and frame time. This is the lag fix as well.
//
// The tiles renderer refines a tile while its screen-space error is above errorTarget. Load regions can only
// raise that error, so the policy wraps the renderer's own camera error and scales it down with distance from
// the house: 1 inside NEAR, (NEAR / d)^1.6 beyond, floored at FLOOR. Tiles that fall out of view are unloaded
// by the LRU cache, which the policy keeps small; leaving mesh mode disposes the whole renderer.
import * as THREE from "three";
import type { TilesRenderer } from "3d-tiles-renderer/three";

const NEAR = 25;     // metres around the house at full detail
const FLOOR = 0.06;  // far tiles refine as if about 16 times further away

type ViewTarget = { inView: boolean; error: number; distanceFromCamera: number };
type Tile = { engineData: { boundingVolume: { distanceToPoint: (p: THREE.Vector3) => number } } };
type Calc = (tile: Tile, target: ViewTarget) => void;

export function applyTileLod(tiles: TilesRenderer, house: THREE.Vector3, o: { phone: boolean; near?: number }) {
  const near = o.near ?? NEAR;
  const local = new THREE.Vector3(), inv = new THREE.Matrix4();
  // The house in the tiles' own frame, once per update, so the per-tile check is one distance.
  const before = () => { tiles.group.updateMatrixWorld(true); inv.copy(tiles.group.matrixWorld).invert(); local.copy(house).applyMatrix4(inv); };
  tiles.addEventListener("update-before", before);
  before();

  const t = tiles as unknown as { calculateTileViewError: Calc };
  const own = t.calculateTileViewError.bind(tiles);
  t.calculateTileViewError = (tile, target) => {
    own(tile, target);
    const d = tile.engineData.boundingVolume.distanceToPoint(local);
    if (d > near) target.error *= Math.max(FLOOR, Math.pow(near / d, 1.6));
  };

  // Keep only what the near detail needs in memory; far tiles are coarse and few.
  tiles.lruCache.minBytesSize = (o.phone ? 40 : 90) * 2 ** 20;
  tiles.lruCache.maxBytesSize = (o.phone ? 80 : 180) * 2 ** 20;

  return () => {
    tiles.removeEventListener("update-before", before);
    t.calculateTileViewError = own;
  };
}
