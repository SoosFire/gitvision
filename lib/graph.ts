// Build a file-dependency graph for a GitHub repo.
//
// Approach:
//   1. Download the default-branch tarball (one API call regardless of repo size)
//   2. Extract to a temp directory
//   3. Walk source files, parse per-language (JS/TS/Java/Python/Go)
//   4. Resolve module paths to file paths
//   5. Compute BFS layers + wrapped layout positions
//
// Parsers are intentionally regex-based — fast, dependency-free, ~90-95% accurate
// for well-formatted code. Upgrade path: swap JS/TS for @babel/parser later.

import { Octokit } from "octokit";
import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import * as tar from "tar";
import type {
  FileGraph,
  FileGraphEdge,
  FileGraphEdgeKind,
  FileGraphNode,
} from "./types";

// ------------------- Tarball fetch + extract -------------------

const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".cache",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);

const MAX_FILE_BYTES = 1_000_000; // 1MB — skip minified/generated files
const MAX_TOTAL_FILES = 3000; // safety cap

/** Download a GitHub repo tarball, extract it to a temp dir, return the
 *  extracted-source path plus a cleanup function. Exported so codeAnalysis
 *  can reuse the same primitive for its own pipeline (and a future dev/debug
 *  endpoint) without duplicating tar logic. */
export async function downloadAndExtract(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<{ extractDir: string; cleanup: () => Promise<void> }> {
  const tmpRoot = path.join(os.tmpdir(), `gitvision-${nanoid(8)}`);
  await fs.mkdir(tmpRoot, { recursive: true });

  // Octokit returns a Response-like object for binary endpoints
  const res = await octokit.rest.repos.downloadTarballArchive({
    owner,
    repo,
    ref,
  });
  // `data` is an ArrayBuffer
  const buf = Buffer.from(res.data as ArrayBuffer);

  const tarballPath = path.join(tmpRoot, "archive.tar.gz");
  await fs.writeFile(tarballPath, buf);

  const extractDir = path.join(tmpRoot, "src");
  await fs.mkdir(extractDir, { recursive: true });

  // GitHub tarballs have one top-level dir like `owner-repo-<sha>/`. Strip it.
  await tar.x({
    file: tarballPath,
    cwd: extractDir,
    strip: 1,
  });

  await fs.unlink(tarballPath).catch(() => {});
  return {
    extractDir,
    cleanup: async () => {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    if (out.length >= MAX_TOTAL_FILES) return;
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_TOTAL_FILES) return;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        await visit(path.join(dir, e.name));
      } else if (e.isFile()) {
        out.push(path.join(dir, e.name));
      }
    }
  }
  await visit(root);
  return out;
}

// ------------------- File records + indexes -------------------

interface FileRecord {
  abs: string; // absolute path
  rel: string; // posix-style relative path from repo root
  ext: string;
  bytes: number;
  content?: string;
}

const CODE_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "java",
  "kt",
  "cs",
  "php",
  "rb",
  "py",
  "go",
  "rs",
  "html",
  "css",
]);

async function readCodeFiles(root: string): Promise<FileRecord[]> {
  const abs = await walkFiles(root);
  const records: FileRecord[] = [];
  for (const a of abs) {
    const rel = path.relative(root, a).split(path.sep).join("/");
    const ext = path.extname(a).slice(1).toLowerCase();
    if (!CODE_EXTS.has(ext)) continue;
    let st;
    try {
      st = await fs.stat(a);
    } catch {
      continue;
    }
    if (st.size > MAX_FILE_BYTES) continue;
    let content: string | undefined;
    try {
      content = await fs.readFile(a, "utf-8");
    } catch {
      continue;
    }
    records.push({ abs: a, rel, ext, bytes: st.size, content });
  }
  return records;
}

interface IndexedFiles {
  byPath: Map<string, FileRecord>;
  // JVM family (Java + Kotlin) — same FQN shape: pkg.ClassName
  jvmFqnToPath: Map<string, string>;
  jvmPackageMembers: Map<string, string[]>;
  // C# — namespace.ClassName with dot separator (same shape as JVM)
  csharpFqnToPath: Map<string, string>;
  csharpNamespaceMembers: Map<string, string[]>;
  // PHP — namespace\ClassName with backslash separator
  phpFqnToPath: Map<string, string>;
  phpNamespaceMembers: Map<string, string[]>;
  // Ruby — class name (PascalCase or snake_case) → file
  rubyClassToPath: Map<string, string>;
  templateBaseName: Map<string, string>;
}

function extractClassNames(content: string, regexes: RegExp[]): string[] {
  const names: string[] = [];
  for (const re of regexes) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) names.push(m[1]);
  }
  return names;
}

function buildIndexes(files: FileRecord[]): IndexedFiles {
  const byPath = new Map<string, FileRecord>();
  const jvmFqnToPath = new Map<string, string>();
  const jvmPackageMembers = new Map<string, string[]>();
  const csharpFqnToPath = new Map<string, string>();
  const csharpNamespaceMembers = new Map<string, string[]>();
  const phpFqnToPath = new Map<string, string>();
  const phpNamespaceMembers = new Map<string, string[]>();
  const rubyClassToPath = new Map<string, string>();
  const templateBaseName = new Map<string, string>();

  for (const f of files) {
    byPath.set(f.rel, f);
    if (!f.content) continue;

    if (f.ext === "java") {
      const pkg = /^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m.exec(f.content)?.[1];
      const className = path.basename(f.rel, ".java");
      if (pkg) {
        jvmFqnToPath.set(`${pkg}.${className}`, f.rel);
        (jvmPackageMembers.get(pkg) ?? jvmPackageMembers.set(pkg, []).get(pkg)!)
          .push(f.rel);
      }
    } else if (f.ext === "kt") {
      // Kotlin: package has no semicolon and supports "package foo.bar"
      const pkg = /^\s*package\s+([a-zA-Z0-9_.]+)/m.exec(f.content)?.[1];
      const className = path.basename(f.rel, ".kt");
      if (pkg) {
        jvmFqnToPath.set(`${pkg}.${className}`, f.rel);
        (jvmPackageMembers.get(pkg) ?? jvmPackageMembers.set(pkg, []).get(pkg)!)
          .push(f.rel);
      }
    } else if (f.ext === "cs") {
      // C#: one or more "namespace X" blocks — register all classes under each
      const nsMatches = [
        ...f.content.matchAll(
          /namespace\s+([a-zA-Z0-9_.]+)\s*[{;]/g
        ),
      ];
      const classes = extractClassNames(f.content, [
        /\b(?:public\s+|internal\s+|private\s+|protected\s+|sealed\s+|abstract\s+|static\s+)*(?:partial\s+)?(?:class|struct|interface|record|enum)\s+(\w+)/g,
      ]);
      // If file has a namespace, register classes under it. Otherwise use "global".
      const nsList =
        nsMatches.length > 0 ? nsMatches.map((m) => m[1]) : ["global"];
      for (const ns of nsList) {
        for (const cls of classes) {
          csharpFqnToPath.set(`${ns}.${cls}`, f.rel);
        }
        (
          csharpNamespaceMembers.get(ns) ??
          csharpNamespaceMembers.set(ns, []).get(ns)!
        ).push(f.rel);
      }
    } else if (f.ext === "php") {
      const ns = /^\s*namespace\s+([A-Za-z0-9_\\]+)\s*;/m.exec(f.content)?.[1];
      const classes = extractClassNames(f.content, [
        /\b(?:abstract\s+|final\s+)*(?:class|interface|trait|enum)\s+(\w+)/g,
      ]);
      if (ns) {
        for (const cls of classes) {
          phpFqnToPath.set(`${ns}\\${cls}`, f.rel);
        }
        (
          phpNamespaceMembers.get(ns) ??
          phpNamespaceMembers.set(ns, []).get(ns)!
        ).push(f.rel);
      } else {
        // No namespace — register bare class names
        for (const cls of classes) phpFqnToPath.set(cls, f.rel);
      }
    } else if (f.ext === "rb") {
      // Ruby: index both the snake-case basename and any declared classes/modules
      const base = path.basename(f.rel, ".rb");
      rubyClassToPath.set(base, f.rel);
      const classes = extractClassNames(f.content, [
        /^\s*(?:class|module)\s+([A-Z]\w*)/gm,
      ]);
      for (const cls of classes) rubyClassToPath.set(cls, f.rel);
    } else if (f.ext === "html") {
      templateBaseName.set(path.basename(f.rel, ".html"), f.rel);
    }
  }
  return {
    byPath,
    jvmFqnToPath,
    jvmPackageMembers,
    csharpFqnToPath,
    csharpNamespaceMembers,
    phpFqnToPath,
    phpNamespaceMembers,
    rubyClassToPath,
    templateBaseName,
  };
}

// ------------------- Parsers -------------------

type EdgeOut = { to: string; kind: FileGraphEdgeKind };

// JS / TS / JSX / TSX / MJS / CJS
// Matches: import ... from "x"   import "x"   require("x")   export * from "x"
const JS_IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?from\s+)?|require\s*\(\s*|export\s+(?:\*|\{[^}]*\})\s+from\s+)["']([^"']+)["']\s*\)?/g;

const JS_EXTS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

function resolveJsImport(
  spec: string,
  fromPath: string,
  byPath: Map<string, FileRecord>
): string | null {
  // External packages (no leading . or /) → skip
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;

  const fromDir = path.posix.dirname(fromPath);
  const base = path.posix.normalize(path.posix.join(fromDir, spec));

  // Try base as-is (already has extension?)
  if (byPath.has(base)) return base;

  for (const ext of JS_EXTS) {
    const cand = `${base}.${ext}`;
    if (byPath.has(cand)) return cand;
  }
  for (const ext of JS_EXTS) {
    const cand = `${base}/index.${ext}`;
    if (byPath.has(cand)) return cand;
  }
  return null;
}

function parseJsLike(file: FileRecord, ix: IndexedFiles): EdgeOut[] {
  if (!file.content) return [];
  const edges: EdgeOut[] = [];
  const seen = new Set<string>();
  JS_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JS_IMPORT_RE.exec(file.content))) {
    const spec = m[1];
    const target = resolveJsImport(spec, file.rel, ix.byPath);
    if (target && target !== file.rel && !seen.has(target)) {
      seen.add(target);
      edges.push({ to: target, kind: "import" });
    }
  }
  return edges;
}

// Java
const JAVA_IMPORT_RE =
  /^\s*import\s+(?:static\s+)?([a-zA-Z0-9_.]+)(\.\*)?\s*;/gm;
const JAVA_RETURN_TEMPLATE_RE = /return\s+"([a-zA-Z0-9_\-\/]+)"/g;
const JAVA_EXTENDS_RE = /\bclass\s+\w+\s+extends\s+([A-Z][A-Za-z0-9_]*)/g;
const JAVA_IMPLEMENTS_RE =
  /\b(?:class|enum)\s+\w+(?:\s+extends\s+[A-Za-z0-9_.]+)?\s+implements\s+([A-Za-z0-9_.,\s]+?)(?=\s*\{)/g;

function resolveJavaSimpleName(
  simpleName: string,
  fromPath: string,
  ix: IndexedFiles,
  imports: string[]
): string | null {
  // Check imports first
  for (const imp of imports) {
    if (imp.endsWith(`.${simpleName}`)) {
      const p = ix.jvmFqnToPath.get(imp);
      if (p) return p;
    }
  }
  // Same package
  const fromFile = ix.byPath.get(fromPath);
  if (fromFile?.content) {
    const pkg = /^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m.exec(fromFile.content)?.[1];
    if (pkg) {
      const candidate = ix.jvmFqnToPath.get(`${pkg}.${simpleName}`);
      if (candidate) return candidate;
    }
  }
  return null;
}

function parseJava(file: FileRecord, ix: IndexedFiles): EdgeOut[] {
  if (!file.content) return [];
  const edges: EdgeOut[] = [];
  const seen = new Set<string>();
  const importFqns: string[] = [];

  JAVA_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JAVA_IMPORT_RE.exec(file.content))) {
    const fqn = m[1];
    const isWildcard = !!m[2];
    importFqns.push(fqn);
    if (isWildcard) {
      const members = ix.jvmPackageMembers.get(fqn);
      if (members) {
        for (const p of members) {
          if (p !== file.rel && !seen.has(`imp:${p}`)) {
            seen.add(`imp:${p}`);
            edges.push({ to: p, kind: "import" });
          }
        }
      }
    } else {
      const target = ix.jvmFqnToPath.get(fqn);
      if (target && target !== file.rel && !seen.has(`imp:${target}`)) {
        seen.add(`imp:${target}`);
        edges.push({ to: target, kind: "import" });
      }
    }
  }

  // extends/implements (Java)
  JAVA_EXTENDS_RE.lastIndex = 0;
  while ((m = JAVA_EXTENDS_RE.exec(file.content))) {
    const target = resolveJavaSimpleName(m[1], file.rel, ix, importFqns);
    if (target && target !== file.rel && !seen.has(`ext:${target}`)) {
      seen.add(`ext:${target}`);
      edges.push({ to: target, kind: "extends" });
    }
  }
  JAVA_IMPLEMENTS_RE.lastIndex = 0;
  while ((m = JAVA_IMPLEMENTS_RE.exec(file.content))) {
    const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      const target = resolveJavaSimpleName(n, file.rel, ix, importFqns);
      if (target && target !== file.rel && !seen.has(`impl:${target}`)) {
        seen.add(`impl:${target}`);
        edges.push({ to: target, kind: "implements" });
      }
    }
  }

  // Controllers → returned template names (Spring MVC / Thymeleaf)
  if (/Controller\.java$/.test(file.rel)) {
    JAVA_RETURN_TEMPLATE_RE.lastIndex = 0;
    while ((m = JAVA_RETURN_TEMPLATE_RE.exec(file.content))) {
      const templateFile = ix.templateBaseName.get(m[1]);
      if (templateFile && !seen.has(`ren:${templateFile}`)) {
        seen.add(`ren:${templateFile}`);
        edges.push({ to: templateFile, kind: "renders" });
      }
    }
  }
  return edges;
}

// Kotlin — same shape as Java, but syntax is different (no semicolons, `:` for inheritance)
const KOTLIN_IMPORT_RE = /^\s*import\s+([a-zA-Z0-9_.]+)(\.\*)?/gm;
const KOTLIN_INHERIT_RE =
  /\b(?:class|object|interface|data\s+class|sealed\s+class)\s+\w+(?:<[^>]*>)?\s*(?:\([^)]*\))?\s*:\s*([A-Za-z0-9_.<>,\s()]+?)(?=\s*\{|\s*$)/gm;

function parseKotlin(file: FileRecord, ix: IndexedFiles): EdgeOut[] {
  if (!file.content) return [];
  const edges: EdgeOut[] = [];
  const seen = new Set<string>();
  const importFqns: string[] = [];

  KOTLIN_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KOTLIN_IMPORT_RE.exec(file.content))) {
    const fqn = m[1];
    const isWildcard = !!m[2];
    importFqns.push(fqn);
    if (isWildcard) {
      const members = ix.jvmPackageMembers.get(fqn);
      if (members) {
        for (const p of members) {
          if (p !== file.rel && !seen.has(`imp:${p}`)) {
            seen.add(`imp:${p}`);
            edges.push({ to: p, kind: "import" });
          }
        }
      }
    } else {
      const target = ix.jvmFqnToPath.get(fqn);
      if (target && target !== file.rel && !seen.has(`imp:${target}`)) {
        seen.add(`imp:${target}`);
        edges.push({ to: target, kind: "import" });
      }
    }
  }

  // Inheritance list: first type with () is parent class, others are interfaces
  KOTLIN_INHERIT_RE.lastIndex = 0;
  while ((m = KOTLIN_INHERIT_RE.exec(file.content))) {
    const list = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const nameMatch = /^([A-Z][A-Za-z0-9_.]*)/.exec(entry);
      if (!nameMatch) continue;
      const simpleName = nameMatch[1].split(".").pop()!;
      // Resolve via imports or same package
      let target: string | null = null;
      for (const imp of importFqns) {
        if (imp.endsWith(`.${simpleName}`)) {
          target = ix.jvmFqnToPath.get(imp) ?? null;
          if (target) break;
        }
      }
      if (!target) {
        const fromFile = ix.byPath.get(file.rel);
        const pkg = fromFile?.content
          ? /^\s*package\s+([a-zA-Z0-9_.]+)/m.exec(fromFile.content)?.[1]
          : null;
        if (pkg) target = ix.jvmFqnToPath.get(`${pkg}.${simpleName}`) ?? null;
      }
      if (target && target !== file.rel) {
        // Parent class has `()` — implements lack it. First item without paren is ambiguous; treat as extends.
        const kind: FileGraphEdgeKind = /\(/.test(entry)
          ? "extends"
          : i === 0
          ? "extends"
          : "implements";
        const key = `${kind}:${target}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ to: target, kind });
        }
      }
    }
  }
  return edges;
}

// C# — `using Namespace;` covers everything in that namespace. We over-generate
// edges to every class in the imported namespace — it's a valid approximation
// since any of those could be referenced.
const CS_USING_RE = /^\s*using\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm;
const CS_INHERIT_RE =
  /\b(?:class|struct|interface|record)\s+\w+(?:<[^>]*>)?\s*:\s*([A-Za-z0-9_,<>\s.]+?)(?=\s*(?:where|\{|$))/gm;

function parseCSharp(file: FileRecord, ix: IndexedFiles): EdgeOut[] {
  if (!file.content) return [];
  const edges: EdgeOut[] = [];
  const seen = new Set<string>();
  const usedNamespaces: string[] = [];

  CS_USING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CS_USING_RE.exec(file.content))) {
    const ns = m[1];
    usedNamespaces.push(ns);
    const members = ix.csharpNamespaceMembers.get(ns);
    if (members) {
      for (const p of members) {
        if (p !== file.rel && !seen.has(`imp:${p}`)) {
          seen.add(`imp:${p}`);
          edges.push({ to: p, kind: "import" });
        }
      }
    }
  }

  // Inheritance — first entry could be class or interface (convention: `I` prefix = interface)
  CS_INHERIT_RE.lastIndex = 0;
  while ((m = CS_INHERIT_RE.exec(file.content))) {
    const list = m[1]
      .split(",")
      .map((s) => s.trim().split("<")[0])
      .filter(Boolean);
    for (let i = 0; i < list.length; i++) {
      const name = list[i];
      const simple = name.split(".").pop()!;
      // Look for class in any imported namespace or current namespace
      let target: string | null = null;
      for (const ns of usedNamespaces) {
        const t = ix.csharpFqnToPath.get(`${ns}.${simple}`);
        if (t) {
          target = t;
          break;
        }
      }
      if (!target) {
        // Try bare class name (global / same namespace)
        for (const [k, v] of ix.csharpFqnToPath) {
          if (k.endsWith(`.${simple}`) || k === simple) {
            target = v;
            break;
          }
        }
      }
      if (target && target !== file.rel) {
        const isInterface = simple.startsWith("I") && /^I[A-Z]/.test(simple);
        const kind: FileGraphEdgeKind =
          isInterface || i > 0 ? "implements" : "extends";
        const key = `${kind}:${target}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ to: target, kind });
        }
      }
    }
  }
  return edges;
}

// PHP — namespaces use backslash. `use Foo\Bar\Baz` imports a single class.
const PHP_USE_RE =
  /^\s*use\s+([A-Za-z0-9_\\]+)(?:\s+as\s+\w+)?\s*;/gm;
const PHP_REQUIRE_RE =
  /\b(?:require|require_once|include|include_once)\s*\(?\s*['"]([^'"]+)['"]/g;
const PHP_INHERIT_RE =
  /\bclass\s+\w+(?:\s+extends\s+([A-Za-z0-9_\\]+))?(?:\s+implements\s+([A-Za-z0-9_\\,\s]+))?/g;

function resolvePhpClass(
  name: string,
  currentNs: string | null,
  useMap: Map<string, string>,
  ix: IndexedFiles
): string | null {
  const clean = name.replace(/^\\/, "");
  if (clean.includes("\\")) {
    // Already fully-qualified-ish
    const target = ix.phpFqnToPath.get(clean);
    if (target) return target;
  }
  // Aliased via use
  const viaUse = useMap.get(clean);
  if (viaUse) {
    const t = ix.phpFqnToPath.get(viaUse);
    if (t) return t;
  }
  // Same namespace as the importing file
  if (currentNs) {
    const t = ix.phpFqnToPath.get(`${currentNs}\\${clean}`);
    if (t) return t;
  }
  // Bare (no-namespace) class
  return ix.phpFqnToPath.get(clean) ?? null;
}

function parsePhp(file: FileRecord, ix: IndexedFiles): EdgeOut[] {
  if (!file.content) return [];
  const edges: EdgeOut[] = [];
  const seen = new Set<string>();
  const useMap = new Map<string, string>(); // alias/last-segment → full FQN
  const currentNs =
    /^\s*namespace\s+([A-Za-z0-9_\\]+)\s*;/m.exec(file.content)?.[1] ?? null;

  PHP_USE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHP_USE_RE.exec(file.content))) {
    const fqn = m[1].replace(/^\\/, "");
    const shortName = fqn.split("\\").pop()!;
    useMap.set(shortName, fqn);
    const target = ix.phpFqnToPath.get(fqn);
    if (target && target !== file.rel && !seen.has(`imp:${target}`)) {
      seen.add(`imp:${target}`);
      edges.push({ to: target, kind: "import" });
    }
  }

  // Path-based includes
  PHP_REQUIRE_RE.lastIndex = 0;
  while ((m = PHP_REQUIRE_RE.exec(file.content))) {
    const spec = m[1];
    if (!spec.includes("/") && !spec.includes("\\")) continue;
    const fromDir = path.posix.dirname(file.rel);
    const norm = path.posix.normalize(
      path.posix.join(fromDir, spec.replace(/\\/g, "/"))
    );
    if (ix.byPath.has(norm) && norm !== file.rel && !seen.has(`imp:${norm}`)) {
      seen.add(`imp:${norm}`);
      edges.push({ to: norm, kind: "import" });
    }
  }

  // Inheritance
  PHP_INHERIT_RE.lastIndex = 0;
  while ((m = PHP_INHERIT_RE.exec(file.content))) {
    const parent = m[1];
    const interfaces = m[2];
    if (parent) {
      const target = resolvePhpClass(parent, currentNs, useMap, ix);
      if (target && target !== file.rel && !seen.has(`ext:${target}`)) {
        seen.add(`ext:${target}`);
        edges.push({ to: target, kind: "extends" });
      }
    }
    if (interfaces) {
      for (const iface of interfaces.split(",").map((s) => s.trim())) {
        if (!iface) continue;
        const target = resolvePhpClass(iface, currentNs, useMap, ix);
        if (target && target !== file.rel && !seen.has(`impl:${target}`)) {
          seen.add(`impl:${target}`);
          edges.push({ to: target, kind: "implements" });
        }
      }
    }
  }
  return edges;
}

// Ruby — path-based require_relative + class inheritance. Plain `require` usually
// points at gems, so we skip it to avoid noise.
const RUBY_REQUIRE_RE = /^\s*require_relative\s+['"]([^'"]+)['"]/gm;
const RUBY_CLASS_RE = /^\s*class\s+\w+\s*<\s*([A-Z][A-Za-z0-9_:]*)/gm;
const RUBY_INCLUDE_RE = /^\s*include\s+([A-Z][A-Za-z0-9_:]*)/gm;

function parseRuby(file: FileRecord, ix: IndexedFiles): EdgeOut[] {
  if (!file.content) return [];
  const edges: EdgeOut[] = [];
  const seen = new Set<string>();
  const fromDir = path.posix.dirname(file.rel);

  RUBY_REQUIRE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUBY_REQUIRE_RE.exec(file.content))) {
    const spec = m[1];
    const base = path.posix.normalize(path.posix.join(fromDir, spec));
    const candidate = base.endsWith(".rb") ? base : `${base}.rb`;
    if (
      ix.byPath.has(candidate) &&
      candidate !== file.rel &&
      !seen.has(`imp:${candidate}`)
    ) {
      seen.add(`imp:${candidate}`);
      edges.push({ to: candidate, kind: "import" });
    }
  }

  // Class inheritance
  RUBY_CLASS_RE.lastIndex = 0;
  while ((m = RUBY_CLASS_RE.exec(file.content))) {
    const name = m[1].split("::").pop()!;
    const target = ix.rubyClassToPath.get(name);
    if (target && target !== file.rel && !seen.has(`ext:${target}`)) {
      seen.add(`ext:${target}`);
      edges.push({ to: target, kind: "extends" });
    }
  }

  // Module includes → implements (conceptually similar)
  RUBY_INCLUDE_RE.lastIndex = 0;
  while ((m = RUBY_INCLUDE_RE.exec(file.content))) {
    const name = m[1].split("::").pop()!;
    const target = ix.rubyClassToPath.get(name);
    if (target && target !== file.rel && !seen.has(`impl:${target}`)) {
      seen.add(`impl:${target}`);
      edges.push({ to: target, kind: "implements" });
    }
  }
  return edges;
}

// Python
// Matches: import foo.bar   from foo.bar import x   from . import y   from .foo import y
const PY_IMPORT_RE = /^\s*(?:from\s+(\.+)?([a-zA-Z0-9_.]*)\s+import|import\s+([a-zA-Z0-9_.]+))/gm;

function resolvePython(
  dots: string | undefined,
  moduleParts: string[],
  fromPath: string,
  byPath: Map<string, FileRecord>
): string | null {
  let base: string;
  if (dots && dots.length > 0) {
    const fromDir = path.posix.dirname(fromPath);
    const up = dots.length - 1;
    const parts = fromDir.split("/").filter(Boolean);
    if (up > parts.length) return null;
    base = parts.slice(0, parts.length - up).concat(moduleParts).join("/");
  } else {
    base = moduleParts.join("/");
  }
  if (!base) return null;
  const direct = `${base}.py`;
  if (byPath.has(direct)) return direct;
  const pkg = `${base}/__init__.py`;
  if (byPath.has(pkg)) return pkg;
  // Fuzzy: repo root may be inside a src/ folder etc.
  for (const key of byPath.keys()) {
    if (key.endsWith(`/${direct}`) || key.endsWith(`/${pkg}`)) return key;
  }
  return null;
}

function parsePython(file: FileRecord, ix: IndexedFiles): EdgeOut[] {
  if (!file.content) return [];
  const edges: EdgeOut[] = [];
  const seen = new Set<string>();
  PY_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PY_IMPORT_RE.exec(file.content))) {
    const mod = m[2] || m[3] || "";
    const dots = m[1];
    if (!mod && !dots) continue;
    const parts = mod.split(".").filter(Boolean);
    const target = resolvePython(dots, parts, file.rel, ix.byPath);
    if (target && target !== file.rel && !seen.has(target)) {
      seen.add(target);
      edges.push({ to: target, kind: "import" });
    }
  }
  return edges;
}

// Go — only resolve local-module imports. Without parsing go.mod we use heuristic:
// any import whose prefix matches a folder in the repo is considered local.
const GO_IMPORT_SINGLE = /^\s*import\s+"([^"]+)"/gm;
const GO_IMPORT_BLOCK = /^\s*import\s*\(\s*([\s\S]*?)\s*\)/gm;
const GO_INNER_IMPORT = /"([^"]+)"/g;

function parseGo(file: FileRecord, ix: IndexedFiles): EdgeOut[] {
  if (!file.content) return [];
  const edges: EdgeOut[] = [];
  const seen = new Set<string>();
  const specs: string[] = [];

  GO_IMPORT_SINGLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GO_IMPORT_SINGLE.exec(file.content))) specs.push(m[1]);

  GO_IMPORT_BLOCK.lastIndex = 0;
  while ((m = GO_IMPORT_BLOCK.exec(file.content))) {
    const block = m[1];
    GO_INNER_IMPORT.lastIndex = 0;
    let n: RegExpExecArray | null;
    while ((n = GO_INNER_IMPORT.exec(block))) specs.push(n[1]);
  }

  for (const spec of specs) {
    // Look for any file under a folder matching the last path segments
    const parts = spec.split("/");
    for (let take = Math.min(parts.length, 4); take >= 1; take--) {
      const suffix = parts.slice(-take).join("/");
      for (const key of ix.byPath.keys()) {
        if (!key.endsWith(".go")) continue;
        if (
          key.startsWith(`${suffix}/`) ||
          key.includes(`/${suffix}/`) ||
          path.posix.dirname(key).endsWith(suffix)
        ) {
          if (key !== file.rel && !seen.has(key)) {
            seen.add(key);
            edges.push({ to: key, kind: "import" });
          }
          break;
        }
      }
      if (seen.size > 0) break;
    }
  }
  return edges;
}

// ------------------- Layer + layout -------------------

const NODE_W = 220;
const NODE_GAP_X = 30;
const ROW_H = 90;
const LAYER_GAP = 80;
const MAX_PER_ROW = 10;

function computeLayers(
  paths: string[],
  edges: FileGraphEdge[]
): Map<string, number> {
  const incoming = new Map<string, Set<string>>();
  for (const p of paths) incoming.set(p, new Set());
  for (const e of edges) incoming.get(e.to)?.add(e.from);

  const layer = new Map<string, number>();
  function compute(p: string, visiting: Set<string>): number {
    const cached = layer.get(p);
    if (cached !== undefined) return cached;
    if (visiting.has(p)) return 0; // cycle guard
    visiting.add(p);
    let l = 0;
    for (const src of incoming.get(p) ?? []) {
      l = Math.max(l, compute(src, visiting) + 1);
    }
    visiting.delete(p);
    layer.set(p, l);
    return l;
  }
  for (const p of paths) compute(p, new Set());
  return layer;
}

function computeLayout(
  records: FileRecord[],
  edges: FileGraphEdge[]
): FileGraphNode[] {
  const paths = records.map((r) => r.rel);
  const layers = computeLayers(paths, edges);
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const p of paths) {
    inDeg.set(p, 0);
    outDeg.set(p, 0);
  }
  for (const e of edges) {
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
  }

  const byLayer = new Map<number, FileRecord[]>();
  for (const r of records) {
    const l = layers.get(r.rel) ?? 0;
    const arr = byLayer.get(l) ?? [];
    arr.push(r);
    byLayer.set(l, arr);
  }
  for (const [, arr] of byLayer) {
    arr.sort((a, b) => {
      const ga = a.rel.split("/").slice(0, -1).join("/");
      const gb = b.rel.split("/").slice(0, -1).join("/");
      return ga.localeCompare(gb) || a.rel.localeCompare(b.rel);
    });
  }

  const nodes: FileGraphNode[] = [];
  const maxLayer = Math.max(0, ...byLayer.keys());
  let yCursor = 0;
  for (let l = 0; l <= maxLayer; l++) {
    const arr = byLayer.get(l) ?? [];
    const rows = Math.max(1, Math.ceil(arr.length / MAX_PER_ROW));
    for (let r = 0; r < rows; r++) {
      const start = r * MAX_PER_ROW;
      const end = Math.min(start + MAX_PER_ROW, arr.length);
      const count = end - start;
      const totalW = count * NODE_W + (count - 1) * NODE_GAP_X;
      const startX = -totalW / 2;
      for (let i = 0; i < count; i++) {
        const f = arr[start + i];
        nodes.push({
          path: f.rel,
          ext: f.ext,
          layer: l,
          inDegree: inDeg.get(f.rel) ?? 0,
          outDegree: outDeg.get(f.rel) ?? 0,
          x: startX + i * (NODE_W + NODE_GAP_X),
          y: yCursor + r * ROW_H,
        });
      }
    }
    yCursor += rows * ROW_H + LAYER_GAP;
  }
  return nodes;
}

// ------------------- Top-level entry -------------------

const PARSER_BY_EXT: Record<string, (f: FileRecord, ix: IndexedFiles) => EdgeOut[]> = {
  ts: parseJsLike,
  tsx: parseJsLike,
  js: parseJsLike,
  jsx: parseJsLike,
  mjs: parseJsLike,
  cjs: parseJsLike,
  java: parseJava,
  kt: parseKotlin,
  cs: parseCSharp,
  php: parsePhp,
  rb: parseRuby,
  py: parsePython,
  go: parseGo,
};

export async function buildFileGraph(
  octokit: Octokit,
  owner: string,
  repo: string,
  defaultBranch: string
): Promise<FileGraph> {
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const extracted = await downloadAndExtract(octokit, owner, repo, defaultBranch);
    cleanup = extracted.cleanup;
    const records = await readCodeFiles(extracted.extractDir);

    const truncated =
      records.length >= MAX_TOTAL_FILES
        ? `Repo too large — capped at ${MAX_TOTAL_FILES} files`
        : undefined;

    const ix = buildIndexes(records);

    const edges: FileGraphEdge[] = [];
    const edgeKey = new Set<string>();
    let skipped = 0;
    for (const f of records) {
      const parser = PARSER_BY_EXT[f.ext];
      if (!parser) {
        skipped++;
        continue;
      }
      try {
        for (const out of parser(f, ix)) {
          const k = `${out.kind}|${f.rel}|${out.to}`;
          if (edgeKey.has(k)) continue;
          edgeKey.add(k);
          edges.push({ from: f.rel, to: out.to, kind: out.kind });
        }
      } catch {
        skipped++;
      }
    }

    const nodes = computeLayout(records, edges);

    const filesByLanguage: Record<string, number> = {};
    for (const r of records) filesByLanguage[r.ext] = (filesByLanguage[r.ext] ?? 0) + 1;
    const edgesByKind: Record<string, number> = {};
    for (const e of edges) edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1;

    return {
      nodes,
      edges,
      stats: {
        totalFiles: records.length,
        filesByLanguage,
        edgesByKind,
        skipped,
      },
      truncated,
    };
  } catch (err) {
    return {
      nodes: [],
      edges: [],
      stats: {
        totalFiles: 0,
        filesByLanguage: {},
        edgesByKind: {},
        skipped: 0,
      },
      truncated: err instanceof Error ? err.message : "Unknown error",
    };
  } finally {
    if (cleanup) await cleanup();
  }
}

// Avoid unused-import warnings
void createWriteStream;
void pipeline;
