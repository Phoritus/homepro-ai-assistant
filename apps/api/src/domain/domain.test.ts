import { describe, expect, it } from "vitest";
import { CATALOG, findProduct, type Product } from "./catalog.ts";
import { checkSku, isValidBudget, matchProducts } from "./matching.ts";
import { POLICIES } from "./policies.ts";
import { bandForArea, neighbourBands } from "./roomSize.ts";

const skus = (ps: readonly Product[]) => ps.map((p) => p.sku);

describe("fixtures", () => {
  it("keeps the spec catalog intact", () => {
    expect(CATALOG.map(({ sku, priceThb, band, stock }) => ({ sku, priceThb, band, stock }))).toEqual([
      { sku: "HP-F01", priceThb: 890, band: "small", stock: 3 },
      { sku: "HP-F02", priceThb: 1390, band: "medium", stock: 2 },
      { sku: "HP-F03", priceThb: 1790, band: "large", stock: 0 },
    ]);
  });

  it("finds a product by SKU case-insensitively", () => {
    expect(findProduct(" hp-f03 ")?.sku).toBe("HP-F03");
    expect(findProduct("HP-X99")).toBeUndefined();
  });

  it("finds a product whatever the separator, and rejects blank input", () => {
    expect(findProduct("HPF01")?.sku).toBe("HP-F01");
    expect(findProduct("hp f02")?.sku).toBe("HP-F02");
    expect(findProduct("  ")).toBeUndefined();
  });

  it("SUP-01 states the 14-day unopened rule and never guarantees approval", () => {
    const en = POLICIES["SUP-01"].text.en;
    expect(en).toMatch(/14 days/);
    expect(en).toMatch(/unopened/);
    expect(en).toMatch(/proof of purchase/);
    expect(en).toMatch(/not guaranteed/);
  });

  it("SUP-02 says the demo has no order lookup or ticketing", () => {
    expect(POLICIES["SUP-02"].disclosure.en).toMatch(/no order lookup or real ticketing/);
    expect(POLICIES["SUP-02"].scope.en).toMatch(/order status or damaged deliveries/);
  });
});

describe("room size bands", () => {
  it.each([
    [10, "small"], [15, "small"], [15.5, "medium"], [16, "medium"],
    [25, "medium"], [25.1, "large"], [40, "large"],
  ] as const)("%s m² is %s", (area, band) => {
    expect(bandForArea(area)).toBe(band);
  });

  it("rejects non-positive or non-numeric areas", () => {
    expect(bandForArea(0)).toBeUndefined();
    expect(bandForArea(-3)).toBeUndefined();
    expect(bandForArea(Number.NaN)).toBeUndefined();
  });

  it("lists neighbours larger first, one band away only", () => {
    expect(neighbourBands("small")).toEqual(["medium"]);
    expect(neighbourBands("medium")).toEqual(["large", "small"]);
    expect(neighbourBands("large")).toEqual(["medium"]);
  });
});

describe("matchProducts", () => {
  it("returns the Valid Match for a small room within budget", () => {
    const outcome = matchProducts("small", 1500);
    expect(outcome.kind).toBe("valid_match");
    if (outcome.kind === "valid_match") expect(skus(outcome.matches)).toEqual(["HP-F01"]);
  });

  it("does not upsell a larger band when the shopper's band matches", () => {
    const outcome = matchProducts("small", 5000);
    if (outcome.kind !== "valid_match") throw new Error(`expected valid_match, got ${outcome.kind}`);
    expect(skus(outcome.matches)).toEqual(["HP-F01"]);
  });

  it("treats budget as a hard limit: exactly at budget matches, one baht under does not", () => {
    expect(matchProducts("medium", 1390).kind).toBe("valid_match");
    expect(matchProducts("medium", 1389).kind).not.toBe("valid_match");
  });

  it("large room: HP-F03 out of stock, offers HP-F02 as Alternative", () => {
    const outcome = matchProducts("large", 2000);
    expect(outcome).toMatchObject({
      kind: "alternative",
      requestedBand: "large",
      shortfall: { kind: "out_of_stock" },
      alternative: { sku: "HP-F02" },
    });
  });

  it("medium room over budget: states HP-F02 price, offers HP-F01 as Alternative", () => {
    const outcome = matchProducts("medium", 1000);
    expect(outcome).toMatchObject({
      kind: "alternative",
      shortfall: { kind: "over_budget", cheapestInBand: { sku: "HP-F02" } },
      alternative: { sku: "HP-F01" },
    });
  });

  it("never offers a band two steps away, nor points at it as the cheapest option", () => {
    const outcome = matchProducts("large", 1000);
    expect(outcome).toMatchObject({ kind: "no_match", shortfall: { kind: "out_of_stock" }, cheapestInStock: null });
  });

  it("No-Match when nothing fits the budget, reporting the cheapest in-stock fan", () => {
    const outcome = matchProducts("medium", 500);
    expect(outcome).toMatchObject({
      kind: "no_match",
      shortfall: { kind: "over_budget" },
      cheapestInStock: { sku: "HP-F01", priceThb: 890 },
    });
  });

  it("never returns an out-of-stock or over-budget product as a match or alternative", () => {
    for (const band of ["small", "medium", "large"] as const) {
      for (const budget of [0, 500, 890, 1000, 1389, 1390, 1790, 5000]) {
        const outcome = matchProducts(band, budget);
        const offered =
          outcome.kind === "valid_match" ? outcome.matches
          : outcome.kind === "alternative" ? [outcome.alternative]
          : [];
        for (const p of offered) {
          expect(p.stock).toBeGreaterThan(0);
          expect(p.priceThb).toBeLessThanOrEqual(budget);
        }
      }
    }
  });

  it("orders several Valid Matches cheapest first, at most three", () => {
    const extra: Product[] = [1290, 990, 1190, 1090].map((priceThb, i) => ({
      sku: `HP-X0${i}`, name: { en: "x", th: "x" }, priceThb, band: "small", stock: 1,
    }));
    const outcome = matchProducts("small", 1300, [...CATALOG, ...extra]);
    if (outcome.kind !== "valid_match") throw new Error(`expected valid_match, got ${outcome.kind}`);
    expect(outcome.matches.map((p) => p.priceThb)).toEqual([890, 990, 1090]);
  });
});

describe("isValidBudget", () => {
  it.each([[890, true], [0.5, true], [0, false], [-100, false], [Number.NaN, false], [Infinity, false]] as const)(
    "%s is %s", (thb, ok) => expect(isValidBudget(thb)).toBe(ok),
  );
});

describe("checkSku", () => {
  it("reports an unknown SKU without guessing", () => {
    expect(checkSku("HP-Z99", 5000, undefined)).toEqual({ kind: "unknown_sku", asked: "HP-Z99" });
  });

  it("HP-F03 is out of stock and, once Budget is known, offers HP-F02 from the medium band", () => {
    expect(checkSku("HP-F03", undefined, undefined)).toMatchObject({ kind: "out_of_stock", product: { sku: "HP-F03" }, followUp: null });
    expect(checkSku("hp-f03", 2000, undefined)).toMatchObject({
      kind: "out_of_stock",
      followUp: { kind: "alternative", alternative: { sku: "HP-F02" } },
    });
  });

  it("an in-stock SKU above Budget is refused and the cheaper neighbour offered", () => {
    expect(checkSku("HP-F02", 1000, undefined)).toMatchObject({
      kind: "over_budget",
      budgetThb: 1000,
      followUp: { kind: "alternative", alternative: { sku: "HP-F01" } },
    });
  });

  it("an in-stock SKU within Budget, or with no Budget yet, is available", () => {
    expect(checkSku("HP-F01", 890, undefined)).toMatchObject({ kind: "available", product: { sku: "HP-F01" } });
    expect(checkSku("HP-F02", undefined, undefined)).toMatchObject({ kind: "available" });
  });

  it("a SKU sized for another band than the shopper's is wrong_size, ahead of stock and budget", () => {
    expect(checkSku("HP-F01", undefined, "medium")).toMatchObject({
      kind: "wrong_size", product: { sku: "HP-F01" }, requestedBand: "medium", followUp: null,
    });
    expect(checkSku("HP-F01", 2000, "medium")).toMatchObject({
      kind: "wrong_size", requestedBand: "medium", followUp: { kind: "valid_match", matches: [{ sku: "HP-F02" }] },
    });
    expect(checkSku("HP-F03", 2000, "small")).toMatchObject({ kind: "wrong_size" });
  });

  it("a SKU sized for the shopper's band is judged on stock and budget as before", () => {
    expect(checkSku("HP-F01", undefined, "small")).toMatchObject({ kind: "available" });
    expect(checkSku("HP-F03", undefined, "large")).toMatchObject({ kind: "out_of_stock" });
  });
});
