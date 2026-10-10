/** Geometry of the ND inside its canvas, in CSS pixels. */
export interface NdLayout {
  width: number;
  height: number;
  cx: number; // aircraft symbol and centre of the compass arc
  cy: number;
  radius: number; // outer arc = selected range
  top: number; // top of the data-block band
}

/** Nominal half span of the compass arc (spec §9.3: ~100°). */
export const ARC_HALF_SPAN_DEG = 50;
/** On tall screens the arc may grow until only this half span stays on screen. */
const MIN_HALF_SPAN_DEG = 40;
const SIDE_MARGIN = 6;
const TOP_BAND = 74; // GS/TAS, wind and TO-waypoint blocks above the arc
const BELOW = 0.27; // minimum room under the aircraft for the range buttons, as a fraction of the radius

const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);

/**
 * The radius fits a ~100° arc across the width; a tall canvas lets it grow until the visible arc
 * narrows to 80°. Anything left below the aircraft shows the map behind it (the flown trail).
 */
export function ndLayout(width: number, height: number): NdLayout {
  const half = width / 2 - SIDE_MARGIN;
  const byHeight = (height - TOP_BAND) / (1 + BELOW);
  const radius = Math.max(40, Math.min(half / sinDeg(MIN_HALF_SPAN_DEG), Math.max(half / sinDeg(ARC_HALF_SPAN_DEG), byHeight), byHeight));
  return { width, height, cx: width / 2, cy: TOP_BAND + radius, radius, top: 0 };
}
