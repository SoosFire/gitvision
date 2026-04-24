import { describe, it, expect } from "vitest";
import { normalizeNpmVersion as normalizeVersion } from "../depsHealth/ecosystems/npm";

describe("npm normalizeVersion", () => {
  it("strips caret prefix", () => {
    expect(normalizeVersion("^1.2.3")).toBe("1.2.3");
  });

  it("strips tilde prefix", () => {
    expect(normalizeVersion("~2.0.1")).toBe("2.0.1");
  });

  it("strips comparison operators", () => {
    expect(normalizeVersion(">=1.0.0")).toBe("1.0.0");
    expect(normalizeVersion(">1.0.0")).toBe("1.0.0");
    expect(normalizeVersion("<=1.0.0")).toBe("1.0.0");
  });

  it("returns plain semver unchanged", () => {
    expect(normalizeVersion("1.2.3")).toBe("1.2.3");
  });

  it("takes first version from a multi-range", () => {
    expect(normalizeVersion(">=1.2.3 <2.0.0")).toBe("1.2.3");
    expect(normalizeVersion("1.2.3 || 2.0.0")).toBe("1.2.3");
  });

  it("handles pre-release versions", () => {
    expect(normalizeVersion("^1.2.3-beta.1")).toBe("1.2.3-beta.1");
  });

  it("returns null for non-semver", () => {
    expect(normalizeVersion("*")).toBeNull();
    expect(normalizeVersion("latest")).toBeNull();
    expect(normalizeVersion("next")).toBeNull();
    expect(normalizeVersion("workspace:*")).toBeNull();
    expect(normalizeVersion("file:../other")).toBeNull();
    expect(normalizeVersion("github:owner/repo")).toBeNull();
    expect(normalizeVersion("https://example.com/pkg.tgz")).toBeNull();
    expect(normalizeVersion("")).toBeNull();
  });

  it("handles two-digit semver (missing patch)", () => {
    expect(normalizeVersion("1.2")).toBe("1.2");
  });
});
