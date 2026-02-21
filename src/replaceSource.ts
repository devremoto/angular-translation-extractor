import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FoundString } from "./types";

export type KeyMapByFile = Record<string, Record<string, string>>;

type Replacement = { start: number; end: number; text: string };

type ReplaceResult = {
    filesUpdated: number;
    stringsReplaced: number;
    tsFilesUpdated: number;
};

export async function replaceExtractedStrings(opts: {
    workspaceRoot: string;
    found: FoundString[];
    keyMapByFile: KeyMapByFile;
    bootstrapStyle?: "standalone" | "module";
}): Promise<ReplaceResult> {
    const { found, keyMapByFile, bootstrapStyle = "module" } = opts;

    const byFile = new Map<string, FoundString[]>();
    for (const s of found) {
        const arr = byFile.get(s.fileAbs) ?? [];
        arr.push(s);
        byFile.set(s.fileAbs, arr);
    }

    let filesUpdated = 0;
    let stringsReplaced = 0;
    const htmlFilesModified = new Set<string>();
    const tsFilesModified = new Set<string>();

    for (const [fileAbs, items] of byFile.entries()) {
        const keyMap = keyMapByFile[fileAbs];
        if (!keyMap) {
            continue;
        }

        const ext = path.extname(fileAbs).toLowerCase();
        if (!isSupportedExt(ext)) continue;

        let content = await fs.readFile(fileAbs, "utf8");
        const replacements: Replacement[] = [];

        for (const item of items) {
            const key = keyMap[item.text];
            if (!key) {
                continue;
            }

            // If the item is already translated (e.g. from a previous run or existing CallExpression), skip replacing it.
            if (item.isAlreadyTranslated) {
                continue;
            }

            // Check if this is HTML content (from .html file or inline template in .ts file)
            const isHtmlContent = item.kind === "html-text" || item.kind === "html-attr" || item.kind === "html-interpolation";

            if (isHtmlContent) {
                const rep = item.kind === "html-interpolation"
                    ? `'${key}' | translate`
                    : `{{ '${key}' | translate }}`;
                const r = buildHtmlReplacement(content, item, rep);
                if (r) {
                    replacements.push(r);
                    stringsReplaced++;
                } else {
                    console.warn(`[replaceSource] Failed to replace: "${item.text}" in ${fileAbs}`);
                }
                continue;
            }

            // For JS/TS strings (not from HTML templates)
            const rep = ext === ".ts"
                ? `this.translate.instant('${key}')`
                : `translateService.instant('${key}')`;
            const r = buildStringLiteralReplacement(content, item, rep);
            if (r) {
                replacements.push(r);
                stringsReplaced++;
            } else {
                console.warn(`[replaceSource] ❌ Failed to replace: "${item.text}" in ${fileAbs}`);
            }
        }

        if (!replacements.length) continue;

        content = applyReplacements(content, replacements);
        await fs.writeFile(fileAbs, content, "utf8");
        filesUpdated++;

        if (ext === ".html") {
            htmlFilesModified.add(fileAbs);
        } else if (ext === ".ts") {
            tsFilesModified.add(fileAbs);
        }
    }

    // Add TranslatePipe import to TS files with corresponding HTML templates
    let tsFilesUpdated = 0;
    for (const htmlFile of htmlFilesModified) {
        const tsFile = htmlFile.replace(/\.html$/, ".ts");
        try {
            await fs.access(tsFile);
            const shouldAddToComponent = bootstrapStyle === "standalone";
            const updated = await addTranslateModuleImport(tsFile, shouldAddToComponent);
            if (updated) tsFilesUpdated++;
        } catch {
            // TS file not found, skip
        }
    }

    // Add TranslatePipe to inline template TS files
    for (const tsFile of tsFilesModified) {
        const shouldAddToComponent = bootstrapStyle === "standalone";
        const updated = await addTranslateModuleImport(tsFile, shouldAddToComponent);
        if (updated) tsFilesUpdated++;
    }

    // Add TranslateService import and injection for TS files with replacements
    for (const tsFile of tsFilesModified) {
        await addTranslateServiceInjection(tsFile, bootstrapStyle);
    }

    return { filesUpdated, stringsReplaced, tsFilesUpdated };
}

function isSupportedExt(ext: string): boolean {
    return ext === ".html" || ext === ".ts" || ext === ".js";
}

function applyReplacements(content: string, replacements: Replacement[]): string {
    const ordered = [...replacements].sort((a, b) => b.start - a.start);
    let out = content;
    let lastStart = Infinity;
    for (const r of ordered) {
        if (r.end > lastStart) {
            continue; // Skip overlapping replacement to prevent file corruption
        }
        out = out.slice(0, r.start) + r.text + out.slice(r.end);
        lastStart = r.start;
    }
    return out;
}

function buildHtmlReplacement(content: string, item: FoundString, rep: string): Replacement | null {
    if (item.line < 1 || item.column < 0) return null;

    const start = indexFromLineCol(content, item.line, item.column);
    if (start < 0) return null;

    // Use rawText for precise matching if available
    if (item.rawText) {
        // Validate that the content at the specified location matches exactly
        if (content.slice(start, start + item.rawText.length) === item.rawText) {
            let finalRep = rep;
            // For interpolation, wrap in parens: ('KEY' | translate)
            if (item.kind === "html-interpolation") {
                finalRep = `(${rep})`;
            }
            return { start, end: start + item.rawText.length, text: finalRep };
        }
        // If mismatch, something is wrong with offsets or file changed.
        console.warn(`[replaceSource] Mismatch at ${item.fileAbs}:${item.line}:${item.column}. Expected "${item.rawText}", found "${content.slice(start, start + item.rawText.length)}"`);
        return null;
    }

    // Fallback for html-text using strict text match (only if no entities involved)
    if (item.kind === "html-text") {
        const len = item.text.length;
        if (content.slice(start, start + len) === item.text) {
            return { start, end: start + len, text: rep };
        }
    }

    return null;
}

function buildStringLiteralReplacement(content: string, item: FoundString, rep: string): Replacement | null {
    const start = indexFromLineCol(content, item.line, item.column);
    if (start < 0) return null;

    // Use rawText for robustness if available
    if (item.rawText) {
        if (content.slice(start, start + item.rawText.length) === item.rawText) {
            return { start, end: start + item.rawText.length, text: rep };
        }
        console.warn(`[replaceSource] Mismatch JS string at ${item.fileAbs}:${item.line}:${item.column}. Expected "${item.rawText}", found "${content.slice(start, start + item.rawText.length)}"`);
        return null;
    }

    const quote = content[start];
    if (quote !== "'" && quote !== "\"" && quote !== "`") return null;

    const end = findStringLiteralEnd(content, start, quote);
    if (end < 0) return null;

    return { start, end: end + 1, text: rep };
}

function findStringLiteralEnd(content: string, start: number, quote: string): number {
    let i = start + 1;
    while (i < content.length) {
        const ch = content[i];
        if (ch === "\\") {
            i += 2;
            continue;
        }
        if (ch === quote) return i;
        i++;
    }
    return -1;
}

function indexFromLineCol(content: string, line: number, col: number): number {
    if (line < 1 || col < 0) return -1;
    let currentLine = 1;
    let index = 0;
    while (index < content.length && currentLine < line) {
        if (content.charCodeAt(index) === 10) currentLine++;
        index++;
    }
    if (currentLine !== line) return -1;
    return index + col;
}

function _escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function addTranslateModuleImport(tsFile: string, addToComponentImports = false): Promise<boolean> {
    let content = await fs.readFile(tsFile, "utf8");
    let modified = false;

    // Check if TranslatePipe import from @ngx-translate/core already exists
    const hasTranslateModuleImport = /import\s*\{[^}]*\bTranslatePipe\b[^}]*\}\s*from\s*['"]@ngx-translate\/core['"]/.
        test(content);

    // Add import statement if not present
    if (!hasTranslateModuleImport) {
        const lastImportIndex = findLastImportIndex(content);
        const importLine = "import { TranslatePipe } from '@ngx-translate/core';\n";
        if (lastImportIndex >= 0) {
            content = content.slice(0, lastImportIndex) + importLine + content.slice(lastImportIndex);
        } else {
            content = importLine + content;
        }
        modified = true;
    }

    // Add to @Component imports array if inline template
    if (addToComponentImports) {
        const componentMatch = content.match(/@Component\s*\(\s*\{/);
        if (componentMatch) {
            const startIdx = (componentMatch.index ?? 0) + componentMatch[0].length;
            const componentMetadata = extractComponentMetadata(content, startIdx);

            if (componentMetadata) {
                const importsMatch = componentMetadata.match(/imports\s*:\s*\[/);
                if (importsMatch) {
                    // Check if TranslatePipe is already in the imports array
                    const importsArrayRange = findImportsArrayRange(componentMetadata, importsMatch.index ?? 0);
                    const importsArrayContent = importsArrayRange
                        ? componentMetadata.slice(importsArrayRange.start, importsArrayRange.end)
                        : componentMetadata.slice(importsMatch.index ?? 0);
                    const hasTranslateModuleInArray = /\bTranslatePipe\b/.test(importsArrayContent);

                    if (!hasTranslateModuleInArray) {
                        // Add TranslatePipe to existing imports array
                        const importsStartIdx = startIdx + (importsMatch.index ?? 0) + importsMatch[0].length;
                        const insertText = "TranslatePipe, ";
                        content = content.slice(0, importsStartIdx) + insertText + content.slice(importsStartIdx);
                        modified = true;
                    }
                } else {
                    // Add imports array after selector or first property
                    const selectorMatch = componentMetadata.match(/selector\s*:\s*['"][^'"]*['"]\s*,?/);
                    if (selectorMatch) {
                        const selectorEndIdx = startIdx + (selectorMatch.index ?? 0) + selectorMatch[0].length;
                        const hasComma = content[selectorEndIdx - 1] === ",";
                        const insertText = hasComma ? "\n  imports: [TranslatePipe]," : ",\n  imports: [TranslatePipe]";
                        content = content.slice(0, selectorEndIdx) + insertText + content.slice(selectorEndIdx);
                        modified = true;
                    }
                }
            }
        }
    }

    if (!modified) {
        return false;
    }

    await fs.writeFile(tsFile, content, "utf8");
    return true;
}

export async function addLanguageSelectorComponent(tsFile: string, importPath: string): Promise<boolean> {
    let content = await fs.readFile(tsFile, "utf8");
    let modified = false;

    // Remove .ts extension from import path if present
    const importModulePath = importPath.replace(/\.ts$/, '');

    // Check if imported
    const hasImport = /import\s*\{[^}]*\bTgLanguageSelectorComponent\b[^}]*\}\s*from/.test(content);

    if (!hasImport) {
        // Add import
        const lastImportIndex = findLastImportIndex(content);
        const importLine = `import { TgLanguageSelectorComponent } from '${importModulePath}';\n`;
        if (lastImportIndex >= 0) {
            content = content.slice(0, lastImportIndex) + importLine + content.slice(lastImportIndex);
        } else {
            content = importLine + content;
        }
        modified = true;
    }

    // Add to @Component imports array
    const componentMatch = content.match(/@Component\s*\(\s*\{/);
    if (componentMatch) {
        const startIdx = (componentMatch.index ?? 0) + componentMatch[0].length;
        const componentMetadata = extractComponentMetadata(content, startIdx);

        if (componentMetadata) {
            const importsMatch = componentMetadata.match(/imports\s*:\s*\[/);
            if (importsMatch) {
                // Check if already in the imports array
                const importsArrayRange = findImportsArrayRange(componentMetadata, importsMatch.index ?? 0);
                const importsArrayContent = importsArrayRange
                    ? componentMetadata.slice(importsArrayRange.start, importsArrayRange.end)
                    : componentMetadata.slice(importsMatch.index ?? 0);
                const hasSelectorInArray = /\bTgLanguageSelectorComponent\b/.test(importsArrayContent);

                if (!hasSelectorInArray) {
                    const importsStartIdx = startIdx + (importsMatch.index ?? 0) + importsMatch[0].length;
                    const insertText = "TgLanguageSelectorComponent, ";
                    content = content.slice(0, importsStartIdx) + insertText + content.slice(importsStartIdx);
                    modified = true;
                }
            } else {
                // Add imports array after selector or first property
                const selectorMatch = componentMetadata.match(/selector\s*:\s*['"][^'"]*['"]\s*,?/);
                if (selectorMatch) {
                    const selectorEndIdx = startIdx + (selectorMatch.index ?? 0) + selectorMatch[0].length;
                    const hasComma = content[selectorEndIdx - 1] === ",";
                    const insertText = hasComma ? "\n  imports: [TgLanguageSelectorComponent]," : ",\n  imports: [TgLanguageSelectorComponent]";
                    content = content.slice(0, selectorEndIdx) + insertText + content.slice(selectorEndIdx);
                    modified = true;
                }
                // If no selector, might be tricky, skip for now to avoid breaking syntax
            }
        }
    }

    if (modified) {
        await fs.writeFile(tsFile, content, "utf8");
        return true;
    }
    return false;
}

export async function ensureComponentStructure(tsFile: string, bootstrapStyle: "standalone" | "module" = "module"): Promise<boolean> {
    const shouldAddToComponent = bootstrapStyle === "standalone";
    const imported = await addTranslateModuleImport(tsFile, shouldAddToComponent);
    const injected = await addTranslateServiceInjection(tsFile, bootstrapStyle);
    return imported || injected;
}

function findLastImportIndex(content: string): number {
    const importRegex = /^import .*?;\s*$/gm;
    let match: RegExpExecArray | null;
    let lastIndex = -1;
    while ((match = importRegex.exec(content))) {
        lastIndex = match.index + match[0].length;
    }
    return lastIndex;
}

function normalizeImportFormatting(content: string): string {
    return content
        .replace(/;\s*(?=import\s)/g, ";\n")
        .replace(/\n{3,}/g, "\n\n");
}

function extractComponentMetadata(content: string, startIdx: number): string | null {
    let depth = 1;
    let i = startIdx;
    while (i < content.length && depth > 0) {
        const ch = content[i];
        if (ch === "{") depth++;
        if (ch === "}") depth--;
        i++;
    }
    if (depth !== 0) return null;
    return content.slice(startIdx, i - 1);
}

function findImportsArrayRange(componentMetadata: string, importsMatchIndex: number): { start: number; end: number } | null {
    const startBracketIndex = componentMetadata.indexOf("[", importsMatchIndex);
    if (startBracketIndex < 0) return null;

    let depth = 1;
    let i = startBracketIndex + 1;
    while (i < componentMetadata.length && depth > 0) {
        const ch = componentMetadata[i];
        if (ch === "[") depth++;
        if (ch === "]") depth--;
        i++;
    }

    if (depth !== 0) return null;
    return { start: startBracketIndex + 1, end: i - 1 };
}

export async function addTranslateServiceInjection(tsFile: string, bootstrapStyle: "standalone" | "module" = "module"): Promise<boolean> {
    let content = await fs.readFile(tsFile, "utf8");
    const original = content;
    let modified = false;

    // Note: The logic for TranslateService import check was simplified in previous edits but might be missing.
    // I should check for TranslateService import specifically.
    const hasTranslateServiceImport = /import\s*\{[^}]*\bTranslateService\b[^}]*\}\s*from\s*['"]@ngx-translate\/core['"]/.
        test(content);

    if (!hasTranslateServiceImport) {
        // Check if core import exists to append
        const coreImportRegexMain = /import\s*\{([^}]*)\}\s*from\s*['"]@ngx-translate\/core['"];?/;
        const coreImportMatch = coreImportRegexMain.exec(content);

        if (coreImportMatch) {
            const names = coreImportMatch[1];
            const updatedNames = `${names.trim().replace(/\s+/g, " ")}, TranslateService`;
            const replacement = `import { ${updatedNames} } from '@ngx-translate/core';`;
            content = content.replace(coreImportMatch[0], replacement);
            modified = true;
        } else {
            const lastImportIndex = findLastImportIndex(content);
            const importLine = "import { TranslateService } from '@ngx-translate/core';\n";
            if (lastImportIndex >= 0) {
                content = content.slice(0, lastImportIndex) + importLine + content.slice(lastImportIndex);
            } else {
                content = importLine + content;
            }
            modified = true;
        }
    }

    // For standalone components, use inject()
    if (bootstrapStyle === "standalone") {
        // Check if inject is imported
        if (!/import\s*\{[^}]*\binject\b[^}]*\}\s*from\s*['"](@angular\/core|angular)['"];?/.test(content)) {
            const coreImportMatch2 = /import\s*\{([^}]*)\}\s*from\s*['"](@angular\/core|angular)['"];?/.exec(content);
            if (coreImportMatch2) {
                const names = coreImportMatch2[1];
                if (!/\binject\b/.test(names)) {
                    const updatedNames = `${names.trim().replace(/\s+/g, " ")}, inject`;
                    const replacement = `import { ${updatedNames} } from '@angular/core';`;
                    content = content.replace(coreImportMatch2[0], replacement);
                    modified = true;
                }
            }
        }

        // Check if translate property with inject() already exists
        if (!/private\s+translate\s*=\s*inject\(TranslateService\)/.test(content)) {
            const classMatch = /(@Component|export\s+class)\s+\w+[^{]*\{/.exec(content);
            if (classMatch) {
                const insertAt = (classMatch.index ?? 0) + classMatch[0].length;
                const injectLine = "\n  private translate = inject(TranslateService);\n";
                content = content.slice(0, insertAt) + injectLine + content.slice(insertAt);
                modified = true;
            }
        }
    } else {
        // For module-based components, use constructor injection
        if (!/constructor\s*\([^)]*\btranslate\b/.test(content)) {
            const ctorMatch = /constructor\s*\(([^)]*)\)/.exec(content);
            if (ctorMatch) {
                const ctorStart = (ctorMatch.index ?? 0) + ctorMatch[0].indexOf("(") + 1;
                const hasParams = ctorMatch[1].trim().length > 0;
                const insertText = hasParams
                    ? "private translate: TranslateService, "
                    : "private translate: TranslateService";
                content = content.slice(0, ctorStart) + insertText + content.slice(ctorStart);
                modified = true;
            } else {
                const classMatch = /class\s+\w+[^{]*\{/.exec(content);
                if (classMatch) {
                    const insertAt = (classMatch.index ?? 0) + classMatch[0].length;
                    const ctorBlock = "\n  constructor(private translate: TranslateService) {}\n";
                    content = content.slice(0, insertAt) + ctorBlock + content.slice(insertAt);
                    modified = true;
                }
            }
        }
    }

    if (!modified && content === original) {
        return false;
    }

    const normalizedContent = normalizeImportFormatting(content);
    if (normalizedContent !== content) {
        content = normalizedContent;
        modified = true;
    }

    await fs.writeFile(tsFile, content, "utf8");
    return true;
}
