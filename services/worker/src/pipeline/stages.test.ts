import { describe, expect, it } from "vitest";
import { nextStageOf } from "./stages.js";

describe("nextStageOf", () => {
  it("walks the stage list in order and ends at finalize", () => {
    expect(nextStageOf("ingest")).toBe("manifest");
    expect(nextStageOf("generate_tests")).toBe("verify_baseline");
    expect(nextStageOf("finalize")).toBeNull();
  });
});
