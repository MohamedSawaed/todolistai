// Collects every translation key used in the app: string literals passed to t(), msg(),
// someObject.t() and translate(locale, …). Run: node scripts/i18n-keys.mjs
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL("..", import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

/** String literals that can be the value of `node` (through ?:, ||, ?? and parentheses). */
function literals(node, out) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isConditionalExpression(node)) (literals(node.whenTrue, out), literals(node.whenFalse, out));
  else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) (literals(node.left, out), literals(node.right, out));
  else if (ts.isParenthesizedExpression(node)) literals(node.expression, out);
}

export function extractKeys() {
  const keys = new Map(); // key -> first location
  for (const file of files(join(root, "src"))) {
    if (file.includes(`${"locales"}`) && !file.endsWith("known-messages.ts")) continue;
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        const arg = name === "t" || name === "msg" ? node.arguments[0] : name === "translate" ? node.arguments[1] : undefined;
        if (arg) {
          const found = [];
          literals(arg, found);
          for (const k of found) if (!keys.has(k)) keys.set(k, `${file.slice(root.length)}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return keys;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const keys = extractKeys();
  for (const k of [...keys.keys()].sort()) console.log(JSON.stringify(k));
  console.error(`${keys.size} keys`);
}
