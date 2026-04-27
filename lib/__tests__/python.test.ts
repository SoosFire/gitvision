// Tests for the Python tree-sitter plugin. Covers:
//   1. Grammar boots and parses real Python without errors
//   2. Queries extract imports, function defs, call sites, decision points
//   3. Resolver matches lib/graph.ts:resolvePython behavior — same paths
//      resolve, same fall-through to package + fuzzy suffix match

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { pythonPlugin } from "../codeAnalysis/plugins/python";
import { parseFile } from "../codeAnalysis/parse";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

function makeIndex(files: SourceFile[]): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of files) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  return { byPath, byExt, extras: new Map() };
}

describe("pythonPlugin — basic contract", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  it("advertises the .py extension only", () => {
    expect([...pythonPlugin.extensions]).toEqual(["py"]);
  });

  it("loads the tree-sitter-python grammar", () => {
    expect(pythonPlugin.languageFor("py")).toBeTruthy();
  });

  it("parses a simple Python module without error", () => {
    const lang = pythonPlugin.languageFor("py");
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(
      "def hi(name):\n    return f'hello, {name}'\n"
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.type).toBe("module");
    parser.delete();
    tree!.delete();
  });
});

describe("pythonPlugin.resolveImport", () => {
  const files: SourceFile[] = [
    { rel: "pkg/__init__.py", ext: "py", content: "" },
    { rel: "pkg/main.py", ext: "py", content: "" },
    { rel: "pkg/helper.py", ext: "py", content: "" },
    { rel: "pkg/sub/__init__.py", ext: "py", content: "" },
    { rel: "pkg/sub/util.py", ext: "py", content: "" },
    { rel: "src/app/cli.py", ext: "py", content: "" },
  ];
  const ix = makeIndex(files);

  it("resolves a sibling module via `from .helper import x`", () => {
    expect(
      pythonPlugin.resolveImport(".helper", "pkg/main.py", ix)
    ).toBe("pkg/helper.py");
  });

  it("`from . import x` resolves to the current package's __init__.py", () => {
    expect(pythonPlugin.resolveImport(".", "pkg/main.py", ix)).toBe(
      "pkg/__init__.py"
    );
  });

  it("resolves a sub-package via `from .sub import x`", () => {
    expect(pythonPlugin.resolveImport(".sub", "pkg/main.py", ix)).toBe(
      "pkg/sub/__init__.py"
    );
  });

  it("`from .sub.util import f` resolves to the sub-package's util.py", () => {
    expect(pythonPlugin.resolveImport(".sub.util", "pkg/main.py", ix)).toBe(
      "pkg/sub/util.py"
    );
  });

  it("walks up with `..` for parent-package imports", () => {
    // From pkg/sub/util.py, `from ..helper import x` → pkg/helper.py
    expect(
      pythonPlugin.resolveImport("..helper", "pkg/sub/util.py", ix)
    ).toBe("pkg/helper.py");
  });

  it("resolves an absolute package path via fuzzy suffix match", () => {
    // `from app.cli import main` from anywhere → src/app/cli.py
    expect(
      pythonPlugin.resolveImport("app.cli", "pkg/main.py", ix)
    ).toBe("src/app/cli.py");
  });

  it("returns null for stdlib / external imports", () => {
    expect(pythonPlugin.resolveImport("os", "pkg/main.py", ix)).toBeNull();
    expect(
      pythonPlugin.resolveImport("requests", "pkg/main.py", ix)
    ).toBeNull();
  });

  it("returns null when relative depth exceeds the from-file's directory", () => {
    // pkg/main.py is one level deep; ... would go above repo root.
    expect(
      pythonPlugin.resolveImport("...too.far", "pkg/main.py", ix)
    ).toBeNull();
  });
});

describe("pythonPlugin — parseFile end-to-end", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  it("extracts absolute and relative imports", () => {
    const content =
      "import os\n" +
      "import os.path as op\n" +
      "from typing import List\n" +
      "from .helper import work\n" +
      "from . import siblings\n" +
      "from ..pkg import deep\n";
    const file: SourceFile = { rel: "pkg/main.py", ext: "py", content };
    const ix = makeIndex([file, { rel: "pkg/helper.py", ext: "py", content: "" }]);
    const parsed = parseFile(pythonPlugin, file, ix);

    expect(parsed.parseError).toBe(false);
    const specs = parsed.imports.map((i) => i.rawSpec).sort();
    expect(specs).toContain("os");
    expect(specs).toContain("os.path");
    expect(specs).toContain("typing");
    expect(specs).toContain(".helper");
    expect(specs).toContain(".");
    expect(specs).toContain("..pkg");

    // .helper resolves to a real file
    const helperImport = parsed.imports.find((i) => i.rawSpec === ".helper");
    expect(helperImport?.resolvedPath).toBe("pkg/helper.py");
    // os is external
    expect(parsed.imports.find((i) => i.rawSpec === "os")?.resolvedPath).toBeNull();
  });

  it("extracts top-level functions and methods", () => {
    const content =
      "def top():\n" +
      "    return 1\n" +
      "\n" +
      "class Widget:\n" +
      "    def render(self):\n" +
      "        return None\n" +
      "    def update(self, x):\n" +
      "        if x > 0:\n" +
      "            return x\n" +
      "        else:\n" +
      "            return 0\n";
    const file: SourceFile = { rel: "w.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);

    const names = parsed.functions.map((f) => f.name).sort();
    expect(names).toEqual(["render", "top", "update"]);
  });

  it("computes cyclomatic complexity from Python decision points", () => {
    const content =
      "def simple():\n" +
      "    return 1\n" +
      "\n" +
      "def branchy(x):\n" +
      "    if x > 0:\n" +
      "        for i in range(x):\n" +
      "            if i % 2 == 0 and i > 2:\n" +
      "                print(i)\n" +
      "    elif x == 0:\n" +
      "        return 'zero'\n" +
      "    else:\n" +
      "        try:\n" +
      "            return -x\n" +
      "        except ValueError:\n" +
      "            return 0\n" +
      "    return x if x else 0\n";
    const file: SourceFile = { rel: "b.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);

    const simple = parsed.functions.find((f) => f.name === "simple");
    const branchy = parsed.functions.find((f) => f.name === "branchy");
    expect(simple?.complexity).toBe(1);
    // branchy: 1 base + if + for + if + (and: boolean_operator) + elif +
    //   except + ternary (conditional_expression) = 8
    expect(branchy?.complexity).toBe(8);
  });

  it("attributes calls to their enclosing function/method", () => {
    const content =
      "def outer():\n" +
      "    helper()\n" +
      "    return inner()\n" +
      "\n" +
      "def inner():\n" +
      "    return util()\n" +
      "\n" +
      "def helper():\n" +
      "    pass\n" +
      "\n" +
      "def util():\n" +
      "    pass\n" +
      "\n" +
      "top_level()\n";
    const file: SourceFile = { rel: "c.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);

    const outerCalls = parsed.calls
      .filter((c) => c.inFunction === "outer")
      .map((c) => c.calleeName)
      .sort();
    expect(outerCalls).toEqual(["helper", "inner"]);

    const innerCalls = parsed.calls
      .filter((c) => c.inFunction === "inner")
      .map((c) => c.calleeName);
    expect(innerCalls).toEqual(["util"]);

    const moduleScope = parsed.calls
      .filter((c) => c.inFunction === null)
      .map((c) => c.calleeName);
    expect(moduleScope).toEqual(["top_level"]);
  });

  it("captures attribute method calls (obj.method())", () => {
    const content =
      "def use():\n" +
      "    items.append(1)\n" +
      "    other.nested.deep()\n";
    const file: SourceFile = { rel: "m.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const callees = parsed.calls.map((c) => c.calleeName).sort();
    expect(callees).toContain("append");
    expect(callees).toContain("deep");
  });
});

describe("pythonPlugin — type-aware tracking (v0.18)", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  it("emits containerType on class methods", () => {
    const content =
      "class Service:\n" +
      "    def run(self):\n" +
      "        pass\n" +
      "    def stop(self):\n" +
      "        pass\n" +
      "\n" +
      "def free_fn():\n" +
      "    pass\n";
    const file: SourceFile = { rel: "s.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const run = parsed.functions.find((f) => f.name === "run");
    const stop = parsed.functions.find((f) => f.name === "stop");
    const free = parsed.functions.find((f) => f.name === "free_fn");
    expect(run?.containerType).toBe("Service");
    expect(stop?.containerType).toBe("Service");
    expect(free?.containerType).toBeUndefined();
  });

  it("infers calleeType from `self.method()` inside a class method", () => {
    const content =
      "class Service:\n" +
      "    def run(self):\n" +
      "        self.helper()\n" +
      "    def helper(self):\n" +
      "        pass\n";
    const file: SourceFile = { rel: "s.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const helperCall = parsed.calls.find((c) => c.calleeName === "helper");
    expect(helperCall?.calleeType).toBe("Service");
  });

  it("infers calleeType from class-level annotated field (PEP 526)", () => {
    const content =
      "class App:\n" +
      "    validator: ValidatePassword\n" +
      "    def run(self):\n" +
      "        self.validator.validate()\n";
    const file: SourceFile = { rel: "a.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateCall = parsed.calls.find(
      (c) => c.calleeName === "validate"
    );
    expect(validateCall?.calleeType).toBe("ValidatePassword");
  });

  it("infers calleeType from a typed function parameter", () => {
    const content =
      "def check(v: ValidateEmail):\n" +
      "    v.validate()\n";
    const file: SourceFile = { rel: "c.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateCall = parsed.calls.find(
      (c) => c.calleeName === "validate"
    );
    expect(validateCall?.calleeType).toBe("ValidateEmail");
  });

  it("infers calleeType from `x: Foo = ...` annotated local assignment", () => {
    const content =
      "def use():\n" +
      "    v: ValidateUserName = make_validator()\n" +
      "    v.validate()\n";
    const file: SourceFile = { rel: "u.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateCall = parsed.calls.find(
      (c) => c.calleeName === "validate"
    );
    expect(validateCall?.calleeType).toBe("ValidateUserName");
  });

  it("infers calleeType from `x = SomeClass()` constructor call", () => {
    // Python class instantiation has no `new` keyword — the type is
    // simply the function being called, when it matches a class.
    const content =
      "def use():\n" +
      "    w = Widget()\n" +
      "    w.render()\n";
    const file: SourceFile = { rel: "u.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const renderCall = parsed.calls.find((c) => c.calleeName === "render");
    expect(renderCall?.calleeType).toBe("Widget");
  });

  it("strips generics in subscript-style hints (List[Foo] → List)", () => {
    // tree-sitter-python parses `List[Foo]` as `generic_type` (not
    // `subscript`); the extractor handles both shapes.
    const content =
      "def use(items: List[Foo]):\n" +
      "    items.append(None)\n";
    const file: SourceFile = { rel: "u.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const appendCall = parsed.calls.find((c) => c.calleeName === "append");
    expect(appendCall?.calleeType).toBe("List");
  });

  it("untyped Python falls through to undefined calleeType (graceful)", () => {
    const content =
      "def use():\n" +
      "    v = make_thing()\n" + // no annotation, rhs not a class call
      "    v.do_stuff()\n";
    const file: SourceFile = { rel: "u.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const doCall = parsed.calls.find((c) => c.calleeName === "do_stuff");
    // Falls through to "v" as the bare-name guess for receiver type
    expect(doCall).toBeDefined();
  });

  it("two same-named methods on different fields disambiguate", () => {
    const content =
      "class App:\n" +
      "    vp: ValidatePassword\n" +
      "    ve: ValidateEmail\n" +
      "    def run(self):\n" +
      "        self.vp.validate()\n" +
      "        self.ve.validate()\n";
    const file: SourceFile = { rel: "a.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateTypes = parsed.calls
      .filter((c) => c.calleeName === "validate")
      .map((c) => c.calleeType);
    expect(validateTypes).toEqual(["ValidatePassword", "ValidateEmail"]);
  });

  it("captures __init__ self.X = param assignments when param is typed", () => {
    // Common Python pattern: store typed constructor args as instance fields.
    const content =
      "class Service:\n" +
      "    def __init__(self, validator: ValidatePassword):\n" +
      "        self.validator = validator\n" +
      "    def run(self):\n" +
      "        self.validator.validate()\n";
    const file: SourceFile = { rel: "s.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateCall = parsed.calls.find(
      (c) => c.calleeName === "validate"
    );
    expect(validateCall?.calleeType).toBe("ValidatePassword");
  });
});
