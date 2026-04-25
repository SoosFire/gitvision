// Tests for the Java tree-sitter plugin. Covers:
//   1. Grammar boots and parses Java without error
//   2. prepareForRepo builds FQN→path and package→members maps from the
//      package declarations in the FileIndex
//   3. resolveImport: direct FQN, wildcard via package fallback, external
//      stdlib imports → null
//   4. parseFile end-to-end: imports, methods, constructors, calls, complexity

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { javaPlugin } from "../codeAnalysis/plugins/java";
import { parseFile } from "../codeAnalysis/parse";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

function makeIndex(
  files: SourceFile[],
  extras: Map<string, unknown> = new Map()
): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of files) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  return { byPath, byExt, extras };
}

describe("javaPlugin — basic contract", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  it("advertises the .java extension only", () => {
    expect([...javaPlugin.extensions]).toEqual(["java"]);
  });

  it("loads the tree-sitter-java grammar", () => {
    expect(javaPlugin.languageFor("java")).toBeTruthy();
  });

  it("parses a simple Java class without error", () => {
    const lang = javaPlugin.languageFor("java");
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(
      "package com.foo;\n\npublic class Bar {\n  public int hi() { return 1; }\n}\n"
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.type).toBe("program");
    parser.delete();
    tree!.delete();
  });
});

describe("javaPlugin.prepareForRepo + resolveImport", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  /** A small synthetic Spring-style codebase. */
  const files: SourceFile[] = [
    {
      rel: "src/main/java/com/example/App.java",
      ext: "java",
      content: "package com.example;\n\npublic class App {}\n",
    },
    {
      rel: "src/main/java/com/example/User.java",
      ext: "java",
      content: "package com.example;\n\npublic class User {}\n",
    },
    {
      rel: "src/main/java/com/example/UserService.java",
      ext: "java",
      content: "package com.example;\n\npublic class UserService {}\n",
    },
    {
      rel: "src/main/java/com/example/web/Controller.java",
      ext: "java",
      content: "package com.example.web;\n\npublic class Controller {}\n",
    },
    {
      rel: "src/main/java/com/example/web/Helper.java",
      ext: "java",
      content: "package com.example.web;\n\npublic class Helper {}\n",
    },
    {
      // No package declaration — default package
      rel: "src/main/java/Bare.java",
      ext: "java",
      content: "public class Bare {}\n",
    },
  ];

  it("builds a context that resolves direct FQN imports", async () => {
    const ix = makeIndex(files);
    await javaPlugin.prepareForRepo("/fake/root", ix);
    expect(
      javaPlugin.resolveImport(
        "com.example.User",
        "src/main/java/com/example/App.java",
        ix
      )
    ).toBe("src/main/java/com/example/User.java");
  });

  it("resolves a wildcard import via the package-members fallback", async () => {
    const ix = makeIndex(files);
    await javaPlugin.prepareForRepo("/fake/root", ix);
    // `import com.example.web.*;` — spec captured as "com.example.web"
    // since wildcard isn't part of scoped_identifier in the grammar.
    // We resolve to the alphabetically-first member of the package.
    const resolved = javaPlugin.resolveImport(
      "com.example.web",
      "src/main/java/com/example/App.java",
      ix
    );
    expect(resolved).toBe("src/main/java/com/example/web/Controller.java");
  });

  it("returns null for stdlib / external imports", async () => {
    const ix = makeIndex(files);
    await javaPlugin.prepareForRepo("/fake/root", ix);
    expect(
      javaPlugin.resolveImport(
        "java.util.List",
        "src/main/java/com/example/App.java",
        ix
      )
    ).toBeNull();
    expect(
      javaPlugin.resolveImport(
        "org.springframework.boot.SpringApplication",
        "src/main/java/com/example/App.java",
        ix
      )
    ).toBeNull();
  });

  it("indexes default-package classes (no `package` declaration) by bare class name", async () => {
    const ix = makeIndex(files);
    await javaPlugin.prepareForRepo("/fake/root", ix);
    expect(
      javaPlugin.resolveImport("Bare", "src/main/java/Bare.java", ix)
    ).toBe("src/main/java/Bare.java");
  });
});

describe("javaPlugin — parseFile end-to-end", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  it("captures imports including static and wildcard forms", () => {
    const content =
      "package com.example;\n" +
      "\n" +
      "import com.example.User;\n" +
      "import com.example.web.*;\n" +
      "import java.util.List;\n" +
      "import static org.junit.jupiter.api.Assertions.assertEquals;\n" +
      "\n" +
      "public class Service {}\n";
    const file: SourceFile = {
      rel: "src/main/java/com/example/Service.java",
      ext: "java",
      content,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    expect(parsed.parseError).toBe(false);
    const specs = parsed.imports.map((i) => i.rawSpec).sort();
    expect(specs).toContain("com.example.User");
    expect(specs).toContain("com.example.web"); // wildcard captured as package
    expect(specs).toContain("java.util.List");
  });

  it("extracts methods and constructors", () => {
    const content =
      "package com.example;\n" +
      "\n" +
      "public class Widget {\n" +
      "  public Widget() {}\n" +
      "  public Widget(int seed) {}\n" +
      "  public int render() { return 1; }\n" +
      "  private void update(int x) {\n" +
      "    if (x > 0) System.out.println(x);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = {
      rel: "Widget.java",
      ext: "java",
      content,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const names = parsed.functions.map((f) => f.name).sort();
    // Two constructors (overloaded) both named "Widget" + render + update
    expect(names.filter((n) => n === "Widget").length).toBe(2);
    expect(names).toContain("render");
    expect(names).toContain("update");
  });

  it("computes complexity from Java decision points", () => {
    const content =
      "package com.example;\n" +
      "public class Branchy {\n" +
      "  public int simple() { return 1; }\n" +
      "  public int branchy(int x) {\n" +
      "    if (x > 0) {\n" +
      "      for (int i = 0; i < x; i++) {\n" +
      "        if (i % 2 == 0 && i > 2) {\n" +
      "          return i;\n" +
      "        }\n" +
      "      }\n" +
      "    } else if (x < 0) {\n" +
      "      switch (x) {\n" +
      "        case -1: return -1;\n" +
      "        case -2: return -2;\n" +
      "        default: return 0;\n" +
      "      }\n" +
      "    }\n" +
      "    try {\n" +
      "      return x > 5 ? -x : x;\n" +
      "    } catch (RuntimeException e) {\n" +
      "      return 0;\n" +
      "    }\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Branchy.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const simple = parsed.functions.find((f) => f.name === "simple");
    const branchy = parsed.functions.find((f) => f.name === "branchy");
    expect(simple?.complexity).toBe(1);
    // branchy: 1 base + outer if + for + inner if + && + else-if (nested
    // if_statement) + 2 case clauses + ternary + catch = 10
    // (default not counted, matching the JS plugin convention)
    expect(branchy?.complexity).toBe(10);
  });

  it("captures method invocations and object creation as calls", () => {
    const content =
      "package com.example;\n" +
      "import java.util.ArrayList;\n" +
      "public class Outer {\n" +
      "  public void run() {\n" +
      "    helper();\n" +
      "    System.out.println(\"hi\");\n" +
      "    ArrayList<String> list = new ArrayList<>();\n" +
      "  }\n" +
      "  void helper() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Outer.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const callees = parsed.calls.map((c) => c.calleeName).sort();
    expect(callees).toContain("helper"); // method_invocation
    expect(callees).toContain("println"); // selector method_invocation
    expect(callees).toContain("ArrayList"); // object_creation_expression
  });

  it("attributes calls to the enclosing method", () => {
    const content =
      "package com.example;\n" +
      "public class C {\n" +
      "  public void outer() {\n" +
      "    helper();\n" +
      "  }\n" +
      "  public void inner() {\n" +
      "    util();\n" +
      "  }\n" +
      "  void helper() {}\n" +
      "  void util() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "C.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const outerCalls = parsed.calls
      .filter((c) => c.inFunction === "outer")
      .map((c) => c.calleeName);
    expect(outerCalls).toEqual(["helper"]);
    const innerCalls = parsed.calls
      .filter((c) => c.inFunction === "inner")
      .map((c) => c.calleeName);
    expect(innerCalls).toEqual(["util"]);
  });
});
