import { describe, it, expect } from "vitest";
import {
  pypiPlugin,
  normalizePyPiVersion,
} from "../depsHealth/ecosystems/pypi";

describe("PyPI normalizeVersion", () => {
  it("handles == pin", () => {
    expect(normalizePyPiVersion("==2.31.0")).toBe("2.31.0");
  });
  it("handles >= and comparison", () => {
    expect(normalizePyPiVersion(">=2.0")).toBe("2.0");
    expect(normalizePyPiVersion(">2.0")).toBe("2.0");
  });
  it("handles compatible-release ~= ", () => {
    expect(normalizePyPiVersion("~=2.31")).toBe("2.31");
  });
  it("takes first version in multi-clause range", () => {
    expect(normalizePyPiVersion(">=2.0,<3.0")).toBe("2.0");
  });
  it("strips PEP 508 environment markers", () => {
    expect(normalizePyPiVersion(">=2.0; python_version >= '3.7'")).toBe("2.0");
  });
  it("rejects wildcard and bare names", () => {
    expect(normalizePyPiVersion("*")).toBeNull();
    expect(normalizePyPiVersion("")).toBeNull();
  });
});

describe("pypiPlugin.isManifest", () => {
  it("matches pyproject.toml at root and nested", () => {
    expect(pypiPlugin.isManifest("pyproject.toml")).toBe(true);
    expect(pypiPlugin.isManifest("libs/foo/pyproject.toml")).toBe(true);
  });
  it("matches requirements.txt variants", () => {
    expect(pypiPlugin.isManifest("requirements.txt")).toBe(true);
    expect(pypiPlugin.isManifest("requirements-dev.txt")).toBe(true);
    expect(pypiPlugin.isManifest("requirements/dev.txt")).toBe(false); // dir, not pattern
    expect(pypiPlugin.isManifest("backend/requirements.txt")).toBe(true);
  });
  it("does not match package.json or Cargo.toml", () => {
    expect(pypiPlugin.isManifest("package.json")).toBe(false);
    expect(pypiPlugin.isManifest("Cargo.toml")).toBe(false);
  });
});

describe("pypiPlugin.parseManifest — requirements.txt", () => {
  it("parses simple pinned versions", () => {
    const content = `requests==2.31.0
click>=8.1,<9.0
pydantic~=2.0`;
    const deps = pypiPlugin.parseManifest("requirements.txt", content);
    expect(deps.map((d) => `${d.name}@${d.declared}`).sort()).toEqual([
      "click@>=8.1,<9.0",
      "pydantic@~=2.0",
      "requests@==2.31.0",
    ]);
  });

  it("ignores comments and blank lines", () => {
    const content = `# core deps
requests==2.31.0

# dev deps — don't count comments
pytest==7.0`;
    const deps = pypiPlugin.parseManifest("requirements.txt", content);
    expect(deps).toHaveLength(2);
    expect(deps.map((d) => d.name).sort()).toEqual(["pytest", "requests"]);
  });

  it("skips -r, -e, URL-pinned entries", () => {
    const content = `requests==2.31.0
-r other.txt
-e .
foo @ https://example.com/foo.tar.gz`;
    const deps = pypiPlugin.parseManifest("requirements.txt", content);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe("requests");
  });

  it("normalizes package names (PEP 503)", () => {
    const content = `Django_rest_framework==3.14`;
    const deps = pypiPlugin.parseManifest("requirements.txt", content);
    expect(deps[0].name).toBe("django-rest-framework");
  });

  it("handles extras syntax", () => {
    const content = `requests[security]>=2.31`;
    const deps = pypiPlugin.parseManifest("requirements.txt", content);
    expect(deps[0].name).toBe("requests");
  });
});

describe("pypiPlugin.parseManifest — pyproject.toml", () => {
  it("parses PEP 621 [project] dependencies", () => {
    const toml = `
[project]
name = "myapp"
dependencies = [
  "requests>=2.0",
  "click~=8.1",
]
[project.optional-dependencies]
dev = ["pytest==7.0", "black>=23.0"]
`;
    const deps = pypiPlugin.parseManifest("pyproject.toml", toml);
    expect(deps.map((d) => d.name).sort()).toEqual([
      "black",
      "click",
      "pytest",
      "requests",
    ]);
  });

  it("parses Poetry [tool.poetry.dependencies]", () => {
    const toml = `
[tool.poetry]
name = "myapp"

[tool.poetry.dependencies]
python = "^3.10"
requests = "^2.31"
pydantic = { version = "^2.0", extras = ["email"] }

[tool.poetry.dev-dependencies]
pytest = "^7.0"

[tool.poetry.group.test.dependencies]
coverage = "^7.0"
`;
    const deps = pypiPlugin.parseManifest("pyproject.toml", toml);
    // python is skipped (Python runtime version, not a package)
    expect(deps.map((d) => d.name).sort()).toEqual([
      "coverage",
      "pydantic",
      "pytest",
      "requests",
    ]);
  });

  it("skips Poetry git/path/url sources", () => {
    const toml = `
[tool.poetry.dependencies]
python = "^3.10"
foo = { git = "https://github.com/x/foo" }
bar = { path = "../bar" }
baz = "^1.0"
`;
    const deps = pypiPlugin.parseManifest("pyproject.toml", toml);
    expect(deps.map((d) => d.name)).toEqual(["baz"]);
  });

  it("returns empty on unparseable TOML", () => {
    expect(pypiPlugin.parseManifest("pyproject.toml", "[invalid")).toEqual([]);
  });
});
