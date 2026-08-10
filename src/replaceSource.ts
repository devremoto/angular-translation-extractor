import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { FoundString } from "./types";

/** What Babel tells us about the classes in a .ts file. */
export type ClassAnalysis = {
    /** [start, end) source ranges of every class body — `this.x` only works inside these. */
    classRanges: Array<{ start: number; end: number }>;
    /** Names of every member of the FIRST class: properties, methods, accessors, ctor param properties. */
    memberNames: Set<string>;
    /** The `x = inject(TranslateService)` member of the first class, when present. */
    injected: { name: string; visibility: MemberVisibility; duplicated: boolean } | null;
    /** Constructor parameter PROPERTY typed TranslateService (private/public/protected ctor param). */
    ctorParamName: string | null;
};

/**
 * Parses a .ts file and reports its classes' real structure. This replaces regex-based member
 * detection, which false-positived on object-literal keys (`translate: this.translate`) and
 * missed context entirely. Returns null when the file cannot be parsed.
 */
export function analyzeClasses(code: string): ClassAnalysis | null {
    let ast;
    try {
        ast = parse(code, { sourceType: "unambiguous", plugins: ["typescript", "decorators-legacy"] });
    } catch {
        return null;
    }

    const result: ClassAnalysis = { classRanges: [], memberNames: new Set(), injected: null, ctorParamName: null };
    let firstClassSeen = false;

    const memberName = (key: any): string | null => {
        if (!key) return null;
        if (key.type === "Identifier") return key.name;
        if (key.type === "StringLiteral") return key.value;
        if (key.type === "PrivateName") return `#${key.id?.name ?? ""}`;
        return null;
    };

    const isInjectTranslate = (value: any): boolean =>
        value?.type === "CallExpression"
        && value.callee?.type === "Identifier"
        && value.callee.name === "inject"
        && value.arguments?.[0]?.type === "Identifier"
        && value.arguments[0].name === "TranslateService";

    const visibilityOf = (node: any): MemberVisibility =>
        node.accessibility === "private" ? "private"
            : node.accessibility === "protected" ? "protected"
                : "public";

    traverse(ast, {
        Class(classPath: any) {
            const node = classPath.node;
            if (typeof node.start === "number" && typeof node.end === "number") {
                result.classRanges.push({ start: node.start, end: node.end });
            }
            if (firstClassSeen) return;
            firstClassSeen = true;

            for (const member of node.body?.body ?? []) {
                const name = memberName(member.key);
                if (!name) continue;

                if ((member.type === "ClassProperty" || member.type === "PropertyDefinition") && isInjectTranslate(member.value)) {
                    result.injected = {
                        name,
                        visibility: name.startsWith("#") ? "private" : visibilityOf(member),
                        duplicated: result.memberNames.has(name),
                    };
                    if (result.injected && result.memberNames.has(name)) {
                        result.injected.duplicated = true;
                    }
                } else if (result.injected && name === result.injected.name) {
                    // A later member reuses the injected member's name — that's the collision.
                    result.injected.duplicated = true;
                }
                result.memberNames.add(name);

                if (member.type === "ClassMethod" && member.kind === "constructor") {
                    for (const param of member.params ?? []) {
                        if (param.type !== "TSParameterProperty") continue;
                        const inner = param.parameter?.type === "Identifier" ? param.parameter : param.parameter?.left;
                        const paramName = inner?.name;
                        if (!paramName) continue;
                        result.memberNames.add(paramName);
                        const typeName = inner?.typeAnnotation?.typeAnnotation?.typeName?.name;
                        if (typeName === "TranslateService" && !result.ctorParamName) {
                            result.ctorParamName = paramName;
                        }
                    }
                }
            }
        }
    });

    return result;
}

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
    const tsFilesNeedingRepair = new Set<string>();
    const translateAccessorByFile = new Map<string, TranslateAccessor>();

    for (const [fileAbs, items] of byFile.entries()) {
        const keyMap = keyMapByFile[fileAbs];
        if (!keyMap) {
            continue;
        }

        const ext = path.extname(fileAbs).toLowerCase();
        if (!isSupportedExt(ext)) continue;

        let content = await fs.readFile(fileAbs, "utf8");
        const replacements: Replacement[] = [];

        // Decide ONE accessor name per file up front, so the calls we emit and the member we
        // inject below can never disagree (and never collide with an existing member).
        const analysis = ext === ".ts" ? analyzeClasses(content) : null;
        const accessor = ext === ".ts" ? resolveTranslateAccessor(content, analysis) : null;
        if (accessor) {
            translateAccessorByFile.set(fileAbs, accessor);
            if (accessor.renameFrom) {
                // A previous run left a colliding injection in this file. Repair it even when the
                // file has nothing new to replace — otherwise it stays broken forever, because
                // every string in it is already translated.
                tsFilesNeedingRepair.add(fileAbs);
            }
        }

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

            // For JS/TS strings (not from HTML templates).
            // `this.<member>` only exists inside a class body — a string in a module-level const
            // or a standalone function must be left alone, or the emitted code cannot compile.
            if (ext === ".ts") {
                const offset = indexFromLineCol(content, item.line, item.column);
                const insideClass = analysis === null // unparseable — assume ok rather than skip everything
                    || analysis.classRanges.some(r => offset >= r.start && offset < r.end);
                if (!insideClass) {
                    console.warn(`[replaceSource] Skipped "${item.text}" in ${fileAbs}:${item.line} — not inside a class, this.*.instant() would not compile.`);
                    continue;
                }
            }
            const rep = ext === ".ts"
                ? `this.${accessor?.name ?? "translate"}.instant('${key}')`
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

    // Add TranslateService import and injection for TS files with replacements, plus any file
    // carrying a colliding injection from an earlier run (repair-only, no replacements needed).
    for (const tsFile of new Set([...tsFilesModified, ...tsFilesNeedingRepair])) {
        await addTranslateServiceInjection(tsFile, bootstrapStyle, translateAccessorByFile.get(tsFile));
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

/**
 * Names tried, in order, when the class has no TranslateService yet.
 * `translateService` leads deliberately: `translate` collides with a member name components and
 * services commonly already use (e.g. a `translate(id, lang)` API method).
 */
const TRANSLATE_ACCESSOR_CANDIDATES = ["translateService", "tgTranslateService", "translateSvc", "i18nTranslateService"];

export type TranslateAccessor = {
    /** Member name to call, e.g. `this.<name>.instant(...)`. */
    name: string;
    /** True when the class already provides TranslateService — nothing to inject. */
    alreadyProvided: boolean;
    /** Set when an existing injection collides with another member and must be renamed to `name`. */
    renameFrom?: string;
};

/**
 * Decides how a class reaches TranslateService, from a real Babel parse of the file.
 *
 * Reuses an existing injection whatever its shape (`inject()` with any modifiers/name, or a
 * constructor parameter property), and otherwise picks a name that does **not** collide with a
 * member the class actually declares — a service with its own `translate(id, lang)` method would
 * otherwise get a `private translate = inject(TranslateService)` on top of it.
 *
 * When a *previous* run already created that collision, the existing injection is reported with
 * `renameFrom` so it can be repaired. Object-literal keys, template text and other lookalikes do
 * NOT count as members — only what the AST says the class declares.
 */
export function resolveTranslateAccessor(content: string, analysis?: ClassAnalysis | null): TranslateAccessor {
    const info = analysis ?? analyzeClasses(content);
    if (!info) {
        // Unparseable file — be conservative: assume provided so nothing gets injected or renamed.
        return { name: "translateService", alreadyProvided: /inject\s*\(\s*TranslateService\s*\)/.test(content) };
    }

    if (info.injected) {
        if (!info.injected.duplicated) {
            return { name: info.injected.name, alreadyProvided: true };
        }
        return { name: pickFreeName(info.memberNames), alreadyProvided: true, renameFrom: info.injected.name };
    }

    if (info.ctorParamName) {
        return { name: info.ctorParamName, alreadyProvided: true };
    }

    return { name: pickFreeName(info.memberNames), alreadyProvided: false };
}

function pickFreeName(memberNames: Set<string>): string {
    const free = TRANSLATE_ACCESSOR_CANDIDATES.find(name => !memberNames.has(name));
    return free ?? `translateService${TRANSLATE_ACCESSOR_CANDIDATES.length}`;
}

/**
 * Renames an injected TranslateService member and its property accesses.
 * `this.<old>.` becomes `this.<new>.`; calls of a same-named method (`this.<old>(`) are left alone,
 * which is exactly the member the injection was colliding with.
 */
export function renameInjectedMember(content: string, oldName: string, newName: string): string {
    const escaped = escapeRegExp(oldName);
    const declaration = new RegExp(
        `(^|[\\s;{])((?:(?:public|private|protected|readonly|static|override|declare)\\s+)*)${escaped}(\\s*(?::\\s*TranslateService\\s*)?=\\s*inject\\s*\\(\\s*TranslateService\\s*\\))`
    );
    if (!declaration.test(content)) {
        return content;
    }
    let out = content.replace(declaration, `$1$2${newName}$3`);
    out = out.replace(new RegExp(`\\bthis\\.${escaped}\\.`, "g"), `this.${newName}.`);

    // A non-private member can also be referenced from the inline template.
    const inline = findInlineTemplateRange(out);
    if (inline) {
        const template = out.slice(inline.start, inline.end);
        const renamed = renameTemplateReferences(template, oldName, newName);
        if (renamed !== template) {
            out = out.slice(0, inline.start) + renamed + out.slice(inline.end);
        }
    }
    return out;
}

/** Rewrites references to a renamed member in the component's external template, when it has one. */
async function renameInTemplateFile(tsFile: string, content: string, oldName: string, newName: string): Promise<void> {
    const templateFile = resolveTemplateFile(tsFile, content);
    if (!templateFile) {
        return;
    }
    let template: string;
    try {
        template = await fs.readFile(templateFile, "utf8");
    } catch {
        return; // no external template (inline-only component, or the URL points nowhere)
    }
    const renamed = renameTemplateReferences(template, oldName, newName);
    if (renamed !== template) {
        await fs.writeFile(templateFile, renamed, "utf8");
        console.warn(`[replaceSource] Updated references to '${oldName}' in ${templateFile}.`);
    }
}

export type MemberVisibility = "private" | "protected" | "public";

/**
 * Visibility of the `= inject(TranslateService)` member itself — matched on the injection, not on
 * the first mention of the name (an inline template above the class would otherwise win).
 * TypeScript's default is public.
 */
export function getInjectedMemberVisibility(content: string, name: string): MemberVisibility {
    const decl = new RegExp(
        `(?:^|[\\s;{])((?:(?:public|private|protected|readonly|static|override|declare)\\s+)*)${escapeRegExp(name)}\\s*(?::\\s*TranslateService\\s*)?=\\s*inject\\s*\\(\\s*TranslateService`
    ).exec(content);
    const modifiers = decl?.[1] ?? "";
    if (/\bprivate\b/.test(modifiers) || name.startsWith("#")) {
        return "private";
    }
    return /\bprotected\b/.test(modifiers) ? "protected" : "public";
}

/**
 * Rewrites references to a member inside an Angular template: `{{ old.instant('K') }}`,
 * `[x]="old.currentLang"`, `(click)="old.use('pt')"`.
 * Left alone: property tails (`item.old`), longer identifiers (`oldThing`), direct calls
 * (`old(1, 'pt')` — the same-named *method* the injection was colliding with), and pipe
 * usages (`'K' | translate` — that's the TranslatePipe's NAME, not the member).
 */
export function renameTemplateReferences(template: string, oldName: string, newName: string): string {
    const pattern = new RegExp(`(^|[^\\w$.])${escapeRegExp(oldName)}(?![\\w$])(?!\\s*\\()`, "g");
    return template.replace(pattern, (match: string, pre: string, offset: number) => {
        const before = template.slice(0, offset + pre.length);
        if (/\|\s*$/.test(before)) {
            return match; // pipe name, never a member reference
        }
        return pre + newName;
    });
}

/** Range of an inline `template:` string literal in a @Component decorator. */
function findInlineTemplateRange(content: string): { start: number; end: number } | null {
    const match = /template\s*:\s*(`[\s\S]*?`|'[^']*'|"[^"]*")/.exec(content);
    if (!match) {
        return null;
    }
    const literalStart = match.index + match[0].length - match[1].length;
    return { start: literalStart + 1, end: literalStart + match[1].length - 1 };
}

/** External template of a component: the `templateUrl`, else the sibling `.html`. */
export function resolveTemplateFile(tsFile: string, content: string): string | null {
    const urlMatch = /templateUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(content);
    if (urlMatch) {
        return path.resolve(path.dirname(tsFile), urlMatch[1]);
    }
    return /template\s*:/.test(content) ? null : tsFile.replace(/\.ts$/, ".html");
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Index just after the `{` that opens the first class body, or null when the file declares no class.
 * Scans past generics/heritage (`class Foo<T extends {a: 1}> extends Bar implements Baz {`) instead
 * of grabbing the first `{`, which for a decorated class is the decorator's object literal.
 */
export function findClassBodyStart(content: string): number | null {
    const decl = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+[A-Za-z_$][\w$]*/.exec(content);
    if (!decl) {
        return null;
    }
    let angle = 0;
    let paren = 0;
    for (let i = decl.index + decl[0].length; i < content.length; i++) {
        const ch = content[i];
        if (ch === "<") angle++;
        else if (ch === ">") angle = Math.max(0, angle - 1);
        else if (ch === "(") paren++;
        else if (ch === ")") paren = Math.max(0, paren - 1);
        else if (ch === "{") {
            if (angle === 0 && paren === 0) {
                return i + 1;
            }
            angle = 0; // a `{` inside generics/heritage means our depth tracking drifted; resync
        }
    }
    return null;
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

export async function addTranslateServiceInjection(
    tsFile: string,
    bootstrapStyle: "standalone" | "module" = "module",
    accessor?: TranslateAccessor
): Promise<boolean> {
    let content = await fs.readFile(tsFile, "utf8");
    const original = content;
    let modified = false;

    // Re-resolve when the caller did not decide (single-string paths, ensureComponentStructure).
    const target = accessor ?? resolveTranslateAccessor(content);

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

    // The class already reaches TranslateService (inject() or constructor param, any name):
    // the import above is all that was missing — injecting again would duplicate the member.
    if (target.alreadyProvided) {
        if (target.renameFrom) {
            // A previous run injected a member whose name is also a real member of the class
            // (e.g. a `translate(id, lang)` method) — rename the injection and its usages.
            const visibility = getInjectedMemberVisibility(content, target.renameFrom);
            const renamed = renameInjectedMember(content, target.renameFrom, target.name);
            if (renamed !== content) {
                // Always rewrite the template: Angular compiles it inside the class, so it can
                // reference `private` members too — visibility does not limit template access.
                await renameInTemplateFile(tsFile, content, target.renameFrom, target.name);
                console.warn(`[replaceSource] Renamed conflicting ${visibility} TranslateService member '${target.renameFrom}' to '${target.name}' in ${tsFile}.`);
                if (visibility !== "private") {
                    // Only a non-private member can be reached from another file, and those are
                    // outside what this pass rewrites.
                    console.warn(`[replaceSource] '${target.renameFrom}' was ${visibility}; check for references to it outside ${path.basename(tsFile)} and its template.`);
                }
                content = renamed;
                modified = true;
            }
        }
        if (!modified) {
            return false;
        }
        await fs.writeFile(tsFile, normalizeImportFormatting(content), "utf8");
        return true;
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

        const classBodyStart = findClassBodyStart(content);
        if (classBodyStart === null) {
            console.warn(`[replaceSource] No class body found in ${tsFile}; skipping TranslateService injection.`);
        } else {
            const injectLine = `\n  private ${target.name} = inject(TranslateService);\n`;
            content = content.slice(0, classBodyStart) + injectLine + content.slice(classBodyStart);
            modified = true;
        }
    } else {
        // For module-based components, use constructor injection
        const ctorMatch = /constructor\s*\(([^)]*)\)/.exec(content);
        if (ctorMatch) {
            const ctorStart = (ctorMatch.index ?? 0) + ctorMatch[0].indexOf("(") + 1;
            const hasParams = ctorMatch[1].trim().length > 0;
            const insertText = hasParams
                ? `private ${target.name}: TranslateService, `
                : `private ${target.name}: TranslateService`;
            content = content.slice(0, ctorStart) + insertText + content.slice(ctorStart);
            modified = true;
        } else {
            const classBodyStart = findClassBodyStart(content);
            if (classBodyStart === null) {
                console.warn(`[replaceSource] No class body found in ${tsFile}; skipping TranslateService injection.`);
            } else {
                const ctorBlock = `\n  constructor(private ${target.name}: TranslateService) {}\n`;
                content = content.slice(0, classBodyStart) + ctorBlock + content.slice(classBodyStart);
                modified = true;
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
