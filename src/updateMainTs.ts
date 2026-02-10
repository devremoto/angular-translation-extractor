import * as fs from "node:fs/promises";
import * as path from "node:path";

export type UpdateMainTsResult = {
    updated: boolean;
    reason: string;
    mainTsPath: string;
};

export async function updateMainTs(opts: {
    workspaceRoot: string;
    srcDir: string;
    mainTsPath: string;
    baseLocaleCode: string;
    bootstrapStyle: "standalone" | "module";
    updateMode: "merge" | "overwrite" | "recreate";
    outputRoot: string;
}): Promise<UpdateMainTsResult> {
    const { workspaceRoot, srcDir, mainTsPath, baseLocaleCode, bootstrapStyle, updateMode, outputRoot } = opts;

    // Convert outputRoot to relative path for use in loader (e.g., "src/assets/I18n" -> "./assets/I18n/")
    const outputRootRelative = `./${outputRoot.replace(/^src\//, "")}/`.replace(/\/\/+/g, "/");

    const resolvedRel = mainTsPath.replace("{srcDir}", srcDir);
    const abs = path.isAbsolute(resolvedRel) ? resolvedRel : path.join(workspaceRoot, resolvedRel);

    let content: string;
    let original: string;
    try {
        content = await fs.readFile(abs, "utf8");
        original = content;
    } catch (err) {
        return { updated: false, reason: "main.ts not found", mainTsPath: abs };
    }

    const hasImportProvidersFrom = content.includes("importProvidersFrom");
    const hasTranslateModule = /importProvidersFrom\s*\(\s*TranslateModule\.forRoot/.test(content);

    // Remove existing TranslateModule configurations to ensure fresh setup
    if (hasTranslateModule) {
        content = removeExistingTranslateModuleConfig(content);
    }

    const importLines = new Set<string>();
    if (!content.includes("@angular/common/http")) {
        importLines.add('import { HttpClient } from "@angular/common/http";');
    }
    if (!content.includes("@ngx-translate/core")) {
        importLines.add('import { TranslateLoader, TranslateModule } from "@ngx-translate/core";');
    }
    // Only add importProvidersFrom import if it's not already present
    if (!hasImportProvidersFrom) {
        importLines.add('import { importProvidersFrom } from "@angular/core";');
    }
    if (!content.includes("./translate/tg-translate-loader")) {
        importLines.add('import { TgTranslationLoader } from "./translate/tg-translate-loader";');
    }

    if (importLines.size) {
        const insertAt = findLastImportIndex(content) + 1;
        content = insertAt >= 0
            ? content.slice(0, insertAt) + Array.from(importLines).join("\n") + "\n" + content.slice(insertAt)
            : Array.from(importLines).join("\n") + "\n" + content;
    }

    content = upsertHttpLoaderFactory(content, outputRootRelative);

    const providerExpr = `importProvidersFrom(TranslateModule.forRoot({\n        defaultLanguage: "${baseLocaleCode}",\n        loader: {\n          provide: TranslateLoader,\n          useFactory: HttpLoaderFactory,\n          deps: [HttpClient]\n        }\n      }))`;

    let bootstrapUpdated = false;
    if (bootstrapStyle === "standalone") {
        const updated = updateBootstrapApplication(content, providerExpr);
        if (updated) {
            content = updated;
            bootstrapUpdated = true;
        }
    } else {
        const updated = updateBootstrapModule(content, providerExpr);
        if (updated) {
            content = updated;
            bootstrapUpdated = true;
        }
    }

    // Check if anything changed (imports, factory, or bootstrap config)
    const hasChanges = content !== original;

    if (!hasChanges) {
        return { updated: false, reason: "no changes needed - main.ts already configured", mainTsPath: abs };
    }

    try {
        await fs.writeFile(abs, content, "utf8");
        const reason = bootstrapUpdated
            ? "updated with full translation configuration"
            : "updated with imports and loader factory (bootstrap config may need manual update)";
        return { updated: true, reason, mainTsPath: abs };
    } catch (err) {
        return { updated: false, reason: `failed to write file: ${err}`, mainTsPath: abs };
    }
}

function upsertHttpLoaderFactory(content: string, outputRootRelative: string): string {
    // Match the entire HttpLoaderFactory function - more flexible to catch all variants
    // Matches: export function HttpLoaderFactory(...) [: ReturnType] { ... }
    const factoryRegex = /export\s+function\s+HttpLoaderFactory\s*\([^)]*\)(?:\s*:\s*\w+)?\s*\{(?:[^{}]|\{[^}]*\})*?\}\s*\n*/g;
    const factoryBody = `export function HttpLoaderFactory(http: HttpClient): TranslateLoader {\n  return new TgTranslationLoader(http, "${outputRootRelative}");\n}\n`;

    // Remove all existing HttpLoaderFactory functions to avoid duplicates
    content = content.replace(factoryRegex, '');

    // Find the last import statement to insert the factory after imports
    const lastImportIndex = findLastImportIndex(content);

    if (lastImportIndex >= 0) {
        // Insert after imports
        return content.slice(0, lastImportIndex) + `\n${factoryBody}\n` + content.slice(lastImportIndex);
    }

    // If no imports found, prepend to file
    return factoryBody + '\n' + content;
}

function findLastImportIndex(content: string): number {
    const importRegex = /^import .*;\s*$/gm;
    let match: RegExpExecArray | null;
    let lastIndex = -1;
    while ((match = importRegex.exec(content))) {
        lastIndex = match.index + match[0].length + 1;
    }
    return lastIndex;
}

function updateBootstrapApplication(content: string, providerExpr: string): string | null {
    const call = findCall(content, "bootstrapApplication");
    if (!call) {
        return null;
    }

    const { full, args, start, end } = call;
    const parts = splitTopLevelArgs(args);
    const appArg = parts[0] ?? "AppComponent";
    const configArg = parts[1];

    let newArgs: string;
    if (!configArg) {
        newArgs = `${appArg}, {\n  providers: [${providerExpr}]\n}`;
    } else if (configArg.trim().startsWith("{")) {
        newArgs = `${appArg}, ${injectProvidersIntoObject(configArg, providerExpr)}`;
    } else {
        const configVar = configArg.trim();
        if (!content.includes("angularTranslationConfig")) {
            const configSnippet = `\nconst angularTranslationConfig = {\n  ...${configVar},\n  providers: [\n    ...(${configVar}.providers ?? []),\n    ${providerExpr}\n  ]\n};\n`;
            content = content.slice(0, end + 1) + configSnippet + content.slice(end + 1);
        }
        newArgs = `${appArg}, angularTranslationConfig`;
    }

    const updatedCall = `bootstrapApplication(${newArgs})`;
    return content.slice(0, start) + updatedCall + content.slice(end + 1);
}

function updateBootstrapModule(content: string, providerExpr: string): string | null {
    const call = findCall(content, "bootstrapModule");
    if (!call) {
        return null;
    }

    const { args, start, end } = call;
    const parts = splitTopLevelArgs(args);
    const moduleArg = parts[0] ?? "AppModule";
    const configArg = parts[1];

    let newArgs: string;
    if (!configArg) {
        newArgs = `${moduleArg}, {\n  providers: [${providerExpr}]\n}`;
    } else if (configArg.trim().startsWith("{")) {
        newArgs = `${moduleArg}, ${injectProvidersIntoObject(configArg, providerExpr)}`;
    } else {
        const configVar = configArg.trim();
        if (!content.includes("angularTranslationConfig")) {
            const configSnippet = `\nconst angularTranslationConfig = {\n  ...${configVar},\n  providers: [\n    ...(${configVar}.providers ?? []),\n    ${providerExpr}\n  ]\n};\n`;
            content = content.slice(0, end + 1) + configSnippet + content.slice(end + 1);
        }
        newArgs = `${moduleArg}, angularTranslationConfig`;
    }

    const updatedCall = `bootstrapModule(${newArgs})`;
    return content.slice(0, start) + updatedCall + content.slice(end + 1);
}

function findCall(content: string, name: string): { full: string; args: string; start: number; end: number } | null {
    // Allow for whitespace before the open paren: bootstrapApplication (
    const callPattern = new RegExp(`\\b${name}\\s*\\(`, 'i');
    const match = callPattern.exec(content);

    if (!match) {
        return null;
    }

    const idx = match.index;
    const openParenPos = idx + match[0].lastIndexOf('(');
    const startArgs = openParenPos + 1;

    let depth = 0;
    for (let i = startArgs; i < content.length; i++) {
        const ch = content[i];
        if (ch === "(") depth++;
        if (ch === ")") {
            if (depth === 0) {
                const full = content.slice(idx, i + 1);
                const args = content.slice(startArgs, i);
                return { full, args, start: idx, end: i };
            }
            depth--;
        }
    }


    return null;
}

function splitTopLevelArgs(args: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let current = "";
    for (let i = 0; i < args.length; i++) {
        const ch = args[i];
        if (ch === "(" || ch === "{" || ch === "[") depth++;
        if (ch === ")" || ch === "}" || ch === "]") depth--;
        if (ch === "," && depth === 0) {
            out.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out;
}

function injectProvidersIntoObject(objLiteral: string, providerExpr: string): string {
    if (objLiteral.includes("providers")) {
        // Remove any existing TranslateModule configurations first
        let cleaned = objLiteral;
        cleaned = removeTranslateModuleFromProviders(cleaned);
        return cleaned.replace(/providers\s*:\s*\[/, `providers: [${providerExpr}, `);
    }
    const trimmed = objLiteral.trim();
    if (trimmed.endsWith("}")) {
        const withoutBrace = trimmed.slice(0, -1).trim();
        const separator = withoutBrace.endsWith("{") ? "" : ",";
        return `${withoutBrace}${separator}\n  providers: [${providerExpr}]\n}`;
    }
    return objLiteral;
}

function removeTranslateModuleFromProviders(providersContent: string): string {
    // Match importProvidersFrom(TranslateModule.forRoot({...}))
    // This regex handles nested braces and parens
    let result = providersContent;
    let lastResult = "";

    // Keep removing until no more matches (handles multiple occurrences)
    while (result !== lastResult) {
        lastResult = result;
        result = result.replace(
            /,?\s*importProvidersFrom\s*\(\s*TranslateModule\.forRoot\s*\([^)]*(?:\([^)]*\))*[^)]*\)\s*\)\s*,?/g,
            (match, offset, string) => {
                // If preceded by comma and followed by content, keep the comma
                // If at start of array (after [), remove leading comma
                const before = string.slice(Math.max(0, offset - 10), offset);
                const after = string.slice(offset + match.length, Math.min(string.length, offset + match.length + 10));

                if (/\[\s*$/.test(before) && /^\s*[^\],]/.test(after)) {
                    return ""; // Remove entirely if at array start
                }
                if (/,\s*$/.test(before) && /^\s*,/.test(after)) {
                    return ""; // Remove one of the duplicate commas
                }
                return ""; // Default: remove
            }
        );
    }

    // Clean up any double commas or trailing commas before closing bracket
    result = result.replace(/,\s*,/g, ",");
    result = result.replace(/,\s*\]/g, "]");
    result = result.replace(/\[\s*,/g, "[");

    return result;
}

function removeExistingTranslateModuleConfig(content: string): string {
    // This function removes TranslateModule configurations from the entire content
    // Handle nested structures by finding matching braces
    let result = content;
    const regex = /importProvidersFrom\s*\(\s*TranslateModule\.forRoot\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(result)) !== null) {
        const startIdx = match.index;
        let depth = 0;
        let i = startIdx;
        let foundFirstParen = false;

        // Find the matching closing parenthesis
        while (i < result.length) {
            const ch = result[i];
            if (ch === "(") {
                depth++;
                foundFirstParen = true;
            }
            if (ch === ")") {
                depth--;
                if (foundFirstParen && depth === 0) {
                    // Found the end of importProvidersFrom(...)
                    const endIdx = i + 1;

                    // Check for trailing comma and whitespace
                    let deleteEnd = endIdx;
                    while (deleteEnd < result.length && /[,\s]/.test(result[deleteEnd])) {
                        deleteEnd++;
                        if (result[deleteEnd - 1] === ",") break;
                    }

                    // Check for leading comma and whitespace
                    let deleteStart = startIdx;
                    while (deleteStart > 0 && /[\s]/.test(result[deleteStart - 1])) {
                        deleteStart--;
                    }
                    if (deleteStart > 0 && result[deleteStart - 1] === ",") {
                        deleteStart--;
                    }

                    result = result.slice(0, deleteStart) + result.slice(deleteEnd);
                    regex.lastIndex = 0; // Reset regex to search again
                    break;
                }
            }
            i++;
        }
    }

    return result;
}
