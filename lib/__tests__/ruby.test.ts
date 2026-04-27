// Tests for the Ruby tree-sitter plugin (v0.23). First fully-dynamic
// language — Phase 5 type-aware works only via constructor-initializer
// inference (`x = SomeClass.new`) and constant-receiver static calls
// (`Foo.method`). All other type tracking falls through to pickCallTarget's
// proximity heuristics, which is honest about Ruby's lack of static types.

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { rubyPlugin } from "../codeAnalysis/plugins/ruby";
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

describe("rubyPlugin — basic contract", () => {
  beforeAll(async () => {
    await rubyPlugin.load();
  });

  it("advertises the .rb extension only", () => {
    expect([...rubyPlugin.extensions]).toEqual(["rb"]);
  });

  it("loads the tree-sitter-ruby grammar", () => {
    expect(rubyPlugin.languageFor("rb")).toBeTruthy();
  });

  it("parses a simple Ruby class without error", () => {
    const lang = rubyPlugin.languageFor("rb");
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(
      "class Bar\n  def hi\n    1\n  end\nend\n"
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.type).toBe("program");
    parser.delete();
    tree!.delete();
  });
});

describe("rubyPlugin.prepareForRepo + resolveImport", () => {
  beforeAll(async () => {
    await rubyPlugin.load();
  });

  /** Synthetic mini-project with module nesting + bare classes. Tests
   *  both qualified (App::User) and unqualified (User) lookups. */
  const files: SourceFile[] = [
    {
      rel: "lib/app.rb",
      ext: "rb",
      content: "module App\nend\n",
    },
    {
      rel: "lib/user.rb",
      ext: "rb",
      content: "module App\n  class User\n  end\nend\n",
    },
    {
      rel: "lib/user_service.rb",
      ext: "rb",
      content: "module App\n  class UserService\n  end\nend\n",
    },
    {
      rel: "lib/web/controller.rb",
      ext: "rb",
      content: "module App::Web\n  class Controller\n  end\nend\n",
    },
    {
      rel: "lib/bare.rb",
      ext: "rb",
      content: "class Bare\nend\n",
    },
  ];

  it("resolves a class FQN via the prebuilt index", async () => {
    const ix = makeIndex(files);
    await rubyPlugin.prepareForRepo("/fake/root", ix);
    expect(rubyPlugin.resolveImport("App::User", "lib/app.rb", ix)).toBe(
      "lib/user.rb"
    );
  });

  it("resolves a bare class name via the byBareName fallback", async () => {
    const ix = makeIndex(files);
    await rubyPlugin.prepareForRepo("/fake/root", ix);
    // `class Child < User` — Parent referenced unqualified
    expect(rubyPlugin.resolveImport("User", "lib/app.rb", ix)).toBe(
      "lib/user.rb"
    );
  });

  it("returns null for stdlib / unknown class names", async () => {
    const ix = makeIndex(files);
    await rubyPlugin.prepareForRepo("/fake/root", ix);
    expect(
      rubyPlugin.resolveImport("Logger", "lib/app.rb", ix)
    ).toBeNull();
    expect(
      rubyPlugin.resolveImport("ActiveRecord::Base", "lib/app.rb", ix)
    ).toBeNull();
  });

  it("indexes default-namespace classes by bare name", async () => {
    const ix = makeIndex(files);
    await rubyPlugin.prepareForRepo("/fake/root", ix);
    expect(rubyPlugin.resolveImport("Bare", "lib/bare.rb", ix)).toBe(
      "lib/bare.rb"
    );
  });
});

describe("rubyPlugin — parseFile end-to-end", () => {
  beforeAll(async () => {
    await rubyPlugin.load();
  });

  it("captures require_relative as path-resolved imports", () => {
    const files: SourceFile[] = [
      {
        rel: "lib/main.rb",
        ext: "rb",
        content:
          "require_relative 'helpers/utils'\n" +
          "require 'json'\n" +
          "class Main\nend\n",
      },
      {
        rel: "lib/helpers/utils.rb",
        ext: "rb",
        content: "module Utils\nend\n",
      },
    ];
    const ix = makeIndex(files);
    const parsed = parseFile(rubyPlugin, files[0], ix);
    expect(parsed.parseError).toBe(false);
    const utilsImport = parsed.imports.find(
      (i) => i.rawSpec === "helpers/utils"
    );
    expect(utilsImport?.resolvedPath).toBe("lib/helpers/utils.rb");
    // 'json' is stdlib, no internal file matches → unresolved
    const jsonImport = parsed.imports.find((i) => i.rawSpec === "json");
    expect(jsonImport?.resolvedPath).toBeNull();
  });

  it("resolves require 'foo' via lib/ load-path prefix", () => {
    // `require 'helpers/utils'` (without _relative) — searches load paths.
    // Our prepareForRepo populates lib/ + src/ + app/ + repo-root prefixes.
    const files: SourceFile[] = [
      {
        rel: "main.rb",
        ext: "rb",
        content: "require 'helpers/utils'\nclass Main\nend\n",
      },
      {
        rel: "lib/helpers/utils.rb",
        ext: "rb",
        content: "module Utils\nend\n",
      },
    ];
    const ix = makeIndex(files);
    const parsed = parseFile(rubyPlugin, files[0], ix);
    const utilsImport = parsed.imports.find(
      (i) => i.rawSpec === "helpers/utils"
    );
    expect(utilsImport?.resolvedPath).toBe("lib/helpers/utils.rb");
  });

  it("emits extends edges from `class X < Parent`", () => {
    const files: SourceFile[] = [
      {
        rel: "lib/base.rb",
        ext: "rb",
        content: "class Base\nend\n",
      },
      {
        rel: "lib/child.rb",
        ext: "rb",
        content: "class Child < Base\nend\n",
      },
    ];
    const ix = makeIndex(files);
    // Need prepareForRepo to populate the FQN index for resolveImport
    rubyPlugin.prepareForRepo("/fake/root", ix);
    const parsed = parseFile(rubyPlugin, files[1], ix);
    const extendsEdge = parsed.imports.find((i) => i.kind === "extends");
    expect(extendsEdge?.rawSpec).toBe("Base");
    expect(extendsEdge?.resolvedPath).toBe("lib/base.rb");
  });

  it("extracts methods + singleton_method (def self.x) with correct containerType", () => {
    const content =
      "class Widget\n" +
      "  def initialize\n  end\n" +
      "  def render\n    1\n  end\n" +
      "  def self.factory\n    Widget.new\n  end\n" +
      "end\n";
    const file: SourceFile = { rel: "widget.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const names = parsed.functions.map((f) => f.name).sort();
    expect(names).toEqual(["factory", "initialize", "render"]);
    // All three should have containerType = "Widget" (singleton_method too)
    for (const fn of parsed.functions) {
      expect(fn.containerType).toBe("Widget");
    }
  });

  it("computes complexity from Ruby decision points (if/elsif/case/when/binary)", () => {
    const content =
      "class Branchy\n" +
      "  def simple\n    1\n  end\n" +
      "  def branchy(x)\n" +
      "    if x > 0\n" +
      "      (1..x).each do |i|\n" +
      "        return i if i % 2 == 0 && i > 2\n" +
      "      end\n" +
      "    elsif x < 0\n" +
      "      case x\n" +
      "      when -1 then return -1\n" +
      "      when -2 then return -2\n" +
      "      else return 0\n" +
      "      end\n" +
      "    end\n" +
      "    begin\n" +
      "      x > 5 ? -x : x\n" +
      "    rescue StandardError => e\n" +
      "      0\n" +
      "    end\n" +
      "  end\n" +
      "end\n";
    const file: SourceFile = { rel: "branchy.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const simple = parsed.functions.find((f) => f.name === "simple");
    const branchy = parsed.functions.find((f) => f.name === "branchy");
    expect(simple?.complexity).toBe(1);
    // branchy: 1 base + outer if + each (?) + if_modifier (return if) + && +
    // elsif + 2 when (else doesn't count) + ternary (conditional) + rescue
    // = 10 — but `each` is just a method call on a Range, not a decision
    // point in our model. So expected: 1 + outer if + if_modifier + && +
    // elsif + 2 when + conditional + rescue = 9
    expect(branchy?.complexity).toBe(9);
  });

  it("captures call sites with various receiver shapes", () => {
    const content =
      "class Outer\n" +
      "  def run\n" +
      "    self.helper\n" +
      "    @validator.validate(nil)\n" +
      "    Logger.new\n" +
      "    Foo::Bar.process\n" +
      "    helper_with_parens()\n" +
      "  end\n" +
      "  def helper\n  end\n" +
      "end\n";
    const file: SourceFile = { rel: "outer.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const callees = parsed.calls.map((c) => c.calleeName).sort();
    expect(callees).toContain("helper"); // self.helper
    expect(callees).toContain("validate"); // @validator.validate
    expect(callees).toContain("initialize"); // Logger.new rewritten
    expect(callees).toContain("process"); // Foo::Bar.process
    expect(callees).toContain("helper_with_parens"); // bare call with parens
  });

  it("attributes calls to the enclosing method", () => {
    const content =
      "class C\n" +
      "  def outer\n    helper()\n  end\n" +
      "  def inner\n    util()\n  end\n" +
      "  def helper\n  end\n" +
      "  def util\n  end\n" +
      "end\n";
    const file: SourceFile = { rel: "c.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
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

describe("rubyPlugin — type-aware tracking (Phase 5, dynamic-language flavor)", () => {
  beforeAll(async () => {
    await rubyPlugin.load();
  });

  it("emits containerType on every method matching the enclosing class", () => {
    const content =
      "class Widget\n" +
      "  def initialize\n  end\n" +
      "  def render\n    0\n  end\n" +
      "  def update\n  end\n" +
      "end\n";
    const file: SourceFile = { rel: "widget.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    for (const fn of parsed.functions) {
      expect(fn.containerType).toBe("Widget");
    }
  });

  it("module nesting: methods inside a module get containerType = module name", () => {
    // Ruby-specific: modules can host methods (module functions). The
    // closest container scope wins — App::Helpers contains the method,
    // so containerType = "Helpers".
    const content =
      "module App\n" +
      "  module Helpers\n" +
      "    def self.format(x)\n      x.to_s\n    end\n" +
      "  end\n" +
      "end\n";
    const file: SourceFile = { rel: "helpers.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const formatFn = parsed.functions.find((f) => f.name === "format");
    expect(formatFn?.containerType).toBe("Helpers");
  });

  it("infers calleeType from `x = SomeClass.new` local assignment", () => {
    const content =
      "class Service\n" +
      "  def run\n" +
      "    u = ValidateUserName.new\n" +
      "    u.validate(nil)\n" +
      "  end\n" +
      "end\n";
    const file: SourceFile = { rel: "service.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "validate");
    expect(validateCall?.calleeType).toBe("ValidateUserName");
  });

  it("infers calleeType from `@x = SomeClass.new` instance var assignment", () => {
    // Ruby-specific: instance vars persist across methods of the same class.
    // Tracking `@validator = ValidatePassword.new` in initialize lets calls
    // through `@validator` in OTHER methods resolve correctly.
    const content =
      "class Service\n" +
      "  def initialize\n" +
      "    @validator = ValidatePassword.new\n" +
      "  end\n" +
      "  def run\n" +
      "    @validator.validate(nil)\n" +
      "  end\n" +
      "end\n";
    const file: SourceFile = { rel: "service.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "validate");
    expect(validateCall?.calleeType).toBe("ValidatePassword");
  });

  it("constant receivers set calleeType to that class (Foo.method)", () => {
    const content =
      "class App\n" +
      "  def boot\n" +
      "    Logger.configure\n" +
      "    Database::Connection.open\n" +
      "  end\n" +
      "end\n";
    const file: SourceFile = { rel: "app.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const configureCall = parsed.calls.find(
      (c) => c.calleeName === "configure"
    );
    expect(configureCall?.calleeType).toBe("Logger");
    const openCall = parsed.calls.find((c) => c.calleeName === "open");
    expect(openCall?.calleeType).toBe("Connection");
  });

  it("self.method() resolves to current class", () => {
    const content =
      "class Owner\n" +
      "  def public_api\n" +
      "    self.helper\n" +
      "  end\n" +
      "  def helper\n  end\n" +
      "end\n";
    const file: SourceFile = { rel: "owner.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const helperCall = parsed.calls.find((c) => c.calleeName === "helper");
    expect(helperCall?.calleeType).toBe("Owner");
  });

  it("Klass.new is rewritten to .initialize so it matches the actual constructor", () => {
    // Ruby-specific: `Foo.new` is the canonical constructor invocation,
    // but the actual method body lives in `def initialize`. We rewrite
    // the calleeName so pickCallTarget finds the constructor.
    const content =
      "class Caller\n" +
      "  def f\n" +
      "    Widget.new\n" +
      "  end\n" +
      "end\n";
    const file: SourceFile = { rel: "caller.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const newCall = parsed.calls.find((c) => c.calleeName === "initialize");
    expect(newCall).toBeDefined();
    expect(newCall?.calleeType).toBe("Widget");
  });

  it("disambiguates two methods on different instance vars in the same class", () => {
    const content =
      "class Service\n" +
      "  def initialize\n" +
      "    @vp = ValidatePassword.new\n" +
      "    @ve = ValidateEmail.new\n" +
      "  end\n" +
      "  def run\n" +
      "    @vp.validate(nil)\n" +
      "    @ve.validate(nil)\n" +
      "  end\n" +
      "end\n";
    const file: SourceFile = { rel: "service.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const validateCalls = parsed.calls
      .filter((c) => c.calleeName === "validate")
      .map((c) => c.calleeType);
    expect(validateCalls).toEqual(["ValidatePassword", "ValidateEmail"]);
  });

  it("leaves calleeType undefined when receiver type can't be inferred", () => {
    // Ruby's dynamic nature: parameters have no types, so calls through
    // params are unresolvable without explicit Klass.new tracking.
    const content =
      "class S\n" +
      "  def f(unknown_thing)\n" +
      "    unknown_thing.do_stuff\n" +
      "  end\n" +
      "end\n";
    const file: SourceFile = { rel: "s.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const doStuff = parsed.calls.find((c) => c.calleeName === "do_stuff");
    expect(doStuff?.calleeType).toBeUndefined();
    // The call IS still emitted — pickCallTarget can use proximity
    // heuristics to attempt resolution by name.
    expect(doStuff).toBeDefined();
  });

  it("top-level methods (no class) get no containerType", () => {
    // Ruby allows free-standing methods at file scope (helpers, scripts).
    const content = "def standalone(x)\n  x * 2\nend\n";
    const file: SourceFile = { rel: "helpers.rb", ext: "rb", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(rubyPlugin, file, ix);
    const fn = parsed.functions.find((f) => f.name === "standalone");
    expect(fn).toBeDefined();
    expect(fn?.containerType).toBeUndefined();
  });
});
