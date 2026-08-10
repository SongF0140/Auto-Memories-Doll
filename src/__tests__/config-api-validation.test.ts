import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  PATCH as previewStorageMigration,
  POST as updateStorageConfig,
} from "../app/api/config/storage/route";
import { POST as createToolSource } from "../app/api/config/tool-sources/route";
import { PUT as updateToolSource } from "../app/api/config/tool-sources/[id]/route";

function jsonRequest(url: string, method: "POST" | "PATCH" | "PUT", body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("configuration API request validation", () => {
  it("rejects a string copyExisting value before storage migration", async () => {
    const response = await updateStorageConfig(
      jsonRequest("http://localhost/api/config/storage", "POST", {
        notesPath: "memory-root-new",
        copyExisting: "false",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a non-string storage preview path", async () => {
    const response = await previewStorageMigration(
      jsonRequest("http://localhost/api/config/storage", "PATCH", { notesPath: 123 }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects invalid tool source primitive types before persistence", async () => {
    const response = await createToolSource(
      jsonRequest("http://localhost/api/config/tool-sources", "POST", {
        name: "Codex",
        toolType: "codex",
        path: "C:/sessions",
        enabled: "false",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects stale tool source update field names", async () => {
    const response = await updateToolSource(
      jsonRequest("http://localhost/api/config/tool-sources/source-1", "PUT", {
        dirPath: "C:/sessions",
      }),
      { params: { id: "source-1" } },
    );

    expect(response.status).toBe(400);
  });
});
