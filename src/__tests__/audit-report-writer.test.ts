import { describe, expect, it, vi, beforeEach } from "vitest";

const mkdirSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("fs", () => ({
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
}));

vi.mock("path", async () => {
  const actual = await vi.importActual<typeof import("path")>("path");
  return { ...actual, join: (...parts: string[]) => parts.join("/") };
});

vi.mock("../lib/storage/path-resolver", () => ({
  getArchivePath: () => "/memory/archive",
}));

vi.mock("../lib/utils/date", () => ({
  getCurrentTime: () => "2026-08-08T01:02:03.456Z",
}));

vi.mock("../lib/logger", () => ({
  logger: {
    audit: {
      info: vi.fn(),
    },
  },
}));

import { AuditReportWriter } from "../server/services/audit-report-writer";

describe("AuditReportWriter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a timestamped markdown report under archive audits", async () => {
    const reporter = {
      generateMarkdownReport: vi.fn().mockResolvedValue("# Audit"),
    };
    const writer = new AuditReportWriter(reporter);

    const filePath = await writer.write();

    expect(reporter.generateMarkdownReport).toHaveBeenCalledOnce();
    expect(mkdirSyncMock).toHaveBeenCalledWith("/memory/archive/audits", { recursive: true });
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      "/memory/archive/audits/audit-2026-08-08T01-02-03.md",
      "# Audit",
      "utf-8",
    );
    expect(filePath).toBe("/memory/archive/audits/audit-2026-08-08T01-02-03.md");
  });
});
