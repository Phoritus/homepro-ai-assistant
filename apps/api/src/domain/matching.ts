import type { RoomSizeBand } from "@homepro/shared";
import { CATALOG, findProduct, inStock, type Product } from "./catalog.ts";
import { neighbourBands } from "./roomSize.ts";

const MAX_VALID_MATCHES = 3;

/** A Budget is a positive, finite THB amount. Anything else is treated as "budget not given". */
export const isValidBudget = (thb: number): boolean => Number.isFinite(thb) && thb > 0;

/** Why the shopper's own band produced no Valid Match. Stated to the shopper as a fact. */
export type BandShortfall =
  | { kind: "over_budget"; cheapestInBand: Product }
  | { kind: "out_of_stock"; productsInBand: Product[] }
  | { kind: "not_carried" };

export type MatchOutcome =
  | { kind: "valid_match"; requestedBand: RoomSizeBand; budgetThb: number; matches: [Product, ...Product[]] }
  | { kind: "alternative"; requestedBand: RoomSizeBand; budgetThb: number; shortfall: BandShortfall; alternative: Product }
  | {
      kind: "no_match";
      requestedBand: RoomSizeBand;
      budgetThb: number;
      shortfall: BandShortfall;
      /** Lowest-priced in-stock product, set only when even it is above Budget, so the reply can state the floor. */
      cheapestInStock: Product | null;
    };

const byPrice = (a: Product, b: Product) => a.priceThb - b.priceThb;

const affordable = (catalog: readonly Product[], band: RoomSizeBand, budgetThb: number) =>
  catalog.filter((p) => p.band === band && inStock(p) && p.priceThb <= budgetThb).sort(byPrice);

function shortfallFor(catalog: readonly Product[], band: RoomSizeBand): BandShortfall {
  const inBand = catalog.filter((p) => p.band === band);
  const cheapestInBand = inBand.filter(inStock).sort(byPrice)[0];
  if (cheapestInBand) return { kind: "over_budget", cheapestInBand };
  if (inBand.length > 0) return { kind: "out_of_stock", productsInBand: inBand };
  return { kind: "not_carried" };
}

/**
 * Glossary rules. Budget is a hard limit: nothing priced above it is ever returned as
 * a match or alternative. Alternatives come from one band away, larger first.
 */
export function matchProducts(
  band: RoomSizeBand,
  budgetThb: number,
  catalog: readonly Product[] = CATALOG,
): MatchOutcome {
  const base = { requestedBand: band, budgetThb };
  const [first, ...rest] = affordable(catalog, band, budgetThb);
  if (first) return { kind: "valid_match", ...base, matches: [first, ...rest.slice(0, MAX_VALID_MATCHES - 1)] };

  const shortfall = shortfallFor(catalog, band);
  for (const neighbour of neighbourBands(band)) {
    const alternative = affordable(catalog, neighbour, budgetThb)[0];
    if (alternative) return { kind: "alternative", ...base, shortfall, alternative };
  }

  const cheapest = catalog.filter(inStock).sort(byPrice)[0];
  const cheapestInStock = cheapest && cheapest.priceThb > budgetThb ? cheapest : null;
  return { kind: "no_match", ...base, shortfall, cheapestInStock };
}

export type SkuOutcome =
  | { kind: "unknown_sku"; asked: string }
  | { kind: "available"; product: Product }
  /** The product is sized for another band than the shopper's. `followUp` is null when Budget is unknown. */
  | { kind: "wrong_size"; product: Product; requestedBand: RoomSizeBand; followUp: MatchOutcome | null }
  /** `followUp` is null when Budget is unknown: alternatives can't be chosen without it. */
  | { kind: "out_of_stock"; product: Product; followUp: MatchOutcome | null }
  | { kind: "over_budget"; product: Product; budgetThb: number; followUp: MatchOutcome };

/**
 * A shopper asking about one SKU. A known room band that differs from the product's wins over stock and
 * budget, and alternatives then come from the shopper's band. Otherwise they come from the product's own band.
 */
export function checkSku(
  sku: string,
  budgetThb: number | undefined,
  knownBand: RoomSizeBand | undefined,
  catalog: readonly Product[] = CATALOG,
): SkuOutcome {
  const product = findProduct(sku, catalog);
  if (!product) return { kind: "unknown_sku", asked: sku };
  if (knownBand !== undefined && knownBand !== product.band) {
    const followUp = budgetThb === undefined ? null : matchProducts(knownBand, budgetThb, catalog);
    return { kind: "wrong_size", product, requestedBand: knownBand, followUp };
  }
  if (!inStock(product)) {
    const followUp = budgetThb === undefined ? null : matchProducts(product.band, budgetThb, catalog);
    return { kind: "out_of_stock", product, followUp };
  }
  if (budgetThb !== undefined && product.priceThb > budgetThb) {
    return { kind: "over_budget", product, budgetThb, followUp: matchProducts(product.band, budgetThb, catalog) };
  }
  return { kind: "available", product };
}
