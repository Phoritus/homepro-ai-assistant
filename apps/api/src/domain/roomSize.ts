import type { RoomSizeBand } from "@homepro/shared";

/** Glossary: Small ≤ 15 m², Medium 16–25 m², Large > 25 m². Fractional areas round into the band above 15 / 25. */
export function bandForArea(squareMetres: number): RoomSizeBand | undefined {
  if (!Number.isFinite(squareMetres) || squareMetres <= 0) return undefined;
  if (squareMetres <= 15) return "small";
  if (squareMetres <= 25) return "medium";
  return "large";
}

const ORDER: readonly RoomSizeBand[] = ["small", "medium", "large"];

/** Bands one step away, larger first (glossary: Alternative). */
export function neighbourBands(band: RoomSizeBand): RoomSizeBand[] {
  const i = ORDER.indexOf(band);
  return [ORDER[i + 1], ORDER[i - 1]].filter((b): b is RoomSizeBand => b !== undefined);
}
