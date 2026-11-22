import { expect, it } from "vitest";
import { runScenarios } from "./scenarios.ts";

it("all spec §6 scenarios pass over HTTP with keyword rules", async () => {
  const results = await runScenarios(null);
  expect(results.length).toBeGreaterThanOrEqual(6);
  expect(results.filter((r) => !r.pass).map((r) => `#${r.id} ${r.name}: ${r.observed}`)).toEqual([]);
});
