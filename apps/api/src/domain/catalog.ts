import type { RoomSizeBand } from "@homepro/shared";

export interface Product {
  sku: string;
  name: { en: string; th: string };
  priceThb: number;
  band: RoomSizeBand;
  stock: number;
}

/** Fixture from spec §2.1. Records may be appended; these three must stay intact. */
export const CATALOG: readonly Product[] = [
  { sku: "HP-F01", name: { en: "12-inch desk fan", th: "พัดลมตั้งโต๊ะ 12 นิ้ว" }, priceThb: 890, band: "small", stock: 3 },
  { sku: "HP-F02", name: { en: "16-inch pedestal fan", th: "พัดลมตั้งพื้น 16 นิ้ว" }, priceThb: 1390, band: "medium", stock: 2 },
  { sku: "HP-F03", name: { en: "18-inch pedestal fan", th: "พัดลมตั้งพื้น 18 นิ้ว" }, priceThb: 1790, band: "large", stock: 0 },
];

export const STORE_NAME = "Demo Store";

const skuKey = (sku: string) => sku.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Matches "HP-F01", " hp-f01 ", "HPF01" and "hp f01" to the same product. */
export function findProduct(sku: string, catalog: readonly Product[] = CATALOG): Product | undefined {
  const wanted = skuKey(sku);
  if (wanted === "") return undefined;
  return catalog.find((p) => skuKey(p.sku) === wanted);
}

export const inStock = (p: Product): boolean => p.stock > 0;
