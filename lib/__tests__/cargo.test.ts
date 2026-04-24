import { describe, it, expect } from "vitest";
import {
  cargoPlugin,
  normalizeCargoVersion,
} from "../depsHealth/ecosystems/cargo";

describe("Cargo normalizeVersion", () => {
  it("strips caret prefix", () => {
    expect(normalizeCargoVersion("^1.2.3")).toBe("1.2.3");
  });
  it("strips tilde prefix", () => {
    expect(normalizeCargoVersion("~1.0")).toBe("1.0");
  });
  it("handles comparison operators", () => {
    expect(normalizeCargoVersion(">=1.0.0")).toBe("1.0.0");
  });
  it("passes through plain semver", () => {
    expect(normalizeCargoVersion("0.10.42")).toBe("0.10.42");
  });
  it("takes first version from multi-range", () => {
    expect(normalizeCargoVersion(">=1.0, <2.0")).toBe("1.0");
  });
  it("returns null for non-semver specs", () => {
    expect(normalizeCargoVersion("*")).toBeNull();
    expect(normalizeCargoVersion("")).toBeNull();
    expect(normalizeCargoVersion("latest")).toBeNull();
  });
});

describe("cargoPlugin.isManifest", () => {
  it("matches root Cargo.toml", () => {
    expect(cargoPlugin.isManifest("Cargo.toml")).toBe(true);
  });
  it("matches nested Cargo.toml", () => {
    expect(cargoPlugin.isManifest("crates/foo/Cargo.toml")).toBe(true);
  });
  it("does not match package.json", () => {
    expect(cargoPlugin.isManifest("package.json")).toBe(false);
  });
  it("does not match cargo.toml (case-sensitive)", () => {
    expect(cargoPlugin.isManifest("cargo.toml")).toBe(false);
  });
});

describe("cargoPlugin.parseManifest", () => {
  it("parses simple string-version dependencies", () => {
    const toml = `
[package]
name = "example"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = "1.32.0"
`;
    const deps = cargoPlugin.parseManifest("Cargo.toml", toml);
    expect(deps).toEqual([
      { name: "serde", declared: "1.0", sourcePath: "Cargo.toml" },
      { name: "tokio", declared: "1.32.0", sourcePath: "Cargo.toml" },
    ]);
  });

  it("parses inline-table dependencies with version", () => {
    const toml = `
[dependencies]
tokio = { version = "1.32", features = ["full"] }
reqwest = { version = "0.11", default-features = false }
`;
    const deps = cargoPlugin.parseManifest("Cargo.toml", toml);
    expect(deps.map((d) => `${d.name}@${d.declared}`).sort()).toEqual([
      "reqwest@0.11",
      "tokio@1.32",
    ]);
  });

  it("skips git and path dependencies (no version to query)", () => {
    const toml = `
[dependencies]
foo = { git = "https://github.com/x/foo" }
bar = { path = "../bar" }
baz = "1.0"
`;
    const deps = cargoPlugin.parseManifest("Cargo.toml", toml);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe("baz");
  });

  it("respects renamed dependencies (package = ...)", () => {
    const toml = `
[dependencies]
my-rand = { package = "rand", version = "0.8" }
`;
    const deps = cargoPlugin.parseManifest("Cargo.toml", toml);
    expect(deps).toEqual([
      { name: "rand", declared: "0.8", sourcePath: "Cargo.toml" },
    ]);
  });

  it("picks up dev-dependencies and build-dependencies too", () => {
    const toml = `
[dependencies]
serde = "1.0"

[dev-dependencies]
criterion = "0.5"

[build-dependencies]
cc = "1.0"
`;
    const deps = cargoPlugin.parseManifest("Cargo.toml", toml);
    expect(deps.map((d) => d.name).sort()).toEqual(["cc", "criterion", "serde"]);
  });

  it("parses workspace-level dependencies", () => {
    const toml = `
[workspace]
members = ["crates/*"]

[workspace.dependencies]
serde = "1.0"
tokio = { version = "1.32", features = ["full"] }
`;
    const deps = cargoPlugin.parseManifest("Cargo.toml", toml);
    expect(deps.map((d) => `${d.name}@${d.declared}`).sort()).toEqual([
      "serde@1.0",
      "tokio@1.32",
    ]);
  });

  it("returns empty array on unparseable TOML", () => {
    const deps = cargoPlugin.parseManifest("Cargo.toml", "not valid toml {}");
    expect(deps).toEqual([]);
  });
});
