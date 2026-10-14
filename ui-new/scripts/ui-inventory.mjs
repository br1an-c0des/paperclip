#!/usr/bin/env node
// Generates an inventory of the existing React UI (../ui/src): every route,
// the page component behind it, and every API call each page can make.
// It's the mechanical safety net for the redesign; see docs/inventory/README.md.
//
//   pnpm --filter @paperclipai/ui-new inventory
//
// Output (committed, so `git diff` after an upstream sync shows what changed):
//   docs/inventory/generated/routes.md      route table (streamlined shell)
//   docs/inventory/generated/pages.md       API calls per page
//   docs/inventory/generated/api.md         every API client method and who uses it
//   docs/inventory/generated/inventory.json all of the above, machine-readable
//
// Static analysis only: it follows imports, so it reports calls a page *can*
// make, not calls it makes on every visit.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "@babel/parser";

const REPO = path.resolve(import.meta.dirname, "../..");
const UI_SRC = path.join(REPO, "ui/src");
const OUT_DIR = path.resolve(import.meta.dirname, "../docs/inventory/generated");
const API_DIR = path.join(UI_SRC, "api");

// Wrapper elements that sit around the real route component.
const ELEMENT_WRAPPERS = new Set(["Suspense", "ProductionSurface", "Fragment", "React.Fragment"]);
// HTTP verbs behind the shared client in ui/src/api/client.ts.
const CLIENT_METHODS = {
  get: "GET",
  post: "POST",
  postForm: "POST",
  put: "PUT",
  putRaw: "PUT",
  patch: "PATCH",
  delete: "DELETE",
  deleteWithBody: "DELETE",
};
const SOCKET_CALLEES = new Set(["WebSocket", "EventSource", "tryCreateWebSocket"]);

// ---------------------------------------------------------------- files & AST

function rel(file) {
  return path.relative(UI_SRC, file).split(path.sep).join("/");
}

function listSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|stories)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const astCache = new Map();
function parseFile(file) {
  if (!astCache.has(file)) {
    const code = fs.readFileSync(file, "utf8");
    const ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
    astCache.set(file, { code, ast });
  }
  return astCache.get(file);
}

const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments", "range"]);
function isNode(value) {
  return value && typeof value === "object" && typeof value.type === "string";
}
function childNodes(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

// Collects `const name = init` declarations inside a function body, without
// descending into nested functions. Used to resolve URLs held in variables.
function collectLocals(fnNode) {
  const locals = new Map();
  const params = new Set();
  for (const param of fnNode.params ?? []) {
    const target = param.type === "AssignmentPattern" ? param.left : param;
    if (target.type === "Identifier") params.add(target.name);
  }
  const visit = (node) => {
    if (node !== fnNode && FUNCTION_TYPES.has(node.type)) return;
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) {
      locals.set(node.id.name, node.init);
    }
    for (const child of childNodes(node)) visit(child);
  };
  if (fnNode.body) visit(fnNode.body);
  return { locals, params };
}

// Depth-first walk that tracks parents and function scopes.
function walk(root, visitor) {
  const scopes = [];
  const recurse = (node, parent) => {
    const isFn = FUNCTION_TYPES.has(node.type);
    if (isFn) scopes.push(collectLocals(node));
    visitor(node, parent, scopes);
    for (const child of childNodes(node)) recurse(child, node);
    if (isFn) scopes.pop();
  };
  recurse(root, null);
}

// ------------------------------------------------------------ module resolution

function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(UI_SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  base = base.replace(/\.js$/, "");
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// --------------------------------------------------------------- URL rendering

// Module-level constants and helper functions, for inlining URL builders.
function moduleBindings(ast) {
  const consts = new Map();
  const helpers = new Map();
  for (let stmt of ast.program.body) {
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) stmt = stmt.declaration;
    if (stmt.type === "FunctionDeclaration" && stmt.id) helpers.set(stmt.id.name, stmt);
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations) {
        if (decl.id.type !== "Identifier" || !decl.init) continue;
        const init = unwrapTs(decl.init);
        if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") helpers.set(decl.id.name, init);
        else consts.set(decl.id.name, init);
      }
    }
  }
  return { consts, helpers };
}

function unwrapTs(node) {
  while (
    node &&
    (node.type === "TSAsExpression" ||
      node.type === "TSSatisfiesExpression" ||
      node.type === "TSNonNullExpression" ||
      node.type === "TSTypeAssertion" ||
      node.type === "ParenthesizedExpression")
  ) {
    node = node.expression;
  }
  return node;
}

// Every value a function can return (not descending into nested functions).
function allReturns(fnNode) {
  const body = fnNode.body;
  if (body.type !== "BlockStatement") return [body];
  const found = [];
  const visit = (node) => {
    if (node !== body && FUNCTION_TYPES.has(node.type)) return;
    if (node.type === "ReturnStatement" && node.argument) found.push(node.argument);
    for (const child of childNodes(node)) visit(child);
  };
  visit(body);
  return found;
}

function firstReturn(fnNode) {
  const body = fnNode.body;
  if (body.type !== "BlockStatement") return body;
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (node !== body && FUNCTION_TYPES.has(node.type)) return;
    if (node.type === "ReturnStatement" && node.argument) {
      found = node.argument;
      return;
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(body);
  return found;
}

function lastName(node) {
  node = unwrapTs(node);
  if (!node) return "?";
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    return node.property.type === "Identifier" ? node.property.name : "?";
  }
  if (node.type === "CallExpression" && node.arguments[0]) return lastName(node.arguments[0]);
  return "?";
}

// Renders a URL expression to a path pattern such as /companies/:companyId/issues.
// ctx: { mod, scopes, bindings: Map<string,string>, unwrapUnknownCalls, depth }
function renderUrl(node, ctx) {
  node = unwrapTs(node);
  if (!node || ctx.depth > 12) return ":?";
  const next = { ...ctx, depth: ctx.depth + 1 };
  switch (node.type) {
    case "StringLiteral":
      return node.value;
    case "TemplateLiteral": {
      let out = "";
      node.quasis.forEach((quasi, i) => {
        out += quasi.value.cooked ?? quasi.value.raw;
        if (node.expressions[i]) out += renderUrl(node.expressions[i], next);
      });
      return out;
    }
    case "BinaryExpression":
      if (node.operator === "+") return renderUrl(node.left, next) + renderUrl(node.right, next);
      return ":?";
    case "ConditionalExpression": {
      let a = renderUrl(node.consequent, next);
      let b = renderUrl(node.alternate, next);
      // Branches that differ only in their query string are the same endpoint.
      a = stripQuery(a);
      b = stripQuery(b);
      if (a === b) return a;
      // Two ways of computing the same path parameter.
      if (/^:[^/]*$/.test(a) && /^:[^/]*$/.test(b)) return a;
      if (b === "" || b.startsWith("?") || b.startsWith("&")) return a;
      if (a === "" || a.startsWith("?") || a.startsWith("&")) return b;
      return `{${a}|${b}}`;
    }
    case "LogicalExpression":
      return renderUrl(node.left, next);
    case "Identifier": {
      if (ctx.bindings?.has(node.name)) return ctx.bindings.get(node.name);
      for (let i = ctx.scopes.length - 1; i >= 0; i -= 1) {
        const scope = ctx.scopes[i];
        if (scope.params.has(node.name)) return `:${node.name}`;
        if (scope.locals.has(node.name)) return renderUrl(scope.locals.get(node.name), next);
      }
      if (ctx.mod?.consts.has(node.name)) return renderUrl(ctx.mod.consts.get(node.name), next);
      return `:${node.name}`;
    }
    case "MemberExpression":
    case "OptionalMemberExpression":
      return `:${lastName(node)}`;
    case "CallExpression":
    case "OptionalCallExpression": {
      const callee = unwrapTs(node.callee);
      const calleeName = callee.type === "Identifier" ? callee.name : null;
      if (calleeName && ["encodeURIComponent", "encodeURI", "String"].includes(calleeName)) {
        return node.arguments[0] ? renderUrl(node.arguments[0], next) : ":?";
      }
      const helper = calleeName ? ctx.mod?.helpers.get(calleeName) : null;
      if (helper) {
        const bindings = new Map();
        helper.params.forEach((param, i) => {
          const target = param.type === "AssignmentPattern" ? param.left : param;
          if (target.type !== "Identifier") return;
          const arg = node.arguments[i];
          if (arg) bindings.set(target.name, renderUrl(arg, next));
          else if (param.type === "AssignmentPattern") bindings.set(target.name, renderUrl(param.right, next));
          else bindings.set(target.name, "");
        });
        // A helper with several return branches can produce several URLs.
        const helperCtx = { ...next, bindings, scopes: [collectLocals(helper)] };
        const outs = [...new Set(allReturns(helper).map((ret) => {
          return stripQuery(renderUrl(ret, helperCtx));
        }))];
        if (!outs.length) return ":?";
        // `if (!x) return path; return path + query` collapses to one URL above.
        return outs.length === 1 ? outs[0] : `{${outs.join("|")}}`;
      }
      // `${base}?${params.toString()}` and similar: query strings are dropped later.
      if (callee.type === "MemberExpression" && callee.property.name === "toString") return "";
      if (ctx.unwrapUnknownCalls && node.arguments[0]) return renderUrl(node.arguments[0], next);
      return ":?";
    }
    default:
      return ":?";
  }
}

// Drops a query string, which may start with "?" or (after a runtime
// separator choice) "&". A string that is only a query is left alone.
function stripQuery(s) {
  const i = s.search(/[?&]/);
  return i > 0 ? s.slice(0, i) : s;
}

// Expands "{a|b}" alternatives into separate strings.
function expandAlternatives(p) {
  const start = p.indexOf("{");
  if (start === -1) return [p];
  let depth = 0;
  let end = -1;
  const parts = [];
  let partStart = start + 1;
  for (let i = start; i < p.length; i += 1) {
    if (p[i] === "{") depth += 1;
    else if (p[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        parts.push(p.slice(partStart, i));
        break;
      }
    } else if (p[i] === "|" && depth === 1) {
      parts.push(p.slice(partStart, i));
      partStart = i + 1;
    }
  }
  if (end === -1) return [p];
  const before = p.slice(0, start);
  const after = p.slice(end + 1);
  return parts.flatMap((part) => expandAlternatives(before + part + after));
}

// Raw rendered URL -> one or more normalized paths.
function normalizePaths(raw, { addApiPrefix }) {
  return [...new Set(expandAlternatives(raw).map((one) => {
    let p = stripQuery(one);
    if (addApiPrefix && !p.startsWith("/api") && !p.startsWith(":")) p = `/api${p.startsWith("/") ? "" : "/"}${p}`;
    p = p.replace(/\/{2,}/g, "/").replace(/(.):\?$/, "$1");
    if (p.length > 1) p = p.replace(/\/$/, "");
    return p;
  }))];
}

function methodFromInit(initNode) {
  const init = unwrapTs(initNode);
  if (!init || init.type !== "ObjectExpression") return "GET";
  for (const prop of init.properties) {
    if (prop.type === "ObjectProperty" && (prop.key.name === "method" || prop.key.value === "method")) {
      const value = unwrapTs(prop.value);
      if (value.type === "StringLiteral") return value.value.toUpperCase();
      return "?";
    }
  }
  return "GET";
}

// ------------------------------------------------------------- API modules

// Finds every HTTP request a function body makes: api.<verb>(url), fetch(url,
// init) and requestResponse(url, init), following module-local helper calls.
// Calls to other API methods (issuesApi.list inside issuesApi.listAll) are
// returned as refs and resolved once every module has been read.
function requestsIn(fnNode, mod, seenHelpers = new Set(), topLevel = true) {
  const requests = [];
  const refs = [];
  walk(fnNode, (node, parent, scopes) => {
    if ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
        !((parent?.type === "MemberExpression" || parent?.type === "OptionalMemberExpression") && parent.object === node)) {
      const chain = memberChain(node);
      if (chain && chain.root !== "api") refs.push(chain);
    }
    if (node.type !== "CallExpression") return;
    const callee = unwrapTs(node.callee);
    const ctx = { mod, scopes, depth: 0 };
    if (callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "api") {
      const verb = CLIENT_METHODS[callee.property.name];
      if (verb && node.arguments[0]) {
        for (const p of normalizePaths(renderUrl(node.arguments[0], ctx), { addApiPrefix: true })) requests.push({ method: verb, path: p });
      }
      return;
    }
    if (callee.type === "Identifier" && (callee.name === "fetch" || callee.name === "requestResponse") && node.arguments[0]) {
      const raw = renderUrl(node.arguments[0], ctx);
      const method = methodFromInit(node.arguments[1]);
      for (const p of normalizePaths(raw, { addApiPrefix: callee.name === "requestResponse" })) requests.push({ method, path: p });
      return;
    }
    if (callee.type === "Identifier" && mod.helpers.has(callee.name) && !seenHelpers.has(callee.name)) {
      seenHelpers.add(callee.name);
      const inner = requestsIn(mod.helpers.get(callee.name), mod, seenHelpers, false);
      requests.push(...inner.requests);
      refs.push(...inner.refs);
    }
  });
  // Members that only build a URL (for a link or download) without requesting it.
  if (topLevel && !requests.length && fnNode.type !== "FunctionDeclaration") {
    const ret = unwrapTs(firstReturn(fnNode));
    const stringish = ret && (["TemplateLiteral", "StringLiteral", "BinaryExpression"].includes(ret.type) ||
      (ret.type === "CallExpression" && ret.callee.type === "Identifier" && mod.helpers.has(ret.callee.name)));
    if (stringish) {
      const raw = renderUrl(ret, { mod, scopes: [collectLocals(fnNode)], depth: 0 });
      if (raw.startsWith("/")) {
        for (const p of normalizePaths(raw.slice(Math.max(0, raw.indexOf("/api"))), { addApiPrefix: true })) requests.push({ method: "LINK", path: p });
      }
    }
  }
  return { requests: dedupeRequests(requests), refs };
}

function dedupeRequests(requests) {
  const unique = new Map(requests.map((r) => [`${r.method} ${r.path}`, r]));
  return [...unique.values()];
}

// a.b.c -> { root: "a", path: ["b", "c"] }; null for computed access.
function memberChain(node) {
  const path = [];
  let cur = node;
  while (cur.type === "MemberExpression" || cur.type === "OptionalMemberExpression") {
    if (cur.computed || cur.property.type !== "Identifier") return null;
    path.unshift(cur.property.name);
    cur = cur.object;
  }
  return cur.type === "Identifier" ? { root: cur.name, path } : null;
}

function collectMembers(objectNode, prefix, mod, into) {
  for (const prop of objectNode.properties) {
    if (prop.type !== "ObjectProperty" && prop.type !== "ObjectMethod") continue;
    const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
    if (typeof key !== "string") continue;
    const name = prefix ? `${prefix}.${key}` : key;
    if (prop.type === "ObjectMethod") {
      into.set(name, requestsIn(prop, mod));
      continue;
    }
    const value = unwrapTs(prop.value);
    if (value.type === "ObjectExpression") collectMembers(value, name, mod, into);
    else if (value.type === "ArrowFunctionExpression" || value.type === "FunctionExpression") into.set(name, requestsIn(value, mod));
    else if (value.type === "Identifier" && mod.helpers.has(value.name)) into.set(name, requestsIn(mod.helpers.get(value.name), mod));
    else if (value.type === "MemberExpression") {
      // list: otherApi.list (an alias of another API method)
      const chain = memberChain(value);
      if (chain) into.set(name, { requests: [], refs: [chain] });
    }
  }
}

// api file -> { objects: Map<exportName, Map<member, requests>>, functions: Map<exportName, requests> }
function analyzeApiModules(files) {
  const raw = new Map(); // file -> { objects, functions, imports }, entries are { requests, refs }
  for (const file of files) {
    if (path.dirname(file) !== API_DIR || path.basename(file) === "client.ts") continue;
    const { ast } = parseFile(file);
    const mod = moduleBindings(ast);
    const objects = new Map();
    const functions = new Map();
    const imports = new Map(); // local name -> { file, name }
    for (const stmt of ast.program.body) {
      if (stmt.type === "ImportDeclaration") {
        const target = resolveImport(file, stmt.source.value);
        if (target && path.dirname(target) === API_DIR) {
          for (const spec of stmt.specifiers) {
            if (spec.type === "ImportSpecifier") imports.set(spec.local.name, { file: target, name: spec.imported.name ?? spec.imported.value });
          }
        }
      }
      if (stmt.type !== "ExportNamedDeclaration" || !stmt.declaration) continue;
      const decl = stmt.declaration;
      if (decl.type === "FunctionDeclaration" && decl.id) functions.set(decl.id.name, requestsIn(decl, mod));
      if (decl.type === "VariableDeclaration") {
        for (const d of decl.declarations) {
          if (d.id.type !== "Identifier" || !d.init) continue;
          const init = unwrapTs(d.init);
          if (init.type === "ObjectExpression") {
            const members = new Map();
            collectMembers(init, "", mod, members);
            objects.set(d.id.name, members);
          } else if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
            functions.set(d.id.name, requestsIn(init, mod));
          }
        }
      }
    }
    raw.set(file, { objects, functions, imports });
  }

  // Resolve calls between API methods, e.g. issuesApi.listAll -> issuesApi.list.
  const memo = new Map();
  const resolveEntry = (file, exportName, member, stack = new Set()) => {
    const id = `${file}::${exportName}${member ? `.${member}` : ""}`;
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return [];
    stack.add(id);
    const mod = raw.get(file);
    const entry = member ? mod.objects.get(exportName)?.get(member) : mod.functions.get(exportName);
    if (!entry) return [];
    const requests = [...entry.requests];
    for (const ref of entry.refs) {
      let target = null;
      if (mod.objects.has(ref.root) || mod.functions.has(ref.root)) target = { file, name: ref.root };
      else if (mod.imports.has(ref.root)) target = mod.imports.get(ref.root);
      if (!target || !raw.has(target.file)) continue;
      const targetMod = raw.get(target.file);
      if (targetMod.objects.has(target.name)) {
        const members = targetMod.objects.get(target.name);
        for (let i = ref.path.length; i >= 1; i -= 1) {
          const m = ref.path.slice(0, i).join(".");
          if (members.has(m)) {
            requests.push(...resolveEntry(target.file, target.name, m, stack));
            break;
          }
        }
      } else if (targetMod.functions.has(target.name)) {
        requests.push(...resolveEntry(target.file, target.name, null, stack));
      }
    }
    stack.delete(id);
    const result = dedupeRequests(requests);
    memo.set(id, result);
    return result;
  };

  const modules = new Map();
  for (const [file, mod] of raw) {
    const objects = new Map();
    for (const [exportName, members] of mod.objects) {
      const resolved = new Map();
      for (const member of members.keys()) resolved.set(member, resolveEntry(file, exportName, member));
      if ([...resolved.values()].some((r) => r.length)) objects.set(exportName, resolved);
    }
    const functions = new Map();
    for (const exportName of mod.functions.keys()) {
      const requests = resolveEntry(file, exportName, null);
      if (requests.length) functions.set(exportName, requests);
    }
    modules.set(file, { objects, functions });
  }
  return modules;
}

// --------------------------------------------------------- per-file analysis

function analyzeFile(file, apiModules) {
  const { ast } = parseFile(file);
  const mod = moduleBindings(ast);
  const edges = new Set();
  const apiRoots = new Map(); // local name -> { file, exportName, kind } | { file, namespace: true }
  const uses = new Set(); // "api/file.ts::export.member"
  const direct = []; // { method, path }

  const addEdge = (spec) => {
    const target = resolveImport(file, spec);
    if (target) edges.add(target);
    return target;
  };

  for (const stmt of ast.program.body) {
    if ((stmt.type === "ImportDeclaration" || stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportAllDeclaration") && stmt.source) {
      if (stmt.importKind === "type" || stmt.exportKind === "type") continue;
      const target = addEdge(stmt.source.value);
      const apiMod = target && apiModules.get(target);
      if (!apiMod || stmt.type !== "ImportDeclaration") continue;
      for (const spec of stmt.specifiers) {
        if (spec.importKind === "type") continue;
        if (spec.type === "ImportNamespaceSpecifier") {
          apiRoots.set(spec.local.name, { file: target, namespace: true });
        } else if (spec.type === "ImportSpecifier") {
          const imported = spec.imported.name ?? spec.imported.value;
          if (apiMod.objects.has(imported)) apiRoots.set(spec.local.name, { file: target, exportName: imported, kind: "object" });
          else if (apiMod.functions.has(imported)) apiRoots.set(spec.local.name, { file: target, exportName: imported, kind: "function" });
        }
      }
    }
  }

  const recordObjectUse = (root, exportName, chain) => {
    const members = apiModules.get(root.file).objects.get(exportName);
    for (let i = chain.length; i >= 1; i -= 1) {
      const member = chain.slice(0, i).join(".");
      if (members.has(member)) {
        uses.add(`${rel(root.file)}::${exportName}.${member}`);
        return;
      }
    }
  };

  walk(ast, (node, parent, scopes) => {
    // import("./x") and lazy(() => import("./x"))
    if (node.type === "CallExpression" && node.callee.type === "Import" && node.arguments[0]?.type === "StringLiteral") {
      addEdge(node.arguments[0].value);
    }

    // xApi.member.sub (only the outermost member expression of a chain)
    if ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
        !((parent?.type === "MemberExpression" || parent?.type === "OptionalMemberExpression") && parent.object === node)) {
      const chain = [];
      let cur = node;
      while (cur.type === "MemberExpression" || cur.type === "OptionalMemberExpression") {
        if (cur.computed || cur.property.type !== "Identifier") {
          chain.length = 0;
        } else {
          chain.unshift(cur.property.name);
        }
        cur = cur.object;
      }
      if (cur.type === "Identifier" && apiRoots.has(cur.name)) {
        const root = apiRoots.get(cur.name);
        if (root.namespace) {
          const [exportName, ...rest] = chain;
          const apiMod = apiModules.get(root.file);
          if (apiMod.objects.has(exportName)) recordObjectUse(root, exportName, rest);
          else if (apiMod.functions.has(exportName)) uses.add(`${rel(root.file)}::${exportName}`);
        } else if (root.kind === "object") {
          recordObjectUse(root, root.exportName, chain);
        }
      }
    }

    // Standalone exported API functions, referenced directly.
    if (node.type === "Identifier" && apiRoots.get(node.name)?.kind === "function" &&
        parent?.type !== "ImportSpecifier" && !(parent?.type === "MemberExpression" && parent.property === node && !parent.computed)) {
      const root = apiRoots.get(node.name);
      uses.add(`${rel(root.file)}::${root.exportName}`);
    }

    // Requests made outside ui/src/api: fetch("/api/..."), sockets, event streams.
    if (path.dirname(file) !== API_DIR && (node.type === "CallExpression" || node.type === "NewExpression")) {
      const callee = unwrapTs(node.callee);
      const name = callee.type === "Identifier" ? callee.name : null;
      if (!name || !node.arguments[0]) return;
      const ctx = { mod, scopes, depth: 0, unwrapUnknownCalls: true };
      if (name === "fetch") {
        for (const p of normalizePaths(renderUrl(node.arguments[0], ctx), { addApiPrefix: false })) {
          if (p.startsWith("/api")) direct.push({ method: methodFromInit(node.arguments[1]), path: p });
        }
      } else if (SOCKET_CALLEES.has(name)) {
        for (const p of normalizePaths(renderUrl(node.arguments[0], ctx), { addApiPrefix: false })) {
          if (p.includes("/api")) direct.push({ method: name === "EventSource" ? "SSE" : "WS", path: p.slice(p.indexOf("/api")) });
        }
      }
    }
  });

  const uniqueDirect = new Map(direct.map((d) => [`${d.method} ${d.path}`, d]));
  return { edges: [...edges], uses: [...uses].sort(), direct: [...uniqueDirect.values()] };
}

// ------------------------------------------------------------------- routes

function jsxName(nameNode) {
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXMemberExpression") return `${jsxName(nameNode.object)}.${nameNode.property.name}`;
  return "?";
}

function jsxAttr(element, attrName) {
  return element.openingElement.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === attrName);
}

function analyzeRoutes() {
  const appFile = path.join(UI_SRC, "App.tsx");
  const { ast, code } = parseFile(appFile);
  const src = (node) => code.slice(node.start, node.end).replace(/\s+/g, " ");

  // Component name -> source file, from imports and lazy(() => import("...")).
  const componentFiles = new Map();
  const localFunctions = new Map();
  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") {
      const target = resolveImport(appFile, stmt.source.value);
      for (const spec of stmt.specifiers) if (target) componentFiles.set(spec.local.name, target);
    }
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (decl?.type === "FunctionDeclaration" && decl.id) localFunctions.set(decl.id.name, decl);
    if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.id.type !== "Identifier" || !d.init) continue;
        let importSource = null;
        walk(d.init, (node) => {
          if (node.type === "CallExpression" && node.callee.type === "Import" && node.arguments[0]?.type === "StringLiteral") {
            importSource = node.arguments[0].value;
          }
        });
        if (importSource) {
          const target = resolveImport(appFile, importSource);
          if (target) componentFiles.set(d.id.name, target);
        } else if (["ArrowFunctionExpression", "FunctionExpression"].includes(unwrapTs(d.init).type)) {
          localFunctions.set(d.id.name, unwrapTs(d.init));
        }
      }
    }
  }

  // Imported files a component defined inside App.tsx depends on.
  const localComponentRoots = (name) => {
    const fn = localFunctions.get(name);
    const roots = new Set();
    if (!fn) return [];
    walk(fn, (node) => {
      const id = node.type === "JSXIdentifier" || node.type === "Identifier" ? node.name : null;
      if (id && componentFiles.has(id)) roots.add(componentFiles.get(id));
    });
    return [...roots];
  };

  // An element expression -> variants: { conds, kind, component, redirectTo, gates }
  const analyzeElement = (expr, conds) => {
    expr = unwrapTs(expr);
    if (!expr) return [];
    if (expr.type === "ConditionalExpression") {
      return [
        ...analyzeElement(expr.consequent, [...conds, src(expr.test)]),
        ...analyzeElement(expr.alternate, [...conds, `!(${src(expr.test)})`]),
      ];
    }
    if (expr.type === "LogicalExpression" && expr.operator === "&&") return analyzeElement(expr.right, [...conds, src(expr.left)]);
    if (expr.type === "JSXFragment") {
      const child = expr.children.find((c) => c.type === "JSXElement");
      return child ? analyzeElement(child, conds) : [];
    }
    if (expr.type !== "JSXElement") return [];
    const name = jsxName(expr.openingElement.name);
    const innerElements = expr.children.filter((c) => c.type === "JSXElement");
    const isGate = /Gate$/.test(name);
    if ((ELEMENT_WRAPPERS.has(name) || isGate) && innerElements.length) {
      return analyzeElement(innerElements[0], conds).map((v) => ({ ...v, gates: isGate ? [gateLabel(expr), ...v.gates] : v.gates }));
    }
    if (name === "Navigate") {
      const to = jsxAttr(expr, "to");
      return [{ conds, kind: "redirect", component: name, redirectTo: to ? src(to.value).replace(/^"|"$/g, "") : "?", gates: [] }];
    }
    const kind = /Redirect$/.test(name) ? "redirect" : name === "NotFoundPage" ? "not-found" : "page";
    return [{ conds, kind, component: name, gates: [] }];
  };

  const gateLabel = (element) => {
    const name = jsxName(element.openingElement.name);
    const attrs = element.openingElement.attributes
      .filter((a) => a.type === "JSXAttribute")
      .map((a) => (a.value ? `${a.name.name}=${src(a.value).replace(/^"|"$/g, "")}` : a.name.name));
    return attrs.length ? `${name}(${attrs.join(", ")})` : name;
  };

  const joinPath = (prefix, p) => {
    if (p.startsWith("/")) return p;
    return `${prefix.replace(/\/$/, "")}/${p}`.replace(/\/{2,}/g, "/");
  };

  const rows = [];
  const visitChildren = (children, ctx) => {
    for (const child of children) visitNode(child, ctx);
  };
  const visitNode = (node, ctx) => {
    node = unwrapTs(node);
    if (!node) return;
    if (node.type === "JSXFragment") return visitChildren(node.children, ctx);
    if (node.type === "JSXExpressionContainer") return visitNode(node.expression, ctx);
    if (node.type === "ConditionalExpression") {
      visitNode(node.consequent, { ...ctx, conds: [...ctx.conds, src(node.test)] });
      visitNode(node.alternate, { ...ctx, conds: [...ctx.conds, `!(${src(node.test)})`] });
      return;
    }
    if (node.type === "LogicalExpression" && node.operator === "&&") {
      return visitNode(node.right, { ...ctx, conds: [...ctx.conds, src(node.left)] });
    }
    if (node.type === "CallExpression") {
      const callee = unwrapTs(node.callee);
      // routes.map((tab) => <Route path={`agents/${tab}`} />)
      if (callee.type === "MemberExpression" && callee.property.name === "map" && node.arguments[0]) {
        const fn = node.arguments[0];
        const body = fn.body.type === "BlockStatement" ? firstReturn(fn) : fn.body;
        const param = fn.params[0]?.type === "Identifier" ? fn.params[0].name : "item";
        return visitNode(body, { ...ctx, mapNote: `one route per entry of ${src(callee.object)}`, mapParam: param });
      }
      // boardRoutes(...): inline a local function that returns routes.
      if (callee.type === "Identifier" && localFunctions.has(callee.name)) {
        const ret = firstReturn(localFunctions.get(callee.name));
        return visitNode(ret, ctx);
      }
      return;
    }
    if (node.type !== "JSXElement") return;
    // <Routes>, providers and other wrappers: look inside.
    if (jsxName(node.openingElement.name) !== "Route") return visitChildren(node.children, ctx);

    const pathAttr = jsxAttr(node, "path");
    let routePath = null;
    if (pathAttr) {
      const value = pathAttr.value.type === "JSXExpressionContainer" ? pathAttr.value.expression : pathAttr.value;
      routePath = renderUrl(value, { mod: null, scopes: [], depth: 0 });
    }
    const isIndex = Boolean(jsxAttr(node, "index"));
    const elementAttr = jsxAttr(node, "element");
    const elementExpr = elementAttr?.value?.type === "JSXExpressionContainer" ? elementAttr.value.expression : null;
    const fullPath = routePath !== null ? joinPath(ctx.prefix, routePath) : ctx.prefix || "/";
    const childRoutes = node.children.filter((c) => c.type !== "JSXText");

    if (childRoutes.length) {
      // Layout or gate route: its element wraps everything nested inside.
      const [variant] = elementExpr ? analyzeElementForLayout(elementExpr) : [null];
      const gates = variant?.gate ? [...ctx.gates, variant.gate] : ctx.gates;
      const layouts = variant?.layout ? [...ctx.layouts, variant.layout] : ctx.layouts;
      visitChildren(node.children, { ...ctx, prefix: fullPath, gates, layouts });
      return;
    }
    rows.push({
      path: isIndex ? `${fullPath} (index)` : fullPath,
      conds: ctx.conds,
      gates: ctx.gates,
      layouts: ctx.layouts,
      note: ctx.mapNote ?? null,
      variants: elementExpr ? analyzeElement(elementExpr, []) : [],
    });
  };

  // For layout routes, pick the "loaded" branch of loading ternaries.
  const analyzeElementForLayout = (expr) => {
    expr = unwrapTs(expr);
    if (expr.type === "ConditionalExpression") {
      const test = src(expr.test);
      // streamlinedUiEnabled ? <Layout/> : <ProductionLayout/>: document the streamlined shell.
      return analyzeElementForLayout(expr.consequent).map((v) => ({ ...v, cond: test }));
    }
    if (expr.type !== "JSXElement") return [{}];
    const name = jsxName(expr.openingElement.name);
    if (/Gate$/.test(name)) return [{ gate: gateLabel(expr) }];
    return [{ layout: name }];
  };

  visitNode(firstReturn(localFunctions.get("App")), { prefix: "", conds: [], gates: [], layouts: [] });

  for (const row of rows) {
    for (const variant of row.variants) {
      if (variant.kind === "redirect" || variant.kind === "not-found") continue;
      if (componentFiles.has(variant.component)) variant.file = componentFiles.get(variant.component);
      else if (localFunctions.has(variant.component)) {
        variant.file = appFile;
        variant.localRoots = localComponentRoots(variant.component);
      }
    }
  }
  return rows;
}

// A route row is part of the streamlined shell unless a condition excludes it.
function streamlinedOnly(conds) {
  return conds.every((c) => !/^!\(\s*(streamlinedUiEnabled|streamlinedUiLoaded)\s*\)$/.test(c));
}
function productionOnly(conds) {
  return conds.some((c) => /^!\(\s*streamlinedUiEnabled\s*\)$/.test(c));
}

// --------------------------------------------------------------------- main

function main() {
  const files = listSourceFiles(UI_SRC);
  const apiModules = analyzeApiModules(files);

  const fileInfo = new Map();
  for (const file of files) fileInfo.set(file, analyzeFile(file, apiModules));

  const reachable = (roots) => {
    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file) || !fileInfo.has(file)) continue;
      seen.add(file);
      for (const edge of fileInfo.get(file).edges) stack.push(edge);
    }
    return seen;
  };

  // Request lookup: "api/x.ts::export.member" -> requests
  const requestsFor = new Map();
  for (const [file, mod] of apiModules) {
    for (const [exportName, members] of mod.objects) {
      for (const [member, requests] of members) requestsFor.set(`${rel(file)}::${exportName}.${member}`, requests);
    }
    for (const [exportName, requests] of mod.functions) requestsFor.set(`${rel(file)}::${exportName}`, requests);
  }

  // ---- routes and pages (streamlined shell)
  const routeRows = analyzeRoutes();
  const appFile = path.join(UI_SRC, "App.tsx");
  const pages = new Map(); // key -> { name, file, roots, routes: [], conds }
  for (const row of routeRows) {
    if (!streamlinedOnly(row.conds)) continue;
    for (const variant of row.variants) {
      if (variant.kind !== "page" || !variant.file || !streamlinedOnly(variant.conds)) continue;
      const key = variant.file === appFile ? `App.tsx#${variant.component}` : rel(variant.file);
      if (!pages.has(key)) {
        pages.set(key, {
          key,
          components: new Set(),
          file: variant.file,
          roots: variant.file === appFile ? variant.localRoots : [variant.file],
          routes: [],
        });
      }
      const page = pages.get(key);
      page.components.add(variant.component);
      page.routes.push({ path: row.path, flags: [...row.conds, ...variant.conds], gates: [...row.gates, ...variant.gates] });
    }
  }

  // App shell: the streamlined Layout (sidebar, dialogs, command palette, live updates).
  // main.tsx is included through its own imports minus App.tsx, which imports every page.
  const mainFile = path.join(UI_SRC, "main.tsx");
  const shellRoots = [
    path.join(UI_SRC, "components/Layout.tsx"),
    ...(fileInfo.get(mainFile)?.edges ?? []).filter((f) => f !== appFile),
  ].filter((f) => fileInfo.has(f));
  const shellFiles = reachable(shellRoots);

  const pageReach = new Map();
  for (const page of pages.values()) {
    page.reach = reachable(page.roots);
    for (const file of page.reach) pageReach.set(file, (pageReach.get(file) ?? 0) + 1);
  }

  // Calls a set of files can make: "export.member" -> { requests, via: [files] }
  const callsFor = (fileSet, exclude = new Set()) => {
    const calls = new Map();
    for (const file of [...fileSet].sort()) {
      if (exclude.has(file)) continue;
      const info = fileInfo.get(file);
      for (const use of info.uses) {
        if (!calls.has(use)) calls.set(use, { key: use, requests: requestsFor.get(use) ?? [], via: [] });
        calls.get(use).via.push(rel(file));
      }
      for (const d of info.direct) {
        const key = `direct::${d.method} ${d.path}`;
        if (!calls.has(key)) calls.set(key, { key, requests: [d], via: [] });
        calls.get(key).via.push(rel(file));
      }
    }
    return calls;
  };

  const shellCalls = callsFor(shellFiles);
  for (const page of pages.values()) {
    page.calls = callsFor(page.reach, shellFiles);
  }

  // ---- reverse index
  const usedBy = new Map(); // call key -> Set(page keys | "App shell")
  for (const [key] of shellCalls) usedBy.set(key, new Set(["App shell"]));
  for (const page of pages.values()) {
    for (const [key] of page.calls) {
      if (!usedBy.has(key)) usedBy.set(key, new Set());
      usedBy.get(key).add(page.key);
    }
  }
  const anyUse = new Set();
  for (const info of fileInfo.values()) for (const use of info.uses) anyUse.add(use);

  const commit = upstreamCommit();
  writeOutputs({ routeRows, pages, shellCalls, shellFiles, requestsFor, usedBy, anyUse, apiModules, commit, appFile });
}

function upstreamCommit() {
  for (const ref of ["upstream/master", "origin/master"]) {
    try {
      return execFileSync("git", ["merge-base", "HEAD", ref], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      // try the next ref
    }
  }
  return "unknown";
}

// ------------------------------------------------------------------ output

function fmtRequests(requests) {
  if (!requests.length) return "(no request found)";
  return requests.map((r) => `\`${r.method} ${r.path.replace(/\|/g, "\\|")}\``).join(", ");
}

function callLabel(key) {
  if (key.startsWith("direct::")) return "direct request";
  const [file, member] = key.split("::");
  return `\`${member}\` (${file})`;
}

function area(routePath) {
  const parts = routePath.replace(/ \(index\)$/, "").split("/").filter(Boolean);
  if (parts[0] === ":companyPrefix") {
    if (!parts[1]) return "(company root)";
    if (parts[1] === "*" || parts[1] === ":pluginRoutePath") return "(catch-all)";
    return parts[1];
  }
  return "(outside a company)";
}

// Gates applied around every board route; noted once instead of on every row.
const GLOBAL_GATES = new Set(["CloudAccessGate", "CloudAccessGate(allowMembershipRequest)"]);

function writeOutputs({ routeRows, pages, shellCalls, shellFiles, requestsFor, usedBy, anyUse, apiModules, commit, appFile }) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const header = (title) =>
    `# ${title}\n\nGenerated by \`ui-new/scripts/ui-inventory.mjs\` from \`ui/src\` at upstream commit \`${commit}\`. Do not edit by hand.\n\n`;

  // routes.md
  const streamlinedRows = routeRows.filter((r) => streamlinedOnly(r.conds) && r.variants.some((v) => streamlinedOnly(v.conds)));
  const productionRows = routeRows.filter((r) => productionOnly(r.conds) || r.variants.some((v) => productionOnly(v.conds)));
  const isRedirectRow = (row) => row.variants.filter((v) => streamlinedOnly(v.conds)).every((v) => v.kind !== "page");
  let routesMd = header("Routes");
  routesMd += "Routes of the streamlined shell (the default). Company pages sit under `/:companyPrefix`, shown as `/:co`. ";
  routesMd += "Every company page is behind `CloudAccessGate`, so it isn't repeated per row.\n\n";
  routesMd += "- **Flags** are conditions in `App.tsx`, mostly instance or experimental settings.\n";
  routesMd += "- **Gates** are wrapper components that can hide a route, e.g. `HiddenSettingsPageGate` or an experimental gate.\n\n";
  const short = (p) => p.replace(/^\/:companyPrefix/, "/:co");
  const describeVariant = (v) => {
    const cond = v.conds.length ? ` _(if ${v.conds.join(" && ")})_` : "";
    if (v.kind === "redirect") return `↪ ${v.redirectTo ? `\`${v.redirectTo}\`` : v.component}${cond}`;
    if (v.kind === "not-found") return `not found${cond}`;
    const file = v.file ? (v.file === appFile ? `App.tsx#${v.component}` : rel(v.file)) : "?";
    return `**${v.component}** \`${file}\`${cond}`;
  };
  const conditionsOf = (row, variants) => [
    ...row.conds.map((c) => `flag \`${c}\``),
    ...[...row.gates, ...variants.flatMap((v) => v.gates)].filter((g) => !GLOBAL_GATES.has(g)).map((g) => `gate \`${g}\``),
    ...(row.note ? [row.note] : []),
  ];
  const byArea = new Map();
  for (const row of streamlinedRows.filter((r) => !isRedirectRow(r))) {
    const a = area(row.path);
    if (!byArea.has(a)) byArea.set(a, []);
    byArea.get(a).push(row);
  }
  const areaOrder = ([x], [y]) => {
    const rank = (a) => (a.startsWith("(") ? 1 : 0);
    return rank(x) - rank(y) || x.localeCompare(y);
  };
  routesMd += "## Pages\n\n";
  for (const [a, rows] of [...byArea].sort(areaOrder)) {
    routesMd += `### ${a}\n\n| Path | Renders | Conditions |\n| --- | --- | --- |\n`;
    for (const row of rows) {
      const variants = row.variants.filter((v) => streamlinedOnly(v.conds));
      routesMd += `| \`${short(row.path)}\` | ${variants.map(describeVariant).join("<br>")} | ${conditionsOf(row, variants).join("<br>")} |\n`;
    }
    routesMd += "\n";
  }
  routesMd += "## Redirects and aliases\n\nOld URLs, unprefixed shortcuts and aliases that only forward elsewhere.\n\n";
  routesMd += "| Path | Goes to | Conditions |\n| --- | --- | --- |\n";
  for (const row of streamlinedRows.filter(isRedirectRow)) {
    const variants = row.variants.filter((v) => streamlinedOnly(v.conds));
    routesMd += `| \`${short(row.path)}\` | ${variants.map(describeVariant).join("<br>")} | ${conditionsOf(row, variants).join("<br>")} |\n`;
  }
  routesMd += "\n## Production shell only\n\nRendered only when the streamlined UI is turned off. Listed for completeness; not analyzed in pages.md.\n\n";
  routesMd += "| Path | Renders |\n| --- | --- |\n";
  for (const row of productionRows) {
    const variants = row.variants.filter((v) => productionOnly([...row.conds, ...v.conds]));
    if (variants.length) routesMd += `| \`${short(row.path)}\` | ${variants.map(describeVariant).join("<br>")} |\n`;
  }
  fs.writeFileSync(path.join(OUT_DIR, "routes.md"), routesMd);

  // pages.md
  const pageList = [...pages.values()].sort((a, b) => {
    const areaCmp = area(a.routes[0].path).localeCompare(area(b.routes[0].path));
    return areaCmp || a.key.localeCompare(b.key);
  });
  const renderCalls = (calls) => {
    let out = "";
    const sorted = [...calls.values()].sort((a, b) => {
      const ra = a.requests[0] ? `${a.requests[0].path} ${a.requests[0].method}` : a.key;
      const rb = b.requests[0] ? `${b.requests[0].path} ${b.requests[0].method}` : b.key;
      return ra.localeCompare(rb);
    });
    for (const call of sorted) {
      const via = call.via.length > 3 ? `${call.via.slice(0, 3).join(", ")} +${call.via.length - 3} more` : call.via.join(", ");
      out += `- ${fmtRequests(call.requests)}: ${callLabel(call.key)}, via ${via}\n`;
    }
    return out;
  };
  let pagesMd = header("API calls by page");
  pagesMd += "Every API request a page's code can reach through its imports. Calls that the app shell (sidebar, dialogs, command palette, live updates) also makes are listed once under **App shell**, not repeated for every page.\n\n";
  pagesMd += "## App shell\n\n";
  pagesMd += `Reachable from \`components/Layout.tsx\` and \`main.tsx\` (${shellFiles.size} files). Available on every page.\n\n`;
  pagesMd += renderCalls(shellCalls) + "\n";
  let currentArea = null;
  for (const page of pageList) {
    const a = area(page.routes[0].path);
    if (a !== currentArea) {
      pagesMd += `## ${a}\n\n`;
      currentArea = a;
    }
    pagesMd += `### ${[...page.components].join(", ")} (\`${page.key}\`)\n\n`;
    pagesMd += `Routes: ${[...new Set(page.routes.map((r) => short(r.path)))].map((p) => `\`${p}\``).join(", ")}\n\n`;
    const flags = [...new Set(page.routes.flatMap((r) => [...r.flags.map((f) => `flag \`${f}\``), ...r.gates.filter((g) => !GLOBAL_GATES.has(g)).map((g) => `gate \`${g}\``)]))];
    if (flags.length) pagesMd += `Conditions: ${flags.join("; ")}\n\n`;
    pagesMd += page.calls.size ? `${page.calls.size} page-specific calls:\n\n${renderCalls(page.calls)}\n` : "No page-specific API calls.\n\n";
  }
  fs.writeFileSync(path.join(OUT_DIR, "pages.md"), pagesMd);

  // api.md
  let apiMd = header("API client methods");
  apiMd += "Every method in `ui/src/api/` with the request(s) it makes and the pages that reach it. **Unused** means no file in `ui/src` references it.\n\n";
  for (const [file, mod] of [...apiModules].sort(([a], [b]) => a.localeCompare(b))) {
    const entries = [];
    for (const [exportName, members] of mod.objects) for (const [member] of members) entries.push(`${exportName}.${member}`);
    for (const [exportName] of mod.functions) entries.push(exportName);
    if (!entries.length) continue;
    apiMd += `## ${rel(file)}\n\n| Method | Request | Used by |\n| --- | --- | --- |\n`;
    for (const entry of entries.sort()) {
      const key = `${rel(file)}::${entry}`;
      const users = [...(usedBy.get(key) ?? [])].sort();
      const used = users.length ? users.join(", ") : anyUse.has(key) ? "(only outside routed pages)" : "**unused**";
      apiMd += `| \`${entry}\` | ${fmtRequests(requestsFor.get(key) ?? [])} | ${used} |\n`;
    }
    apiMd += "\n";
  }
  const directKeys = [...usedBy.keys()].filter((k) => k.startsWith("direct::")).sort();
  if (directKeys.length) {
    apiMd += "## Direct requests outside ui/src/api\n\n| Request | Used by |\n| --- | --- |\n";
    for (const key of directKeys) apiMd += `| \`${key.slice(8)}\` | ${[...usedBy.get(key)].sort().join(", ")} |\n`;
  }
  fs.writeFileSync(path.join(OUT_DIR, "api.md"), apiMd);

  // inventory.json
  const json = {
    upstreamCommit: commit,
    routes: routeRows.map((r) => ({
      path: r.path,
      flags: r.conds,
      gates: r.gates,
      note: r.note,
      variants: r.variants.map((v) => ({
        kind: v.kind,
        component: v.component,
        file: v.file ? (v.file === appFile ? `App.tsx#${v.component}` : rel(v.file)) : null,
        redirectTo: v.redirectTo ?? null,
        flags: v.conds,
        gates: v.gates,
      })),
    })),
    shell: { calls: [...shellCalls.values()].map(({ key, requests, via }) => ({ key, requests, via })) },
    pages: pageList.map((p) => ({
      key: p.key,
      components: [...p.components],
      routes: p.routes,
      calls: [...p.calls.values()].map(({ key, requests, via }) => ({ key, requests, via })),
    })),
    api: Object.fromEntries(
      [...requestsFor].sort(([a], [b]) => a.localeCompare(b)).map(([key, requests]) => [
        key,
        { requests, usedBy: [...(usedBy.get(key) ?? [])].sort(), referenced: anyUse.has(key) },
      ]),
    ),
  };
  fs.writeFileSync(path.join(OUT_DIR, "inventory.json"), `${JSON.stringify(json, null, 2)}\n`);

  const methodCount = requestsFor.size;
  const unused = [...requestsFor.keys()].filter((k) => !anyUse.has(k)).length;
  console.log(`routes: ${routeRows.length} (${streamlinedRows.length} streamlined) | pages: ${pages.size} | api methods: ${methodCount} (${unused} unused) | shell files: ${shellFiles.size}`);
  console.log(`wrote ${path.relative(REPO, OUT_DIR)}/{routes.md,pages.md,api.md,inventory.json}`);
}

main();
