/** Geometry of the ND inside its canvas, in CSS pixels. */
export interface NdLayout {
  width: number;
  height: number;
  cx: number; // aircraft symbol and centre of the compass arc
  cy: number;
  radius: number; // outer arc = selected range
  top: number; // top of the data-block band
}

/** Half of the compass arc's visible span (spec §9.3: ~100°). */
export const ARC_HALF_SPAN_DEG = 50;
const SIDE_MARGIN = 6;
const TOP_BAND = 66; // GS/TAS, wind and TO-waypoint blocks above the arc
const BELOW = 0.27; // room under the aircraft symbol for the range label, as a fraction of the radius

export function ndLayout(width: number, height: number): NdLayout {
  const byWidth = (width / 2 - SIDE_MARGIN) / Math.sin((ARC_HALF_SPAN_DEG * Math.PI) / 180);
  const byHeight = (height - TOP_BAND) / (1 + BELOW);
  const radius = Math.max(40, Math.min(byWidth, byHeight));
  const used = TOP_BAND + radius * (1 + BELOW);
  const top = Math.max(0, (height - used) / 2);
  return { width, height, cx: width / 2, cy: top + TOP_BAND + radius, radius, top };
}
