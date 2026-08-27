import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";
import { apiRouteContracts } from "../config/api-route-contracts";

const apiRoot = join(process.cwd(), "src", "app", "api");

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(fullPath);
    return entry.name === "route.ts" ? [fullPath] : [];
  });
}

describe("API route contracts", () => {
  const routeFiles = listRouteFiles(apiRoot);

  it("registers response schemas and error code tables for every route", () => {
    const missing = routeFiles
      .map((file) => {
        const routePath = relative(process.cwd(), file).replace(/\\/g, "/");
        const contract = apiRouteContracts[routePath];
        return contract?.responseSchema && Array.isArray(contract.errorCodes) ? null : routePath;
      })
      .filter(Boolean);

    expect(missing).toEqual([]);
  });

  it("registers request schemas for every route that consumes a request body", () => {
    const missing = routeFiles
      .map((file) => {
        const content = readFileSync(file, "utf-8");
        const consumesBody = /request\.(json|text)\s*\(/.test(content);
        const routePath = relative(process.cwd(), file).replace(/\\/g, "/");
        return consumesBody && !apiRouteContracts[routePath]?.requestSchema ? routePath : null;
      })
      .filter(Boolean);

    expect(missing).toEqual([]);
  });

  it("does not register stale route contracts", () => {
    const routePaths = new Set(
      routeFiles.map((file) => relative(process.cwd(), file).replace(/\\/g, "/")),
    );
    const stale = Object.keys(apiRouteContracts).filter((routePath) => !routePaths.has(routePath));

    expect(stale).toEqual([]);
  });
});
