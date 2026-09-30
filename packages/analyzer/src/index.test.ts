import { describe, expect, it } from "vitest";
import { isDeniedPatchPath } from "./index.js";

describe("patch path denylist", () => {
  it.each([".github/workflows/ci.yml", "Dockerfile", "Dockerfile.prod", "package-lock.json", ".env.local", "src/.git/config", ".npmrc"])(
    "denies %s",
    (p) => expect(isDeniedPatchPath(p)).toBe(true),
  );
  it.each(["src/index.ts", "test/x.test.ts", "package.json", "README.md", "github/helpers.ts"])("allows %s", (p) =>
    expect(isDeniedPatchPath(p)).toBe(false),
  );
});
