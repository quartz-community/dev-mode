/**
 * Per-file static analysis for the plugin catalog.
 *
 * Uses the TypeScript compiler API in *syntax-only* mode (`createSourceFile`,
 * no Program / type checker) so the whole workspace can be scanned in a few
 * seconds. Everything here is heuristic but tuned against real Quartz plugins:
 *
 * - "data objects" are expressions that evaluate to a vfile `DataMap`
 *   (`file.data`, `vfile.data`, `content[1].data`, `fileData`, `props.fileData`,
 *   callback params of `allFiles.filter(...)`, aliases like `const d = file.data`).
 * - property accesses on data objects are classified as reads or writes
 *   (assignment, `??=`, `delete`, `.push()`, `Object.assign`, nested assignment).
 * - each access is attributed to the plugin hook it runs in (htmlPlugins,
 *   emit, ...) either lexically or through named helper functions referenced
 *   from inside a hook (resolved package-wide by `resolvePhases`).
 */
import ts from "typescript";
import type {
  DataMapDecl,
  EmittedOutput,
  FrontmatterAccess,
  Phase,
} from "./types.js";

export const HOOK_NAMES = [
  "textTransform",
  "markdownPlugins",
  "htmlPlugins",
  "externalResources",
  "shouldPublish",
  "emit",
  "partialEmit",
  "getQuartzComponents",
  "match",
  "generate",
  "body",
  "treeTransforms",
] as const;
const HOOK_SET = new Set<string>(HOOK_NAMES);
/** Extra descriptive properties recorded for pageType-ish objects. */
const PAGE_TYPE_PROPS = new Set([
  "layout",
  "frame",
  "fileExtensions",
  "priority",
]);
const COMPONENT_STATICS = new Set(["css", "afterDOMLoaded", "beforeDOMLoaded"]);

const FILE_VAR_RE = /^(file|vfile|f|virtualFile|vf)$|file$/i;
const FILE_ARRAY_RE =
  /^(allFiles|allFilesWithVirtual|pages|allPages)$|[a-z](Files|Pages)$/;
/** `fontFiles`, `virtualPages`, ... are arrays of something else. */
const NOT_FILE_ARRAY_RE =
  /(font|image|asset|static|script|style|source|media|attachment|virtual|css|js|icon|path)/i;
const DATA_TYPE_RE =
  /\b(QuartzPluginData|FileData|VFileData|PluginData|DataMap)\b/;
const ARRAY_METHODS_ITEM_FIRST = new Set([
  "filter",
  "map",
  "forEach",
  "find",
  "findLast",
  "some",
  "every",
  "flatMap",
  "findIndex",
  "sort",
  "toSorted",
]);
const ARRAY_METHODS_PASSTHROUGH = new Set([
  "filter",
  "sort",
  "slice",
  "toSorted",
  "concat",
  "reverse",
]);
const MUTATING_METHODS = new Set([
  "push",
  "unshift",
  "splice",
  "set",
  "add",
  "delete",
  "clear",
  "pop",
  "shift",
]);

export interface RawAccess {
  key: string;
  mode: "read" | "write";
  line: number;
  /** Hook found lexically, if any. */
  hook?: Phase;
  /** Names of enclosing named functions (innermost first) for phase resolution. */
  enclosing: string[];
}

export interface FileFacts {
  file: string;
  hooks: Set<string>;
  accesses: RawAccess[];
  frontmatter: FrontmatterAccess[];
  dataMap: DataMapDecl[];
  exports: string[];
  emits: EmittedOutput[];
  /** name → hooks under which the identifier is referenced lexically. */
  refsInHook: Map<string, Set<Phase>>;
  /** enclosing function name → identifiers referenced inside it. */
  refsInFunction: Map<string, Set<string>>;
  listens: Set<string>;
  dispatches: Set<string>;
  usesAddCleanup: boolean;
  localStorage: Set<string>;
  sessionStorage: Set<string>;
  fetches: Set<string>;
  renderedClasses: Set<string>;
  renderedIds: Set<string>;
  scriptedClasses: Set<string>;
  scriptedIds: Set<string>;
}

function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isTypeAssertionExpression(n) ||
      ts.isSatisfiesExpression(n)
    ) {
      n = n.expression;
    } else if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        n.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      // `file.data ?? {}` is still the data object
      n = n.left;
    } else {
      return n;
    }
  }
}

/** Climb from an expression past wrappers that do not change its identity. */
function climb(node: ts.Node): ts.Node {
  let n = node;
  while (
    n.parent &&
    (ts.isParenthesizedExpression(n.parent) ||
      ts.isAsExpression(n.parent) ||
      ts.isNonNullExpression(n.parent) ||
      ts.isTypeAssertionExpression(n.parent) ||
      ts.isSatisfiesExpression(n.parent))
  ) {
    n = n.parent;
  }
  return n;
}

function propName(
  name: ts.PropertyName | ts.BindingName | undefined,
): string | undefined {
  if (!name) return undefined;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isPrivateIdentifier(name)
  )
    return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function isAssignmentOp(kind: ts.SyntaxKind): boolean {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

/** Text of the right-most identifier of an expression (`a.b.file` → `file`). */
function tailName(expr: ts.Expression): string | undefined {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function stringValue(
  expr: ts.Expression | undefined,
  consts: Map<string, string>,
): string | undefined {
  if (!expr) return undefined;
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))
    return e.text;
  if (ts.isIdentifier(e) && consts.has(e.text)) return consts.get(e.text);
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text;
    for (const span of e.templateSpans) {
      out += "${" + span.expression.getText() + "}" + span.literal.text;
    }
    return out;
  }
  return undefined;
}

function collectStringLiterals(node: ts.Node, out: string[]): void {
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
      out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text);
      for (const s of n.templateSpans) {
        visit(s.expression);
        out.push(s.literal.text);
      }
      return;
    } else if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      return; // comparisons are not class names
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
}

const CLASS_TOKEN_RE = /^-?[_a-zA-Z][\w-]*$/;
function addClassTokens(values: string[], target: Set<string>): void {
  for (const v of values) {
    for (const tok of v.split(/\s+/)) {
      if (!tok || !CLASS_TOKEN_RE.test(tok)) continue;
      // `depth-${n}` → `depth-*` (dynamic suffix)
      target.add(tok.endsWith("-") ? `${tok}*` : tok);
    }
  }
}

/** Extract `.class` and `#id` tokens from a CSS selector string. */
export function selectorTokens(selector: string): {
  classes: string[];
  ids: string[];
} {
  const cleaned = selector
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/"[^"]*"|'[^']*'/g, " ")
    .replace(/#\{[^}]*\}/g, " ")
    .replace(/\$\{[^}]*\}/g, " ");
  const classes: string[] = [];
  const ids: string[] = [];
  // `button.foo` is valid, `1.5em` is not a class
  const re = /(?<![0-9])([.#])(-?[_a-zA-Z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    if (m[2].endsWith("-")) continue; // `#popover-${id}` → dynamic
    (m[1] === "." ? classes : ids).push(m[2]);
  }
  return { classes, ids };
}

const HTML_CLASS_RE = /\bclass(?:Name)?=\\?["']([^"'$<>{}]+)\\?["']/g;
const HTML_ID_RE = /\bid=\\?["']([\w-]+)\\?["']/g;

function hasProp(obj: ts.ObjectLiteralExpression, name: string): boolean {
  return obj.properties.some((p) => propName(p.name) === name);
}

function isPluginObject(obj: ts.ObjectLiteralExpression): boolean {
  const names = obj.properties
    .map((p) => propName(p.name))
    .filter((n): n is string => !!n);
  const hookCount = names.filter((n) => HOOK_SET.has(n)).length;
  if (
    names.includes("match") &&
    (names.includes("body") || names.includes("layout"))
  )
    return true;
  return names.includes("name") && hookCount > 0;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function functionName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.parent
  ) {
    const p = node.parent;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name))
      return p.name.text;
    // const X = (() => {...}) satisfies Y / as Y
    const c = climb(node).parent;
    if (c && ts.isVariableDeclaration(c) && ts.isIdentifier(c.name))
      return c.name.text;
    if (c && ts.isExportAssignment(c)) return "default";
  }
  if (
    ts.isMethodDeclaration(node) &&
    node.name &&
    !HOOK_SET.has(propName(node.name) ?? "")
  ) {
    return propName(node.name);
  }
  return undefined;
}

export interface AnalyzeOptions {
  /** Track vfile data reads/writes (off for browser scripts and non-Quartz tools). */
  data?: boolean;
}

/** Browser bundles (`*.inline.ts`, `components/scripts/*`) see contentIndex entries, not vfile data. */
export function isClientScript(file: string): boolean {
  return /\.inline\.ts$/.test(file) || /(^|\/)scripts\//.test(file);
}

export function analyzeSource(
  file: string,
  text: string,
  opts: AnalyzeOptions = {},
): FileFacts {
  const isTsx = file.endsWith(".tsx");
  const analyzeData = opts.data ?? !isClientScript(file);
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const facts: FileFacts = {
    file,
    hooks: new Set(),
    accesses: [],
    frontmatter: [],
    dataMap: [],
    exports: [],
    emits: [],
    refsInHook: new Map(),
    refsInFunction: new Map(),
    listens: new Set(),
    dispatches: new Set(),
    usesAddCleanup: false,
    localStorage: new Set(),
    sessionStorage: new Set(),
    fetches: new Set(),
    renderedClasses: new Set(),
    renderedIds: new Set(),
    scriptedClasses: new Set(),
    scriptedIds: new Set(),
  };

  const consts = new Map<string, string>();
  const dataAliases = new Set<string>(["fileData"]);
  const fmAliases = new Set<string>();
  const fileArrayAliases = new Set<string>();

  // ---------- helpers that depend on alias state ----------
  const isFileArray = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) {
      return (
        (FILE_ARRAY_RE.test(e.text) && !NOT_FILE_ARRAY_RE.test(e.text)) ||
        fileArrayAliases.has(e.text)
      );
    }
    if (ts.isPropertyAccessExpression(e)) {
      if (e.name.text === "allFiles") {
        // BuildCtx.allFiles is FilePath[]; props.allFiles is QuartzPluginData[]
        const t = tailName(e.expression);
        return t !== "ctx" && t !== "buildCtx";
      }
      return /^(allFiles|allFilesWithVirtual)$/.test(e.name.text);
    }
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const method = e.expression.name.text;
      const recv = e.expression.expression;
      if (ARRAY_METHODS_PASSTHROUGH.has(method) && isFileArray(recv))
        return true;
      if (method === "map") {
        const cb = e.arguments[0];
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          const body = cb.body;
          if (!ts.isBlock(body) && isDataObj(body as ts.Expression))
            return true;
        }
      }
    }
    if (ts.isArrayLiteralExpression(e)) {
      return e.elements.some((el) =>
        ts.isSpreadElement(el)
          ? isFileArray(el.expression)
          : isDataObj(el as ts.Expression),
      );
    }
    return false;
  };

  const isDataObj = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) return dataAliases.has(e.text);
    if (ts.isPropertyAccessExpression(e)) {
      if (e.name.text === "fileData") return true;
      if (e.name.text === "data") {
        const obj = unwrap(e.expression);
        if (ts.isElementAccessExpression(obj)) {
          const arg = obj.argumentExpression;
          return ts.isNumericLiteral(arg) && arg.text === "1";
        }
        const t = tailName(obj);
        return !!t && FILE_VAR_RE.test(t);
      }
      return false;
    }
    if (ts.isElementAccessExpression(e)) {
      // allFiles[i]
      return (
        isFileArray(e.expression) && !ts.isStringLiteral(e.argumentExpression)
      );
    }
    return false;
  };

  const isFrontmatterObj = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) return fmAliases.has(e.text);
    if (ts.isPropertyAccessExpression(e))
      return e.name.text === "frontmatter" && isDataObj(e.expression);
    return false;
  };

  const markParamAsData = (
    param: ts.ParameterDeclaration | undefined,
  ): void => {
    if (!param) return;
    if (ts.isIdentifier(param.name)) dataAliases.add(param.name.text);
    else if (ts.isObjectBindingPattern(param.name)) {
      for (const el of param.name.elements) {
        const key = propName(el.propertyName ?? el.name);
        if (key === "frontmatter" && ts.isIdentifier(el.name))
          fmAliases.add(el.name.text);
      }
    }
  };

  // ---------- pass 1: aliases + string consts (twice, to resolve chains) ----------
  const aliasPass = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = node.initializer;
      const s = stringValue(init, consts);
      if (ts.isIdentifier(node.name) && s !== undefined) {
        // const, or a never-reassigned var/let (best effort: first initializer wins)
        if (!consts.has(node.name.text)) consts.set(node.name.text, s);
      }
      if (ts.isIdentifier(node.name)) {
        if (isDataObj(init)) dataAliases.add(node.name.text);
        else if (isFrontmatterObj(init)) fmAliases.add(node.name.text);
        else if (isFileArray(init)) fileArrayAliases.add(node.name.text);
      } else if (ts.isObjectBindingPattern(node.name) && isDataObj(init)) {
        for (const el of node.name.elements) {
          const key = propName(el.propertyName ?? el.name);
          if (key === "frontmatter" && ts.isIdentifier(el.name))
            fmAliases.add(el.name.text);
        }
      }
    }
    if ((ts.isParameter(node) || ts.isVariableDeclaration(node)) && node.type) {
      const t = node.type.getText(sf);
      if (DATA_TYPE_RE.test(t) && ts.isIdentifier(node.name)) {
        if (/\[\]\s*$|^Array</.test(t)) fileArrayAliases.add(node.name.text);
        else if (!/Props\b/.test(t)) dataAliases.add(node.name.text);
      }
    }
    // allFiles.filter((f) => ...), allFiles.sort((a, b) => ...)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      if (isFileArray(node.expression.expression)) {
        const cb = node.arguments[0];
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          if (ARRAY_METHODS_ITEM_FIRST.has(method)) {
            markParamAsData(cb.parameters[0]);
            if (method === "sort" || method === "toSorted")
              markParamAsData(cb.parameters[1]);
          } else if (method === "reduce") {
            markParamAsData(cb.parameters[1]);
          }
        }
      }
    }
    // for (const f of allFiles)
    if (ts.isForOfStatement(node) && isFileArray(node.expression)) {
      const init = node.initializer;
      if (ts.isVariableDeclarationList(init)) {
        const d = init.declarations[0];
        if (d && ts.isIdentifier(d.name)) dataAliases.add(d.name.text);
      }
    }
    ts.forEachChild(node, aliasPass);
  };
  aliasPass(sf);
  aliasPass(sf);

  // ---------- context helpers ----------
  const hookOf = (node: ts.Node): Phase | undefined => {
    let n: ts.Node | undefined = node.parent;
    let child: ts.Node = node;
    while (n) {
      if (
        (ts.isPropertyAssignment(n) ||
          ts.isMethodDeclaration(n) ||
          ts.isShorthandPropertyAssignment(n)) &&
        n.parent &&
        ts.isObjectLiteralExpression(n.parent)
      ) {
        const name = propName(n.name);
        // skip the key itself
        if (
          name &&
          HOOK_SET.has(name) &&
          child !== n.name &&
          isPluginObject(n.parent)
        ) {
          return name as Phase;
        }
      }
      child = n;
      n = n.parent;
    }
    return undefined;
  };

  const enclosingFns = (node: ts.Node): string[] => {
    const out: string[] = [];
    let n: ts.Node | undefined = node.parent;
    while (n) {
      const name = functionName(n);
      if (name) out.push(name);
      n = n.parent;
    }
    return out;
  };

  const record = (key: string, mode: "read" | "write", at: ts.Node): void => {
    facts.accesses.push({
      key,
      mode,
      line: lineOf(sf, at),
      hook: hookOf(at),
      enclosing: enclosingFns(at),
    });
  };

  /** Determine whether the expression at `node` is written to. */
  const modeOf = (
    node: ts.Node,
  ): {
    mode: "read" | "write";
    sub?: { name: string; mode: "read" | "write" };
  } => {
    const self = climb(node);
    const p = self.parent;
    if (!p) return { mode: "read" };
    if (
      ts.isBinaryExpression(p) &&
      p.left === self &&
      isAssignmentOp(p.operatorToken.kind)
    )
      return { mode: "write" };
    if (ts.isDeleteExpression(p)) return { mode: "write" };
    if (
      (ts.isPostfixUnaryExpression(p) || ts.isPrefixUnaryExpression(p)) &&
      (p.operator === ts.SyntaxKind.PlusPlusToken ||
        p.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      return { mode: "write" };
    }
    if (
      (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) &&
      p.expression === self
    ) {
      const subName = ts.isPropertyAccessExpression(p)
        ? p.name.text
        : ts.isStringLiteral(p.argumentExpression)
          ? p.argumentExpression.text
          : undefined;
      const grand = climb(p).parent;
      if (
        grand &&
        ts.isCallExpression(grand) &&
        grand.expression === climb(p) &&
        subName &&
        MUTATING_METHODS.has(subName)
      ) {
        return { mode: "write" };
      }
      const inner = modeOf(p);
      return {
        mode: inner.mode,
        sub: subName ? { name: subName, mode: inner.mode } : undefined,
      };
    }
    return { mode: "read" };
  };

  // ---------- pass 2: everything else ----------
  const visit = (node: ts.Node): void => {
    // data access: D.key / D["key"]
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteral(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      const parent = climb(node).parent;
      const isMethodCall =
        !!parent &&
        ts.isCallExpression(parent) &&
        parent.expression === climb(node);
      if (
        analyzeData &&
        key &&
        key !== "data" &&
        !isMethodCall &&
        isDataObj(node.expression)
      ) {
        const m = modeOf(node);
        record(key, m.mode, node);
        if (key === "frontmatter" && m.sub) {
          facts.frontmatter.push({
            field: m.sub.name,
            mode: m.sub.mode,
            file,
            line: lineOf(sf, node),
          });
        }
      } else if (
        analyzeData &&
        key &&
        !isMethodCall &&
        ts.isIdentifier(unwrap(node.expression)) &&
        isFrontmatterObj(node.expression)
      ) {
        const m = modeOf(node);
        facts.frontmatter.push({
          field: key,
          mode: m.mode,
          file,
          line: lineOf(sf, node),
        });
        // mutating a frontmatter alias mutates file.data.frontmatter
        if (m.mode === "write") record("frontmatter", "write", node);
      }
    }

    // destructuring reads: const { a, b } = file.data
    if (
      analyzeData &&
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name)
    ) {
      if (isDataObj(node.initializer)) {
        for (const el of node.name.elements) {
          const key = propName(el.propertyName ?? el.name);
          if (key && !el.dotDotDotToken) record(key, "read", el);
        }
      } else if (isFrontmatterObj(node.initializer)) {
        for (const el of node.name.elements) {
          const key = propName(el.propertyName ?? el.name);
          if (key && !el.dotDotDotToken)
            facts.frontmatter.push({
              field: key,
              mode: "read",
              file,
              line: lineOf(sf, el),
            });
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeText = callee.getText(sf);
      // Object.assign(D, {...}) / Object.assign(D.key, ...)
      if (
        analyzeData &&
        calleeText === "Object.assign" &&
        node.arguments.length > 0
      ) {
        const target = unwrap(node.arguments[0]);
        if (isDataObj(target)) {
          for (const arg of node.arguments.slice(1)) {
            const a = unwrap(arg);
            if (ts.isObjectLiteralExpression(a)) {
              for (const p of a.properties) {
                const k = propName(p.name);
                if (k) record(k, "write", p);
              }
            }
          }
        } else if (
          ts.isPropertyAccessExpression(target) &&
          isDataObj(target.expression)
        ) {
          record(target.name.text, "write", target);
        }
      }
      // emitters: write({ ctx, slug, ext, content }) / write(ctx, slug, ext, content)
      const calleeName = ts.isIdentifier(callee) ? callee.text : undefined;
      if (calleeName === "write" && node.arguments.length > 0) {
        const first = unwrap(node.arguments[0]);
        let slugE: ts.Expression | undefined;
        let extE: ts.Expression | undefined;
        if (ts.isObjectLiteralExpression(first)) {
          for (const p of first.properties) {
            const k = propName(p.name);
            const v = ts.isPropertyAssignment(p)
              ? p.initializer
              : ts.isShorthandPropertyAssignment(p)
                ? p.name
                : undefined;
            if (k === "slug") slugE = v;
            if (k === "ext") extE = v;
          }
        } else {
          slugE = node.arguments[1];
          extE = node.arguments[2];
        }
        const fmt = (e: ts.Expression | undefined): string => {
          if (!e) return "";
          const s = stringValue(e, consts);
          if (s !== undefined) return s;
          const t = unwrap(e).getText(sf).replace(/\s+/g, " ");
          return `<${t.length > 40 ? t.slice(0, 37) + "..." : t}>`;
        };
        facts.emits.push({
          path: fmt(slugE) + fmt(extE),
          file,
          line: lineOf(sf, node),
        });
      } else if (
        /(^|\.)(writeFile|writeFileSync)$/.test(calleeText) &&
        node.arguments[0]
      ) {
        const s = stringValue(node.arguments[0], consts);
        const t =
          s ?? `<${unwrap(node.arguments[0]).getText(sf).slice(0, 40)}>`;
        facts.emits.push({ path: t, file, line: lineOf(sf, node) });
      }

      // browser: addEventListener on document/window
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const recv = unwrap(callee.expression).getText(sf);
        const arg0 = stringValue(node.arguments[0], consts);
        if (
          method === "addEventListener" &&
          arg0 &&
          /^(document|window|globalThis)$/.test(recv)
        ) {
          facts.listens.add(`${recv}:${arg0}`);
        }
        if (method === "addCleanup") facts.usesAddCleanup = true;
        if (
          /^(window\.)?(localStorage|sessionStorage)$/.test(recv) &&
          /^(getItem|setItem|removeItem)$/.test(method)
        ) {
          const keyText =
            arg0 ??
            (node.arguments[0] ? `<${node.arguments[0].getText(sf)}>` : "?");
          (recv.endsWith("sessionStorage")
            ? facts.sessionStorage
            : facts.localStorage
          ).add(keyText);
        }
        if (
          /^(querySelector|querySelectorAll|closest|matches)$/.test(method) &&
          arg0
        ) {
          const t = selectorTokens(arg0);
          t.classes.forEach((c) => facts.scriptedClasses.add(c));
          t.ids.forEach((c) => facts.scriptedIds.add(c));
        }
        if (method === "getElementById" && arg0) facts.scriptedIds.add(arg0);
        if (method === "getElementsByClassName" && arg0)
          addClassTokens([arg0], facts.scriptedClasses);
        if (
          tailName(callee.expression) === "classList" &&
          /^(add|toggle|remove|contains|replace)$/.test(method)
        ) {
          const lits: string[] = [];
          node.arguments.forEach((a) => {
            const s = stringValue(a, consts);
            if (s !== undefined) lits.push(s);
          });
          addClassTokens(lits, facts.scriptedClasses);
        }
        // classes.push("internal", ...) on hast className arrays
        if (
          method === "push" &&
          /class/i.test(tailName(callee.expression) ?? "")
        ) {
          const lits: string[] = [];
          node.arguments.forEach((a) => collectStringLiterals(a, lits));
          addClassTokens(lits, facts.renderedClasses);
        }
      } else if (ts.isIdentifier(callee)) {
        if (callee.text === "addCleanup") facts.usesAddCleanup = true;
        // hastscript h("div.foo#bar")
        if ((callee.text === "h" || callee.text === "s") && node.arguments[0]) {
          const s = stringValue(node.arguments[0], consts);
          if (s && /^[a-z][\w-]*[.#]/i.test(s)) {
            const t = selectorTokens(s);
            t.classes.forEach((c) => facts.renderedClasses.add(c));
            t.ids.forEach((c) => facts.renderedIds.add(c));
          }
        }
      }
      if (calleeText === "fetch" && node.arguments[0]) {
        const s = stringValue(node.arguments[0], consts);
        facts.fetches.add(
          s ?? `<${node.arguments[0].getText(sf).slice(0, 60)}>`,
        );
      }
    }

    if (
      ts.isIdentifier(node) &&
      node.text === "fetchData" &&
      !ts.isPropertyAccessExpression(node.parent)
    ) {
      facts.fetches.add("fetchData (contentIndex.json, provided by core)");
    }

    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^(CustomEvent|Event)$/.test(node.expression.text)
    ) {
      const s = stringValue(node.arguments?.[0], consts);
      if (s) facts.dispatches.add(s);
    }

    // class names rendered in TSX
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (
        (name === "class" || name === "className" || name === "id") &&
        node.initializer
      ) {
        const lits: string[] = [];
        collectStringLiterals(node.initializer, lits);
        if (name === "id") addClassTokens(lits, facts.renderedIds);
        else addClassTokens(lits, facts.renderedClasses);
      }
    }

    // hast properties: { className: ["a", "b"] } / { class: "x" }
    if (ts.isPropertyAssignment(node)) {
      const k = propName(node.name);
      if (k === "className" || k === "class") {
        const lits: string[] = [];
        collectStringLiterals(node.initializer, lits);
        addClassTokens(lits, facts.renderedClasses);
      }
      // VirtualPage { slug, title, data: { ... } } → writes
      if (
        analyzeData &&
        k === "data" &&
        ts.isObjectLiteralExpression(node.parent) &&
        hasProp(node.parent, "slug")
      ) {
        const v = unwrap(node.initializer);
        if (ts.isObjectLiteralExpression(v)) {
          for (const p of v.properties) {
            const pk = propName(p.name);
            if (pk) record(pk, "write", p);
          }
        }
      }
    }
    // const classNames = ["callout", type] / let classes = "a b"
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^(class(es|Name|Names|List)?|\w+Class(es|Names?)?)$/.test(
        node.name.text,
      ) &&
      node.initializer
    ) {
      const lits: string[] = [];
      collectStringLiterals(node.initializer, lits);
      addClassTokens(lits, facts.renderedClasses);
    }
    // el.className = "x"
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "className"
    ) {
      const lits: string[] = [];
      collectStringLiterals(node.right, lits);
      addClassTokens(lits, facts.renderedClasses);
    }

    // HTML in string / template literals: class="x"
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const t = node.text;
      if (t.includes("class") || t.includes("id=")) {
        for (const m of t.matchAll(HTML_CLASS_RE))
          addClassTokens([m[1]], facts.renderedClasses);
        for (const m of t.matchAll(HTML_ID_RE)) facts.renderedIds.add(m[1]);
      }
    }

    // hooks: object literal plugin instances
    if (ts.isObjectLiteralExpression(node) && isPluginObject(node)) {
      for (const p of node.properties) {
        const k = propName(p.name);
        if (k && (HOOK_SET.has(k) || PAGE_TYPE_PROPS.has(k)))
          facts.hooks.add(k);
      }
    }
    // Component.css = ..., Component.afterDOMLoaded = ...
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      COMPONENT_STATICS.has(node.left.name.text) &&
      ts.isIdentifier(node.left.expression)
    ) {
      facts.hooks.add(node.left.name.text);
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "init" &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      facts.hooks.add("init");
    }

    // DataMap augmentation
    if (
      ts.isModuleDeclaration(node) &&
      ts.isStringLiteral(node.name) &&
      node.name.text === "vfile" &&
      node.body &&
      ts.isModuleBlock(node.body)
    ) {
      for (const st of node.body.statements) {
        if (ts.isInterfaceDeclaration(st) && st.name.text === "DataMap") {
          for (const m of st.members) {
            if (ts.isPropertySignature(m)) {
              const key = propName(m.name);
              if (key) {
                facts.dataMap.push({
                  key,
                  type: (m.type?.getText(sf) ?? "unknown").replace(/\s+/g, " "),
                  optional: !!m.questionToken,
                  file,
                  line: lineOf(sf, m),
                });
              }
            }
          }
        }
      }
    }

    // identifier references for phase resolution
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const hook = hookOf(node);
      if (hook) {
        let set = facts.refsInHook.get(node.text);
        if (!set) facts.refsInHook.set(node.text, (set = new Set()));
        set.add(hook);
      }
      const fns = enclosingFns(node);
      if (fns[0] && fns[0] !== node.text) {
        let set = facts.refsInFunction.get(fns[0]);
        if (!set) facts.refsInFunction.set(fns[0], (set = new Set()));
        set.add(node.text);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  facts.exports = collectExports(sf);
  return facts;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const p = node.parent;
  if (!p) return false;
  if (
    (ts.isFunctionDeclaration(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isClassDeclaration(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p)) &&
    p.name === node
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertySignature(p)) &&
    p.name === node
  )
    return true;
  return false;
}

function collectExports(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const st of sf.statements) {
    const isExported =
      ts.canHaveModifiers(st) &&
      ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault =
      ts.canHaveModifiers(st) &&
      ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isExportDeclaration(st)) {
      const typeOnly = st.isTypeOnly;
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          if (typeOnly || el.isTypeOnly) continue;
          out.push(el.name.text);
        }
      } else if (
        !st.exportClause &&
        st.moduleSpecifier &&
        ts.isStringLiteral(st.moduleSpecifier)
      ) {
        out.push(`* from ${st.moduleSpecifier.text}`);
      }
    } else if (ts.isExportAssignment(st)) {
      out.push("default");
    } else if (isExported) {
      if (isDefault) out.push("default");
      else if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
        if (st.name) out.push(st.name.text);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations)
          if (ts.isIdentifier(d.name)) out.push(d.name.text);
      }
    }
  }
  return out;
}

/**
 * Resolve the phase(s) of every access across all files of a package by
 * propagating hook membership through named helper functions.
 */
export function resolvePhases(files: FileFacts[]): Map<string, Set<Phase>> {
  const fnPhases = new Map<string, Set<Phase>>();
  const add = (name: string, ph: Iterable<Phase>): boolean => {
    let set = fnPhases.get(name);
    if (!set) fnPhases.set(name, (set = new Set()));
    let changed = false;
    for (const p of ph) {
      if (!set.has(p)) {
        set.add(p);
        changed = true;
      }
    }
    return changed;
  };
  for (const f of files)
    for (const [name, hooks] of f.refsInHook) add(name, hooks);
  const edges: [string, string][] = [];
  for (const f of files)
    for (const [fn, refs] of f.refsInFunction)
      for (const r of refs) edges.push([fn, r]);
  for (let i = 0; i < 10; i++) {
    let changed = false;
    for (const [fn, ref] of edges) {
      const ph = fnPhases.get(fn);
      if (ph && ph.size > 0 && add(ref, ph)) changed = true;
    }
    if (!changed) break;
  }
  return fnPhases;
}

/** Parse class names and ids out of CSS / SCSS source. */
export function analyzeStylesheet(text: string): {
  classes: string[];
  ids: string[];
} {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1")
    .replace(/#\{[^}]*\}/g, "x");
  const classes = new Set<string>();
  const ids = new Set<string>();
  const re = /([^{};]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith("@")) continue;
    // `font: {` nested property blocks (rare) look like `name:`
    if (/^[a-z-]+:\s*$/.test(sel)) continue;
    const t = selectorTokens(sel);
    t.classes.forEach((c) => classes.add(c));
    t.ids.forEach((c) => {
      if (!/^[0-9a-f]{3,8}$/i.test(c)) ids.add(c);
    });
  }
  return { classes: [...classes].sort(), ids: [...ids].sort() };
}
