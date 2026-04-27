// Tests for the PHP tree-sitter plugin (v0.22). Mirrors csharp.test.ts /
// java.test.ts since all three plugins share the Phase 5 architecture.
//
// Where PHP-specific behavior diverges (variable_name with $, member_call vs
// scoped_call, optional_type, property promotion), the test names call it
// out so failures localize quickly.

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { phpPlugin } from "../codeAnalysis/plugins/php";
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

describe("phpPlugin — basic contract", () => {
  beforeAll(async () => {
    await phpPlugin.load();
  });

  it("advertises the .php extension only", () => {
    expect([...phpPlugin.extensions]).toEqual(["php"]);
  });

  it("loads the tree-sitter-php grammar", () => {
    expect(phpPlugin.languageFor("php")).toBeTruthy();
  });

  it("parses a simple PHP class without error", () => {
    const lang = phpPlugin.languageFor("php");
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(
      "<?php\nnamespace App;\nclass Bar {\n  public function hi(): int { return 1; }\n}\n"
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.type).toBe("program");
    parser.delete();
    tree!.delete();
  });
});

describe("phpPlugin.prepareForRepo + resolveImport", () => {
  beforeAll(async () => {
    await phpPlugin.load();
  });

  /** Synthetic mini-project covering: file-scoped namespace, default
   *  namespace, multiple types per namespace. Uses backslash separators
   *  per PHP convention. */
  const files: SourceFile[] = [
    {
      rel: "src/App.php",
      ext: "php",
      content: "<?php\nnamespace App;\nclass App {}\n",
    },
    {
      rel: "src/User.php",
      ext: "php",
      content: "<?php\nnamespace App;\nclass User {}\n",
    },
    {
      rel: "src/UserService.php",
      ext: "php",
      content: "<?php\nnamespace App;\nclass UserService {}\n",
    },
    {
      rel: "src/Web/Controller.php",
      ext: "php",
      content: "<?php\nnamespace App\\Web;\nclass Controller {}\n",
    },
    {
      rel: "src/Web/Helper.php",
      ext: "php",
      content: "<?php\nnamespace App\\Web;\nclass Helper {}\n",
    },
    {
      rel: "src/Bare.php",
      ext: "php",
      content: "<?php\nclass Bare {}\n", // No namespace
    },
  ];

  it("builds a context that resolves direct FQN imports (use App\\User)", async () => {
    const ix = makeIndex(files);
    await phpPlugin.prepareForRepo("/fake/root", ix);
    expect(phpPlugin.resolveImport("App\\User", "src/App.php", ix)).toBe(
      "src/User.php"
    );
  });

  it("resolves a `use App\\Web` namespace-only import via package fallback", async () => {
    const ix = makeIndex(files);
    await phpPlugin.prepareForRepo("/fake/root", ix);
    const resolved = phpPlugin.resolveImport(
      "App\\Web",
      "src/App.php",
      ix
    );
    expect(resolved).toBe("src/Web/Controller.php");
  });

  it("returns null for stdlib / external imports", async () => {
    const ix = makeIndex(files);
    await phpPlugin.prepareForRepo("/fake/root", ix);
    expect(
      phpPlugin.resolveImport("Symfony\\Component\\HttpFoundation\\Request", "src/App.php", ix)
    ).toBeNull();
    expect(
      phpPlugin.resolveImport("Doctrine\\ORM\\EntityManager", "src/App.php", ix)
    ).toBeNull();
  });

  it("indexes default-namespace classes (no namespace declaration) by bare name", async () => {
    const ix = makeIndex(files);
    await phpPlugin.prepareForRepo("/fake/root", ix);
    expect(phpPlugin.resolveImport("Bare", "src/Bare.php", ix)).toBe(
      "src/Bare.php"
    );
  });
});

describe("phpPlugin — parseFile end-to-end", () => {
  beforeAll(async () => {
    await phpPlugin.load();
  });

  it("captures use directives (class, namespace, aliased forms)", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "use App\\Models\\User;\n" +
      "use App\\Validators\\ValidateEmail as VE;\n" +
      "use Symfony\\Component\\HttpFoundation;\n" +
      "class Service {}\n";
    const file: SourceFile = {
      rel: "src/Service.php",
      ext: "php",
      content,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    expect(parsed.parseError).toBe(false);
    const specs = parsed.imports.map((i) => i.rawSpec).sort();
    expect(specs).toContain("App\\Models\\User");
    expect(specs).toContain("App\\Validators\\ValidateEmail");
    expect(specs).toContain("Symfony\\Component\\HttpFoundation");
  });

  it("captures extends and implements as separate edge kinds", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Child extends Parent_ implements Iface, Iface2 {}\n";
    const file: SourceFile = {
      rel: "src/Child.php",
      ext: "php",
      content,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const extendsEdge = parsed.imports.find((i) => i.kind === "extends");
    const implementsEdges = parsed.imports.filter((i) => i.kind === "implements");
    expect(extendsEdge?.rawSpec).toBe("Parent_");
    expect(implementsEdges.map((i) => i.rawSpec).sort()).toEqual([
      "Iface",
      "Iface2",
    ]);
  });

  it("extracts methods and constructors", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Widget\n" +
      "{\n" +
      "  public function __construct() {}\n" +
      "  public function render(): int { return 1; }\n" +
      "  private function update(int $x): void\n" +
      "  {\n" +
      "    if ($x > 0) echo $x;\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Widget.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const names = parsed.functions.map((f) => f.name).sort();
    expect(names).toContain("__construct");
    expect(names).toContain("render");
    expect(names).toContain("update");
  });

  it("computes complexity from PHP decision points", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Branchy\n" +
      "{\n" +
      "  public function simple(): int { return 1; }\n" +
      "  public function branchy(int $x): int\n" +
      "  {\n" +
      "    if ($x > 0) {\n" +
      "      foreach (range(0, $x) as $i) {\n" +
      "        if ($i % 2 == 0 && $i > 2) return $i;\n" +
      "      }\n" +
      "    } elseif ($x < 0) {\n" +
      "      switch ($x) {\n" +
      "        case -1: return -1;\n" +
      "        case -2: return -2;\n" +
      "        default: return 0;\n" +
      "      }\n" +
      "    }\n" +
      "    try {\n" +
      "      return $x > 5 ? -$x : $x;\n" +
      "    } catch (\\Exception $e) {\n" +
      "      return 0;\n" +
      "    }\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Branchy.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const simple = parsed.functions.find((f) => f.name === "simple");
    const branchy = parsed.functions.find((f) => f.name === "branchy");
    expect(simple?.complexity).toBe(1);
    // branchy: 1 base + outer if + foreach + inner if + && + elseif (nested if)
    // + 2 case clauses (default not counted) + ternary (conditional_expression)
    // + catch = 10
    expect(branchy?.complexity).toBe(10);
  });

  it("captures member_call, scoped_call, function_call, and object_creation", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Outer\n" +
      "{\n" +
      "  public function run(): void\n" +
      "  {\n" +
      "    $this->helper();\n" +
      "    self::staticHelper();\n" +
      "    Logger::log(\"hi\");\n" +
      "    array_map('strlen', []);\n" +
      "    $list = new \\ArrayObject();\n" +
      "  }\n" +
      "  private function helper(): void {}\n" +
      "  public static function staticHelper(): void {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Outer.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const callees = parsed.calls.map((c) => c.calleeName).sort();
    expect(callees).toContain("helper"); // member_call
    expect(callees).toContain("staticHelper"); // scoped_call (self::)
    expect(callees).toContain("log"); // scoped_call (Foo::)
    expect(callees).toContain("array_map"); // function_call
    expect(callees).toContain("ArrayObject"); // object_creation
  });

  it("attributes calls to the enclosing function", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class C\n" +
      "{\n" +
      "  public function outer(): void { $this->helper(); }\n" +
      "  public function inner(): void { $this->util(); }\n" +
      "  private function helper(): void {}\n" +
      "  private function util(): void {}\n" +
      "}\n";
    const file: SourceFile = { rel: "C.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
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

describe("phpPlugin — type-aware tracking (Phase 5)", () => {
  beforeAll(async () => {
    await phpPlugin.load();
  });

  it("emits containerType on every method matching the enclosing class", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Widget\n" +
      "{\n" +
      "  public function __construct() {}\n" +
      "  public function render(): int { return 0; }\n" +
      "  public function update(): void {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Widget.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    for (const fn of parsed.functions) {
      expect(fn.containerType).toBe("Widget");
    }
  });

  it("infers calleeType from a property declaration with explicit type", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Service\n" +
      "{\n" +
      "  private ValidatePassword $validatePassword;\n" +
      "  public function run(): void { $this->validatePassword->validate(null); }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "validate");
    expect(validateCall?.calleeType).toBe("ValidatePassword");
  });

  it("infers calleeType from a method parameter (PHP type hint)", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Service\n" +
      "{\n" +
      "  public function check(ValidateEmail $v): void { $v->validate(null); }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "validate");
    expect(validateCall?.calleeType).toBe("ValidateEmail");
  });

  it("infers calleeType from constructor parameter promotion (PHP 8)", () => {
    // PHP-specific: `public Logger $logger` in __construct creates an
    // implicit property. The plugin tracks it as a class field so calls
    // through $this->logger get the right type.
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Service\n" +
      "{\n" +
      "  public function __construct(public readonly Logger $logger) {}\n" +
      "  public function run(): void { $this->logger->log(\"hi\"); }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const logCall = parsed.calls.find((c) => c.calleeName === "log");
    expect(logCall?.calleeType).toBe("Logger");
  });

  it("infers calleeType from `$x = new Foo()` initializer", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Service\n" +
      "{\n" +
      "  public function run(): void\n" +
      "  {\n" +
      "    $u = new ValidateUserName();\n" +
      "    $u->validate(null);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "validate");
    expect(validateCall?.calleeType).toBe("ValidateUserName");
  });

  it("`$this->method()` and `self::method()` resolve to current class", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Owner\n" +
      "{\n" +
      "  public function publicApi(): void\n" +
      "  {\n" +
      "    $this->helper();\n" +
      "    self::staticHelper();\n" +
      "  }\n" +
      "  private function helper(): void {}\n" +
      "  public static function staticHelper(): void {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Owner.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const helperCall = parsed.calls.find((c) => c.calleeName === "helper");
    const staticHelperCall = parsed.calls.find(
      (c) => c.calleeName === "staticHelper"
    );
    expect(helperCall?.calleeType).toBe("Owner");
    expect(staticHelperCall?.calleeType).toBe("Owner");
  });

  it("optional_type (?Foo) recurses to the inner type (PHP-specific)", () => {
    // PHP uses `?Foo` for nullable types. extractTypeName should recurse
    // through optional_type to the inner Foo (analog to C#'s nullable_type).
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class S\n" +
      "{\n" +
      "  private ?ValidateEmail $validator;\n" +
      "  public function run(): void { $this->validator->validate(null); }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "validate");
    expect(validateCall?.calleeType).toBe("ValidateEmail");
  });

  it("disambiguates two same-named methods on different fields in the same class", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class Service\n" +
      "{\n" +
      "  private ValidatePassword $vp;\n" +
      "  private ValidateEmail $ve;\n" +
      "  public function run(): void\n" +
      "  {\n" +
      "    $this->vp->validate(null);\n" +
      "    $this->ve->validate(null);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const validateCalls = parsed.calls
      .filter((c) => c.calleeName === "validate")
      .map((c) => c.calleeType);
    expect(validateCalls).toEqual(["ValidatePassword", "ValidateEmail"]);
  });

  it("leaves calleeType undefined when the receiver type can't be inferred", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class S\n" +
      "{\n" +
      "  public function f(): void\n" +
      "  {\n" +
      "    $this->getThing()->doStuff();\n" + // chained — return type not tracked
      "  }\n" +
      "  private function getThing(): object { return new \\stdClass(); }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const doStuff = parsed.calls.find((c) => c.calleeName === "doStuff");
    expect(doStuff?.calleeType).toBeUndefined();
    expect(doStuff).toBeDefined();
  });

  it("constructor calls (new Foo()) emit calleeType = the class itself", () => {
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "class S\n" +
      "{\n" +
      "  public function f(): void\n" +
      "  {\n" +
      "    $w = new Widget();\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const widgetNew = parsed.calls.find((c) => c.calleeName === "Widget");
    expect(widgetNew?.calleeType).toBe("Widget");
  });

  it("trait_declaration acts as a container for methods", () => {
    // PHP-specific: traits provide reusable methods across classes. Methods
    // declared in a trait should get containerType = trait name.
    const content =
      "<?php\n" +
      "namespace App;\n" +
      "trait LoggableTrait\n" +
      "{\n" +
      "  public function log(string $msg): void {}\n" +
      "}\n";
    const file: SourceFile = { rel: "LoggableTrait.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const logFn = parsed.functions.find((f) => f.name === "log");
    expect(logFn?.containerType).toBe("LoggableTrait");
  });

  it("function_definition (top-level) gets no containerType", () => {
    // PHP allows free-standing functions outside classes — these should
    // have containerType = undefined (top-level scope), unlike methods.
    const content =
      "<?php\n" +
      "function topLevelHelper(int $x): int { return $x * 2; }\n";
    const file: SourceFile = { rel: "helpers.php", ext: "php", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(phpPlugin, file, ix);
    const helper = parsed.functions.find((f) => f.name === "topLevelHelper");
    expect(helper).toBeDefined();
    expect(helper?.containerType).toBeUndefined();
  });
});
