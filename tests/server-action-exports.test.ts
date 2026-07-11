import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

for (const filePath of sourceFiles("src")) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  if (!/^\s*["']use server["'];/.test(sourceText)) continue;

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  for (const statement of sourceFile.statements) {
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    const isExported = modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) continue;

    if (
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement)
    ) {
      continue;
    }

    if (ts.isFunctionDeclaration(statement)) {
      const isAsync = modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
      );
      assert.ok(
        isAsync,
        `${filePath} exports a non-async function from a file-level use server module.`,
      );
      continue;
    }

    assert.fail(
      `${filePath} exports a non-async runtime value from a file-level use server module.`,
    );
  }
}

console.log("Server Action export contract test passed.");
