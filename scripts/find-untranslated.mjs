// Lists user-visible English text in the UI that isn't passed through t()/msg().
// Uses the TypeScript parser: JSX text nodes and string-literal JSX attributes such as
// aria-label/placeholder/title. Run: node scripts/find-untranslated.mjs  (exit 1 if any)
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ATTRS = new Set(["aria-label", "placeholder", "title", "alt", "label", "description", "hint"]);
// brand names, keyboard keys and symbols that are the same in every language
const ALLOW = new Set(["PlanMind", "N", "Esc", "AM", "PM", "UTC", "?", "/", "English", "https://…"]);
const SKIP_FILES = new Set(["src/app/layout.tsx"]); // server setup page shown only to the developer

// key names, HTTP bits and other code identifiers that look like words but aren't UI text
const CODE_WORDS = new Set(["Escape", "Enter", "Tab", "ArrowLeft", "ArrowRight", "Content-Type", "POST", "GET", "PUT", "PATCH", "DELETE", "Notification"]);

function looksLikeProse(text) {
  const s = text.trim();
  if (!s || CODE_WORDS.has(s) || ALLOW.has(s)) return false;
  // starts with a capitalized word ("Couldn't save", "Done", "Moved “…”") — class names and keys start lowercase
  return /^[“"(]?[A-Z][a-z'’]+(\s|[,.!?:…“”]|$)/.test(s) || /^[a-z]+ [a-z]+ [a-z]+/.test(s) && !/[-:[\]/]/.test(s);
}

function insideAllowedCall(node) {
  for (let c = node, p = node.parent; p; c = p, p = p.parent) {
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && ["t", "msg", "translate", "cx", "fetch", "api"].includes(p.expression.text)) return true;
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ["t", "includes", "startsWith", "get", "set", "getItem", "setItem", "removeItem"].includes(p.expression.name.text)) return true;
    if (ts.isJsxAttribute(p) && ["className", "href", "id", "role", "type", "data-cat", "key", "htmlFor"].includes(p.name.getText())) return true;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) return true;
    if (ts.isCaseClause(p) && p.expression === c) return true;
    // "literal".method(...) — the string itself is the receiver
    if (ts.isPropertyAccessExpression(p) && p.expression === c && c === node) return true;
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) break;
  }
  return false;
}

function isTypeOrImport(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isTypeNode(p) || ts.isExportDeclaration(p)) return true;
  }
  return false;
}

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

export function findUntranslated() {
  const out = [];
  for (const file of [...files(join(root, "src/components")), ...files(join(root, "src/app"))]) {
    const rel = relative(root, file).replaceAll("\\", "/");
    if (SKIP_FILES.has(rel)) continue;
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        const text = node.getText().replace(/\s+/g, " ").trim();
        if (/[A-Za-z]{2,}/.test(text) && !ALLOW.has(text)) out.push(`${rel}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}  text: ${text}`);
      } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const name = node.name.getText();
        const text = node.initializer.text;
        if (ATTRS.has(name) && /[A-Za-z]{2,}/.test(text) && !ALLOW.has(text)) out.push(`${rel}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}  ${name}="${text}"`);
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
        // sentence-like strings in code (toasts, conditional labels, template messages)
        const text = ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("…") : node.text;
        if (looksLikeProse(text) && !insideAllowedCall(node) && !isTypeOrImport(node)) {
          out.push(`${rel}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}  code: ${text}`);
        }
        return; // don't descend into template spans
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = findUntranslated();
  console.log(found.join("\n") || "none");
  console.log(`\n${found.length} untranslated`);
  process.exit(found.length ? 1 : 0);
}
