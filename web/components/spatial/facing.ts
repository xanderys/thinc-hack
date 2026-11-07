// Compass words for an azimuth in degrees (0 north, 90 east), as a planner says them.
export function facing(az: number | null) {
  if (az == null) return "flat";
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round((((az % 360) + 360) % 360) / 45) % 8];
}
