// Tests for the C# tree-sitter plugin (v0.21). Mirrors the Java test layout
// (basic contract / prepareForRepo + resolveImport / parseFile end-to-end /
// type-aware tracking) since both plugins share the same Phase 5 architecture.
//
// Where C#-specific behavior diverges from Java, the test names call it out
// explicitly so failures localize quickly.

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { csharpPlugin } from "../codeAnalysis/plugins/csharp";
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

describe("csharpPlugin — basic contract", () => {
  beforeAll(async () => {
    await csharpPlugin.load();
  });

  it("advertises the .cs extension only", () => {
    expect([...csharpPlugin.extensions]).toEqual(["cs"]);
  });

  it("loads the tree-sitter-c-sharp grammar", () => {
    expect(csharpPlugin.languageFor("cs")).toBeTruthy();
  });

  it("parses a simple C# class without error", () => {
    const lang = csharpPlugin.languageFor("cs");
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(
      "namespace App;\npublic class Bar {\n  public int Hi() { return 1; }\n}\n"
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.type).toBe("compilation_unit");
    parser.delete();
    tree!.delete();
  });
});

describe("csharpPlugin.prepareForRepo + resolveImport", () => {
  beforeAll(async () => {
    await csharpPlugin.load();
  });

  /** Synthetic mini-project covering: block namespace, file-scoped namespace,
   *  default namespace, multiple types per namespace. */
  const files: SourceFile[] = [
    {
      rel: "src/App.cs",
      ext: "cs",
      content: "namespace App;\npublic class App {}\n",
    },
    {
      rel: "src/User.cs",
      ext: "cs",
      content: "namespace App;\npublic class User {}\n",
    },
    {
      rel: "src/UserService.cs",
      ext: "cs",
      content: "namespace App;\npublic class UserService {}\n",
    },
    {
      rel: "src/web/Controller.cs",
      ext: "cs",
      content:
        "namespace App.Web\n{\n  public class Controller {}\n}\n",
    },
    {
      rel: "src/web/Helper.cs",
      ext: "cs",
      content:
        "namespace App.Web\n{\n  public class Helper {}\n}\n",
    },
    {
      // No namespace declaration — default namespace
      rel: "src/Bare.cs",
      ext: "cs",
      content: "public class Bare {}\n",
    },
  ];

  it("builds a context that resolves direct FQN imports", async () => {
    const ix = makeIndex(files);
    await csharpPlugin.prepareForRepo("/fake/root", ix);
    expect(
      csharpPlugin.resolveImport("App.User", "src/App.cs", ix)
    ).toBe("src/User.cs");
  });

  it("resolves a `using App.Web;` namespace-only import via package fallback", async () => {
    const ix = makeIndex(files);
    await csharpPlugin.prepareForRepo("/fake/root", ix);
    // C#'s `using` doesn't have wildcard syntax — `using App.Web;` brings in
    // every type in that namespace. Spec captured by parseDirect is "App.Web";
    // resolve to the alphabetically-first member.
    const resolved = csharpPlugin.resolveImport(
      "App.Web",
      "src/App.cs",
      ix
    );
    expect(resolved).toBe("src/web/Controller.cs");
  });

  it("returns null for stdlib / external imports", async () => {
    const ix = makeIndex(files);
    await csharpPlugin.prepareForRepo("/fake/root", ix);
    expect(csharpPlugin.resolveImport("System", "src/App.cs", ix)).toBeNull();
    expect(
      csharpPlugin.resolveImport(
        "System.Collections.Generic",
        "src/App.cs",
        ix
      )
    ).toBeNull();
    expect(
      csharpPlugin.resolveImport(
        "Microsoft.AspNetCore.Mvc",
        "src/App.cs",
        ix
      )
    ).toBeNull();
  });

  it("indexes default-namespace classes (no namespace declaration) by bare name", async () => {
    const ix = makeIndex(files);
    await csharpPlugin.prepareForRepo("/fake/root", ix);
    expect(csharpPlugin.resolveImport("Bare", "src/Bare.cs", ix)).toBe(
      "src/Bare.cs"
    );
  });
});

describe("csharpPlugin — parseFile end-to-end", () => {
  beforeAll(async () => {
    await csharpPlugin.load();
  });

  it("captures using directives (plain, qualified, and static forms)", () => {
    const content =
      "using System;\n" +
      "using System.Collections.Generic;\n" +
      "using static System.Math;\n" +
      "namespace App;\n" +
      "public class Service {}\n";
    const file: SourceFile = {
      rel: "src/Service.cs",
      ext: "cs",
      content,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    expect(parsed.parseError).toBe(false);
    const specs = parsed.imports.map((i) => i.rawSpec).sort();
    expect(specs).toContain("System");
    expect(specs).toContain("System.Collections.Generic");
    // `using static System.Math;` — qualified_name "System.Math" is captured
    expect(specs).toContain("System.Math");
  });

  it("extracts methods and constructors", () => {
    const content =
      "namespace App;\n" +
      "public class Widget\n" +
      "{\n" +
      "  public Widget() {}\n" +
      "  public Widget(int seed) {}\n" +
      "  public int Render() { return 1; }\n" +
      "  private void Update(int x)\n" +
      "  {\n" +
      "    if (x > 0) System.Console.WriteLine(x);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Widget.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const names = parsed.functions.map((f) => f.name).sort();
    // Two constructors (overloaded) both named "Widget" + Render + Update
    expect(names.filter((n) => n === "Widget").length).toBe(2);
    expect(names).toContain("Render");
    expect(names).toContain("Update");
  });

  it("computes complexity from C# decision points", () => {
    const content =
      "namespace App;\n" +
      "public class Branchy\n" +
      "{\n" +
      "  public int Simple() { return 1; }\n" +
      "  public int Branchy(int x)\n" +
      "  {\n" +
      "    if (x > 0)\n" +
      "    {\n" +
      "      for (int i = 0; i < x; i++)\n" +
      "      {\n" +
      "        if (i % 2 == 0 && i > 2) return i;\n" +
      "      }\n" +
      "    }\n" +
      "    else if (x < 0)\n" +
      "    {\n" +
      "      switch (x)\n" +
      "      {\n" +
      "        case -1: return -1;\n" +
      "        case -2: return -2;\n" +
      "        default: return 0;\n" +
      "      }\n" +
      "    }\n" +
      "    try\n" +
      "    {\n" +
      "      return x > 5 ? -x : x;\n" +
      "    }\n" +
      "    catch (System.Exception e)\n" +
      "    {\n" +
      "      return 0;\n" +
      "    }\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Branchy.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const simple = parsed.functions.find((f) => f.name === "Simple");
    const branchy = parsed.functions.find((f) => f.name === "Branchy");
    expect(simple?.complexity).toBe(1);
    // Branchy: 1 base + outer if + for + inner if + && + else-if + 2 case
    // labels (default not counted) + ternary + catch = 10
    expect(branchy?.complexity).toBe(10);
  });

  it("captures invocation_expression + object_creation_expression as calls", () => {
    const content =
      "namespace App;\n" +
      "using System.Collections.Generic;\n" +
      "public class Outer\n" +
      "{\n" +
      "  public void Run()\n" +
      "  {\n" +
      "    Helper();\n" +
      "    System.Console.WriteLine(\"hi\");\n" +
      "    var list = new List<string>();\n" +
      "  }\n" +
      "  void Helper() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Outer.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const callees = parsed.calls.map((c) => c.calleeName).sort();
    expect(callees).toContain("Helper"); // bare invocation
    expect(callees).toContain("WriteLine"); // member_access invocation
    expect(callees).toContain("List"); // object_creation_expression with generic_name
  });

  it("attributes calls to the enclosing method", () => {
    const content =
      "namespace App;\n" +
      "public class C\n" +
      "{\n" +
      "  public void Outer() { Helper(); }\n" +
      "  public void Inner() { Util(); }\n" +
      "  void Helper() {}\n" +
      "  void Util() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "C.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const outerCalls = parsed.calls
      .filter((c) => c.inFunction === "Outer")
      .map((c) => c.calleeName);
    expect(outerCalls).toEqual(["Helper"]);
    const innerCalls = parsed.calls
      .filter((c) => c.inFunction === "Inner")
      .map((c) => c.calleeName);
    expect(innerCalls).toEqual(["Util"]);
  });
});

describe("csharpPlugin — type-aware tracking (Phase 5)", () => {
  beforeAll(async () => {
    await csharpPlugin.load();
  });

  it("emits containerType on every method matching the enclosing class", () => {
    const content =
      "namespace App;\n" +
      "public class Widget\n" +
      "{\n" +
      "  public Widget() {}\n" +
      "  public int Render() { return 0; }\n" +
      "  public void Update() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Widget.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    for (const fn of parsed.functions) {
      expect(fn.containerType).toBe("Widget");
    }
  });

  it("infers calleeType from a field declaration with explicit type", () => {
    const content =
      "namespace App;\n" +
      "public class Service\n" +
      "{\n" +
      "  private ValidatePassword validatePassword;\n" +
      "  public void Run() { validatePassword.Validate(null); }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "Validate");
    expect(validateCall?.calleeType).toBe("ValidatePassword");
  });

  it("infers calleeType from a property declaration (auto-property)", () => {
    // C#-specific: idiomatic state is in properties, not fields. The plugin
    // tracks `public Foo Bar { get; set; }` the same way it tracks fields.
    const content =
      "namespace App;\n" +
      "public class Service\n" +
      "{\n" +
      "  public ValidateEmail Validator { get; set; }\n" +
      "  public void Run() { Validator.Validate(null); }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "Validate");
    expect(validateCall?.calleeType).toBe("ValidateEmail");
  });

  it("infers calleeType from a method parameter", () => {
    const content =
      "namespace App;\n" +
      "public class Service\n" +
      "{\n" +
      "  public void Check(ValidateEmail v) { v.Validate(null); }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "Validate");
    expect(validateCall?.calleeType).toBe("ValidateEmail");
  });

  it("infers calleeType from a typed local declaration", () => {
    const content =
      "namespace App;\n" +
      "public class Service\n" +
      "{\n" +
      "  public void Run()\n" +
      "  {\n" +
      "    ValidateUserName v = new ValidateUserName();\n" +
      "    v.Validate(null);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "Validate");
    expect(validateCall?.calleeType).toBe("ValidateUserName");
  });

  it("infers calleeType from `var` + `new Foo()` initializer (C#-specific)", () => {
    // var x = new Foo() — the type is inferred from the object_creation
    // initializer, analog to JS `const x = new Foo()`.
    const content =
      "namespace App;\n" +
      "public class Service\n" +
      "{\n" +
      "  public void Run()\n" +
      "  {\n" +
      "    var v = new ValidateUserName();\n" +
      "    v.Validate(null);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "Validate");
    expect(validateCall?.calleeType).toBe("ValidateUserName");
  });

  it("strips generics when extracting types (List<string> → List)", () => {
    const content =
      "namespace App;\n" +
      "using System.Collections.Generic;\n" +
      "public class S\n" +
      "{\n" +
      "  private List<string> items;\n" +
      "  public void Use() { items.Add(\"hi\"); }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const addCall = parsed.calls.find((c) => c.calleeName === "Add");
    expect(addCall?.calleeType).toBe("List");
  });

  it("`this.method()` and bare `method()` resolve to current class", () => {
    const content =
      "namespace App;\n" +
      "public class Owner\n" +
      "{\n" +
      "  public void PublicApi()\n" +
      "  {\n" +
      "    Helper();\n" +
      "    this.AlsoHelper();\n" +
      "  }\n" +
      "  void Helper() {}\n" +
      "  void AlsoHelper() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Owner.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const helperCall = parsed.calls.find((c) => c.calleeName === "Helper");
    const alsoHelperCall = parsed.calls.find(
      (c) => c.calleeName === "AlsoHelper"
    );
    expect(helperCall?.calleeType).toBe("Owner");
    expect(alsoHelperCall?.calleeType).toBe("Owner");
  });

  it("disambiguates two same-named methods on different fields in the same class", () => {
    const content =
      "namespace App;\n" +
      "public class Service\n" +
      "{\n" +
      "  private ValidatePassword vp;\n" +
      "  private ValidateEmail ve;\n" +
      "  public void Run()\n" +
      "  {\n" +
      "    vp.Validate(null);\n" +
      "    ve.Validate(null);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const validateCalls = parsed.calls
      .filter((c) => c.calleeName === "Validate")
      .map((c) => c.calleeType);
    expect(validateCalls).toEqual(["ValidatePassword", "ValidateEmail"]);
  });

  it("leaves calleeType undefined when the receiver type can't be inferred", () => {
    const content =
      "namespace App;\n" +
      "public class S\n" +
      "{\n" +
      "  public void F()\n" +
      "  {\n" +
      "    GetThing().DoStuff();\n" + // chained — return type not tracked
      "  }\n" +
      "  object GetThing() { return null; }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const doStuff = parsed.calls.find((c) => c.calleeName === "DoStuff");
    expect(doStuff?.calleeType).toBeUndefined();
    expect(doStuff).toBeDefined();
  });

  it("constructor calls (new Foo()) emit calleeType = the class itself", () => {
    const content =
      "namespace App;\n" +
      "public class S\n" +
      "{\n" +
      "  public void F()\n" +
      "  {\n" +
      "    Widget w = new Widget();\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const widgetNew = parsed.calls.find((c) => c.calleeName === "Widget");
    expect(widgetNew?.calleeType).toBe("Widget");
  });

  it("nullable types (Foo?) pass through to the inner type", () => {
    // C#-specific: Foo? is a nullable_type. Type extraction should recurse
    // and return the inner Foo, not null.
    const content =
      "namespace App;\n" +
      "public class S\n" +
      "{\n" +
      "  private ValidateEmail? validator;\n" +
      "  public void Run() { validator?.Validate(null); }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.cs", ext: "cs", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(csharpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "Validate");
    expect(validateCall?.calleeType).toBe("ValidateEmail");
  });
});
