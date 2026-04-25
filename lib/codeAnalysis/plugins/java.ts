// Java plugin — third migration off the regex-fallback.
//
// Java's module model is heavier than Python or Go: every file declares its
// package via `package com.foo.bar;` and the class name = file basename
// (Java convention; the public class always matches the filename). Imports
// reference fully-qualified names (FQN) like `com.foo.bar.Baz`, optionally
// with a `.*` wildcard that pulls every public class from the package.
//
// Strategy:
//   - prepareForRepo walks every .java file once (regex on the package
//     declaration — cheap, the line is at the top of the file) and builds
//     two maps: FQN→path for class lookups, package→[paths] for wildcards.
//   - resolveImport tries FQN first, then treats the FQN as a package name
//     for wildcards (returning the alphabetically-first file as a stable
//     blast-radius anchor).
//   - Tree-sitter queries cover method + constructor declarations, method
//     invocations + object_creation_expression (new Foo() is a real
//     "calls Foo's constructor" relationship), and standard McCabe
//     decision points.
//
// What we deliberately don't do in v1:
//   - extends / implements as separate edge kinds (graph.ts emits these as
//     "extends"/"implements" kinds for the Imports tab; we'd need plugin-
//     contract changes to differentiate kinds at the codeAnalysis level).
//     Imports cover most cross-file dependencies anyway — you can't extend
//     a class without first importing it.
//   - Multi-class-per-file resolution beyond the public class. Java allows
//     secondary classes but they're rarely referenced cross-file by FQN.
//   - module-info.java parsing for Java 9+ modules. Most repos still use
//     classic package layout.

import path from "node:path";
import type { Language } from "web-tree-sitter";
import type { CodeAnalysisPlugin, FileIndex, PluginQueries } from "../types";
import { loadBuiltinGrammar } from "../runtime";

const PLUGIN_NAME = "java";
const EXTENSIONS = ["java"] as const;

let lang: Language | null = null;

interface JavaResolverContext {
  /** FQN ("com.foo.Bar") → repo-rel path. Built from package declarations
   *  + filename in prepareForRepo. */
  fqnToPath: Map<string, string>;
  /** Package name ("com.foo") → repo-rel paths in that package. Used to
   *  resolve wildcard imports. Sorted alphabetically for determinism. */
  packageMembers: Map<string, string[]>;
}

// Detects the package declaration at the top of a Java file. Allows leading
// whitespace and comments — Java's grammar permits both before `package`.
const PACKAGE_RE = /^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m;

// ------------------- Tree-sitter queries -------------------

/** Captures the import path. tree-sitter-java represents
 *    import com.foo.Bar;     → import_declaration with scoped_identifier "com.foo.Bar"
 *    import com.foo.*;       → import_declaration with scoped_identifier "com.foo" + asterisk
 *    import static X.Y.z;    → import_declaration with `static` modifier
 *  We capture the scoped_identifier in all cases. resolveJavaImport tries
 *  it as a class FQN first, falls back to treating it as a package name
 *  (which catches wildcards naturally). */
const IMPORTS_QUERY = `
(import_declaration (scoped_identifier) @spec)
`;

/** Method and constructor declarations. constructor_body has a different
 *  node type from regular method bodies, so we need two patterns. Both
 *  fields use `name: (identifier)` for the function name. */
const FUNCTION_DEFS_QUERY = `
(method_declaration name: (identifier) @name body: (block) @body)
(constructor_declaration name: (identifier) @name body: (constructor_body) @body)
`;

/** Three call shapes:
 *    foo()                — method_invocation with bare identifier name
 *    obj.method() / Class.staticMethod() — method_invocation with object
 *    new Foo(...)         — object_creation_expression with type_identifier
 *    new Foo<T>(...)      — object_creation_expression with generic_type
 *                            wrapping the type_identifier
 *  Modern Java uses generics heavily so the generic case is common. */
const CALL_SITES_QUERY = `
(method_invocation name: (identifier) @callee)
(object_creation_expression type: (type_identifier) @callee)
(object_creation_expression type: (generic_type (type_identifier) @callee))
`;

/** McCabe decision points for Java. Notes:
 *  - if/while/for/do_statement covers C-style loops; enhanced_for_statement
 *    is the for-each loop (`for (T x : xs)`)
 *  - switch_label fires once per `case X:` or `default:`. We exclude
 *    default via a #match? predicate to match the JS plugin convention
 *    of "case but not default"
 *  - catch_clause is one branch per exception handler (try itself isn't
 *    a branch — the no-exception path is the "default")
 *  - binary_expression with && / || (Java has no nullish-coalescing)
 *  - ternary_expression (Java's `cond ? a : b`)
 */
const DECISION_POINTS_QUERY = `
(if_statement) @p
(while_statement) @p
(for_statement) @p
(enhanced_for_statement) @p
(do_statement) @p
((switch_label) @p (#match? @p "^case"))
(catch_clause) @p
(binary_expression operator: "&&") @p
(binary_expression operator: "||") @p
(ternary_expression) @p
`;

const QUERIES: PluginQueries = {
  imports: IMPORTS_QUERY,
  functionDefs: FUNCTION_DEFS_QUERY,
  callSites: CALL_SITES_QUERY,
  decisionPoints: DECISION_POINTS_QUERY,
};

// ------------------- Index construction -------------------

/** Build FQN→path and package→members maps from the .java files in the
 *  FileIndex. Pure regex on the package declaration — fast even on large
 *  repos because we only read the first ~200 bytes of each file's content
 *  (the package line is always near the top). */
function buildJavaContext(ix: FileIndex): JavaResolverContext {
  const fqnToPath = new Map<string, string>();
  const packageMembers = new Map<string, string[]>();

  for (const f of ix.byPath.values()) {
    if (f.ext !== "java") continue;
    // Sample only the head of the file — package declaration must be at
    // the top, after optional comments. 2KB is plenty.
    const head = f.content.slice(0, 2048);
    const m = PACKAGE_RE.exec(head);
    const pkg = m?.[1] ?? null;
    const className = path.posix.basename(f.rel, ".java");
    const fqn = pkg ? `${pkg}.${className}` : className;
    fqnToPath.set(fqn, f.rel);
    if (pkg) {
      let members = packageMembers.get(pkg);
      if (!members) {
        members = [];
        packageMembers.set(pkg, members);
      }
      members.push(f.rel);
    }
  }

  // Sort each package member list for deterministic wildcard resolution.
  for (const arr of packageMembers.values()) arr.sort();

  return { fqnToPath, packageMembers };
}

// ------------------- Import resolution -------------------

function resolveJavaImport(
  spec: string,
  _fromPath: string,
  ix: FileIndex
): string | null {
  const ctx = ix.extras.get(PLUGIN_NAME) as JavaResolverContext | undefined;
  if (!ctx) return null;

  // 1. Direct FQN match — `import com.foo.Bar;`
  const direct = ctx.fqnToPath.get(spec);
  if (direct) return direct;

  // 2. Treat as package — covers wildcard imports (`import com.foo.*;` →
  //    spec is "com.foo") and also static imports of static members from
  //    a package (rare but tolerated). Returns the alphabetically-first
  //    member of the package as a stable anchor for blast-radius.
  const members = ctx.packageMembers.get(spec);
  if (members && members.length > 0) {
    return members[0];
  }

  return null;
}

// ------------------- Plugin -------------------

export const javaPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-java");
  },

  async prepareForRepo(_root: string, ix: FileIndex) {
    ix.extras.set(PLUGIN_NAME, buildJavaContext(ix));
  },

  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `java plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    return QUERIES;
  },

  resolveImport: resolveJavaImport,
} satisfies CodeAnalysisPlugin;
