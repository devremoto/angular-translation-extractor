import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "fast-glob";
import { readJsonIfExists } from "./utils";
import { getDefaultLanguageCode, normalizeLanguages } from "./langMeta";
import { LanguageEntry } from "./types";

export type ReversalMatch = {
    fileAbs: string;
    fileRelFromSrc: string;
    line: number;
    column: number;
    text: string;
    key: string;
    replacementText: string;
};

/**
 * Get main language code from full locale code
 * e.g., "en-US" -> "en", "pt-BR" -> "pt"
 */
function getMainLanguageCode(code: string): string {
    const parts = code.split("-");
    return parts[0].toLowerCase();
}

/**
 * Load all translation entries from JSON files
 * Maps key -> value from the base locale JSON files
 */
export async function loadTranslationKeyMap(
    workspaceRoot: string,
    outputRoot: string,
    languagesJsonPath: string,
    baseLocaleCode: string,
    onlyMainLanguages: boolean,
    log?: (msg: string) => void
): Promise<Map<string, string>> {
    const keyMap = new Map<string, string>();
    const logger = log || console.log;

    try {
        // Read languages JSON to find the default language
        const langJsonAbs = path.isAbsolute(languagesJsonPath)
            ? languagesJsonPath
            : path.join(workspaceRoot, languagesJsonPath);

        logger(`[reverse] 📖 Reading languages from: ${langJsonAbs}`);
        logger(`[reverse] 📖 Workspace root: ${workspaceRoot}`);
        logger(`[reverse] 📖 Languages JSON path: ${languagesJsonPath}`);

        const rawLangs = await readJsonIfExists<LanguageEntry[]>(langJsonAbs, []);
        logger(`[reverse] 📖 Found ${rawLangs.length} language entries`);

        const languages = normalizeLanguages(rawLangs);
        logger(`[reverse] 📖 Normalized ${languages.length} language entries`);

        // Find the default language
        const defaultLangCode = getDefaultLanguageCode(languages);
        if (!defaultLangCode) {
            logger(`[reverse] ⚠️  No default language found in ${languagesJsonPath}, using baseLocaleCode: ${baseLocaleCode}`);
        }

        // Determine which language code to search for
        const searchCode = defaultLangCode || baseLocaleCode;
        const finalSearchCode = onlyMainLanguages ? getMainLanguageCode(searchCode) : searchCode;

        logger(`[reverse] 🔍 Default language: ${defaultLangCode || 'not found'}`);
        logger(`[reverse] 🔍 Base locale code: ${baseLocaleCode}`);
        logger(`[reverse] 🔍 Only main languages: ${onlyMainLanguages}`);
        logger(`[reverse] 🔍 Search code: ${finalSearchCode}`);
        logger(`[reverse] 🔍 Output root: ${outputRoot}`);

        // Glob expects forward slashes, so convert Windows paths
        const outputRootForGlob = outputRoot.replace(/\\/g, '/');
        const pattern = `${outputRootForGlob}/**/${finalSearchCode}.json`;
        logger(`[reverse] 📂 Glob pattern: ${pattern}`);
        const jsonFiles = await glob(pattern, { absolute: true });

        logger(`[reverse] 📂 Found ${jsonFiles.length} JSON files matching pattern`);

        for (const jsonFile of jsonFiles) {
            const fileRelFromOutput = path.relative(outputRoot, jsonFile);
            logger(`[reverse]   📄 Loading: ${fileRelFromOutput}`);
            const translations = await readJsonIfExists<Record<string, unknown>>(
                jsonFile,
                {}
            );

            // Flatten nested objects into dot-notation keys
            const flattenObj = (obj: Record<string, unknown>, prefix = ''): void => {
                for (const [key, value] of Object.entries(obj)) {
                    const fullKey = prefix ? `${prefix}.${key}` : key;

                    if (typeof value === "string" && value.trim()) {
                        keyMap.set(fullKey, value);
                    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                        flattenObj(value as Record<string, unknown>, fullKey);
                    }
                }
            };

            flattenObj(translations);
            logger(`[reverse]   📄 Loaded ${keyMap.size} total translation keys so far`);
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        logger(`[reverse] ❌ Failed to load translations: ${errorMsg}`);
        if (errorStack) {
            logger(`[reverse] ❌ Stack: ${errorStack}`);
        }
    }

    logger(`[reverse] ✅ Loaded ${keyMap.size} keys`);
    return keyMap;
}

/**
 * Find all i18n function calls in source files
 * Simple strategy: scan all files, look for patterns, match keys
 */
export async function findI18nMatches(
    srcDir: string,
    keyMap: Map<string, string>,
    ignoreGlobs: string[]
): Promise<ReversalMatch[]> {
    const matches: ReversalMatch[] = [];

    // Regex patterns to find i18n calls
    const patterns = [
        // {{ 'KEY' | translate }} - MOST COMMON ANGULAR
        /{{\s*['"`]([^'"`]+)['"`]\s*\|\s*translate\s*}}/g,
        // ('KEY' | translate) - PARENTHESIZED VERSION
        /\(\s*['"`]([^'"`]+)['"`]\s*\|\s*translate\s*\)/g,
        // i18n('KEY')
        /i18n\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
        // {{ 'KEY' | i18nPipe }}
        /{{\s*['"`]([^'"`]+)['"`]\s*\|\s*i18nPipe\s*}}/g,
        // {{ 'KEY' | i18n }}
        /{{\s*['"`]([^'"`]+)['"`]\s*\|\s*i18n\s*}}/g,
        // this.[service].instant('KEY')
        /this\.\w+\.instant\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
        // translate.get('KEY')
        /translate\.get\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
        // this.translate.get('KEY')
        /this\.translate\.get\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
        // this.[service].get('KEY')
        /this\.\w+\.get\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    ];

    console.log(`[reverse] 🔍 Scanning source files...`);

    // Glob expects forward slashes, so convert Windows paths
    const srcDirForGlob = srcDir.replace(/\\/g, '/');
    const sourcePattern = `${srcDirForGlob}/**/*.{ts,tsx,js,jsx,html}`;
    console.log(`[reverse] 🔍 Source pattern: ${sourcePattern}`);
    console.log(`[reverse] 🔍 Ignore globs: ${ignoreGlobs.join(', ')}`);

    const sourceFiles = await glob(sourcePattern, {
        absolute: true,
        ignore: ignoreGlobs,
    });

    console.log(`[reverse] 📂 Found ${sourceFiles.length} source files to scan`);

    if (sourceFiles.length === 0) {
        console.log(`[reverse] ⚠️  No source files found! Check srcDir and ignoreGlobs`);
        return matches;
    }

    if (sourceFiles.length < 10) {
        sourceFiles.forEach(f => console.log(`[reverse]   - ${path.relative(srcDir, f)}`));
    } else {
        console.log(`[reverse]   First 5 files:`);
        sourceFiles.slice(0, 5).forEach(f => console.log(`[reverse]   - ${path.relative(srcDir, f)}`));
    }

    for (const sourceFile of sourceFiles) {
        try {
            const content = await fs.readFile(sourceFile, "utf8");
            const lines = content.split("\n");
            const fileRelFromSrc = path.relative(srcDir, sourceFile);
            let fileMatchCount = 0;

            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                const line = lines[lineNum];

                for (const pattern of patterns) {
                    let match;
                    pattern.lastIndex = 0;

                    while ((match = pattern.exec(line)) !== null) {
                        const fullMatch = match[0];
                        const extractedKey = match[1];

                        if (keyMap.has(extractedKey)) {
                            const value = keyMap.get(extractedKey);
                            if (!value) continue;

                            // Determine replacement format
                            let replacementText: string;
                            if (fullMatch.includes("{{")) {
                                replacementText = value;
                            } else {
                                replacementText = `'${value}'`;
                            }

                            fileMatchCount++;

                            matches.push({
                                fileAbs: sourceFile,
                                fileRelFromSrc,
                                line: lineNum + 1,
                                column: (match.index ?? 0) + 1,
                                text: fullMatch,
                                key: extractedKey,
                                replacementText,
                            });

                            console.log(`[reverse] ✅ Found: ${fileRelFromSrc}:${lineNum + 1}`);
                            console.log(`[reverse]      "${fullMatch}" → "${replacementText}"`);
                        }
                    }
                }
            }

            if (fileMatchCount > 0) {
                console.log(`[reverse] 📄 ${fileRelFromSrc}: ${fileMatchCount} matches`);
            }
        } catch (error) {
            console.log(`[reverse] ⚠ Could not read ${sourceFile}: ${error}`);
        }
    }

    console.log(`[reverse] ═══════════════════════════════`);
    console.log(`[reverse] Found ${matches.length} matches total`);
    return matches;
}

/**
 * Clean up ngx-translate imports and inject declarations from TypeScript files
 */
function cleanupTranslateImports(
    content: string,
    filePath: string,
    log?: (msg: string) => void
): string {
    // Only clean up TypeScript files
    const isTsFile = /\.(ts|tsx)$/.test(filePath);
    if (!isTsFile) {
        return content;
    }

    if (log) log(`[cleanup] 🧹 Cleaning ${path.basename(filePath)}...`);

    const original = content;

    // Remove TranslateModule usage in imports array
    // Case: imports: [TranslateModule, ...] -> matches "TranslateModule,"
    content = content.replace(/TranslateModule(?!\.)\s*,\s*/g, '');
    // Case: imports: [..., TranslateModule] -> matches ", TranslateModule"
    content = content.replace(/,\s*TranslateModule(?!\.)/g, '');
    // Case: imports: [TranslateModule] -> matches "TranslateModule"
    // Use word boundary and negative lookahead to avoid breaking TranslateModule.forRoot
    content = content.replace(/\bTranslateModule\b(?!\.)/g, '');

    // // Remove import lines containing TranslateModule or TranslateService from @ngx-translate/core
    // // Matches entire import statement on one or multiple lines
    // // Guard against removing import if forRoot/forChild is used
    // if (!content.includes('TranslateModule.forRoot') && !content.includes('TranslateModule.forChild')) {
    //     content = content.replace(/import\s+{[^}]*(?:TranslateModule|TranslateService)[^}]*}\s+from\s+['"]@ngx-translate\/core['"];?\s*\n?/g, '');
    // }

    const removed = original !== content;
    if (log && removed) log(`[cleanup]   ✅ Cleaned up TranslateService imports and injections`);

    return content;
}

/**
 * Apply the replacements to files
 */

/**
 * Apply the replacements to files
 */
export async function applyReverseTranslations(
    matches: ReversalMatch[],
    outputChannel?: { appendLine: (line: string) => void }
): Promise<{ success: number; failed: number; errors: string[] }> {
    const log = (msg: string) => {
        console.log(msg);
        if (outputChannel) outputChannel.appendLine(msg);
    };

    const errors: string[] = [];
    let success = 0;
    let failed = 0;

    log(`[reverse] ═══════════════════════════════`);
    log(`[reverse] 🚀 Applying replacements...`);
    log(`[reverse] Total matches: ${matches.length}`);

    // Group by file
    const fileToMatches = new Map<string, ReversalMatch[]>();
    for (const match of matches) {
        if (!fileToMatches.has(match.fileAbs)) {
            fileToMatches.set(match.fileAbs, []);
        }
        const matchArray = fileToMatches.get(match.fileAbs);
        if (matchArray) {
            matchArray.push(match);
        }
    }

    // Process each file
    for (const [filePath, fileMatches] of fileToMatches.entries()) {
        log(`[reverse] \n📄 ${path.basename(filePath)} (${fileMatches.length} replacements)`);

        try {
            let content = await fs.readFile(filePath, "utf8");

            // Sort matches by position (descending) to avoid offset issues
            const sorted = [...fileMatches].sort((a, b) => {
                if (a.line !== b.line) return b.line - a.line;
                return b.column - a.column;
            });

            let fileReplacements = 0;
            for (const match of sorted) {
                if (content.includes(match.text)) {
                    content = content.replace(match.text, match.replacementText);
                    success++;
                    fileReplacements++;
                    log(`[reverse]   ✅ Line ${match.line}: "${match.text.substring(0, 50)}..."`);
                } else {
                    failed++;
                    log(`[reverse]   ❌ Line ${match.line}: NOT FOUND`);
                    errors.push(`"${match.text}" not found in ${path.basename(filePath)}`);
                }
            }

            if (fileReplacements > 0) {
                // Clean up unused TranslateService imports and injections
                content = cleanupTranslateImports(content, filePath, log);

                // Write back
                await fs.writeFile(filePath, content, "utf8");
                log(`[reverse]   💾 Written to disk`);
            } else {
                log(`[reverse]   ⚠️ No replacements applied to ${path.basename(filePath)}, skipping save and cleanup`);
            }
        } catch (error) {
            log(`[reverse]   ❌ ERROR: ${error}`);
            errors.push(`Error processing ${path.basename(filePath)}: ${error}`);
        }
    }

    log(`[reverse] ═══════════════════════════════`);
    log(`[reverse] ✅ Success: ${success}`);
    log(`[reverse] ❌ Failed: ${failed}`);
    if (errors.length > 0) {
        log(`[reverse] Errors:`);
        errors.forEach(e => log(`[reverse]   - ${e}`));
    }

    return { success, failed, errors };
}

/**
 * Reverse translate from a folder
 */
export async function reverseTranslateFolderScope(
    folderPath: string,
    workspaceRoot: string,
    srcDir: string,
    outputRoot: string,
    languagesJsonPath: string,
    baseLocaleCode: string,
    onlyMainLanguages: boolean,
    ignoreGlobs: string[],
    outputChannel?: { appendLine: (line: string) => void }
): Promise<{ success: number; failed: number; errors: string[] }> {
    const log = (msg: string) => {
        console.log(msg);
        if (outputChannel) outputChannel.appendLine(msg);
    };

    try {
        log(`[reverse] 📄 Starting reverse translate for folder: ${folderPath}`);
        log(`[reverse] 📂 Output root: ${outputRoot}`);
        log(`[reverse] 💾 Src dir: ${srcDir}`);

        log(`[reverse] Loading translations...`);
        const keyMap = await loadTranslationKeyMap(workspaceRoot, outputRoot, languagesJsonPath, baseLocaleCode, onlyMainLanguages, log);
        log(`[reverse] ✅ Loaded ${keyMap.size} translation keys`);

        if (keyMap.size === 0) {
            const msg = `No translations found in ${outputRoot}`;
            log(`[reverse] ❌ ${msg}`);
            return {
                success: 0,
                failed: 0,
                errors: [msg],
            };
        }

        log(`[reverse] 🔍 Finding matches in source files...`);
        const allMatches = await findI18nMatches(srcDir, keyMap, ignoreGlobs);
        log(`[reverse] Found ${allMatches.length} total matches`);

        // Filter to folder scope
        const folderMatches = allMatches.filter(m => {
            const rel = path.relative(folderPath, m.fileAbs);
            return !rel.startsWith("..");
        });
        log(`[reverse] Filtered to ${folderMatches.length} matches in folder scope`);

        log(`[reverse] 🚀 Applying replacements...`);
        return await applyReverseTranslations(folderMatches, outputChannel);
    } catch (error) {
        const msg = `Error: ${error}`;
        log(`[reverse] ❌ ${msg}`);
        return {
            success: 0,
            failed: 0,
            errors: [msg],
        };
    }
}

/**
 * Reverse translate from a file
 */
export async function reverseTranslateFileScope(
    filePath: string,
    workspaceRoot: string,
    srcDir: string,
    outputRoot: string,
    languagesJsonPath: string,
    baseLocaleCode: string,
    onlyMainLanguages: boolean,
    ignoreGlobs: string[],
    outputChannel?: { appendLine: (line: string) => void }
): Promise<{ success: number; failed: number; errors: string[] }> {
    const log = (msg: string) => {
        console.log(msg);
        if (outputChannel) outputChannel.appendLine(msg);
    };

    try {
        log(`[reverse] Loading translations...`);
        const keyMap = await loadTranslationKeyMap(workspaceRoot, outputRoot, languagesJsonPath, baseLocaleCode, onlyMainLanguages, log);

        if (keyMap.size === 0) {
            return {
                success: 0,
                failed: 0,
                errors: [`No translations found in ${outputRoot}`],
            };
        }

        log(`[reverse] Reading file...`);
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n");
        const fileMatches: ReversalMatch[] = [];

        const patterns = [
            /{{\s*['"`]([^'"`]+)['"`]\s*\|\s*translate\s*}}/g,
            /\(\s*['"`]([^'"`]+)['"`]\s*\|\s*translate\s*\)/g,
            /i18n\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
            /{{\s*['"`]([^'"`]+)['"`]\s*\|\s*i18nPipe\s*}}/g,
            /{{\s*['"`]([^'"`]+)['"`]\s*\|\s*i18n\s*}}/g,
            /this\.\w+\.instant\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
            /translate\.get\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
            /this\.translate\.get\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
            /this\.\w+\.get\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
        ];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            for (const pattern of patterns) {
                let match;
                pattern.lastIndex = 0;

                while ((match = pattern.exec(line)) !== null) {
                    const fullMatch = match[0];
                    const extractedKey = match[1];

                    if (keyMap.has(extractedKey)) {
                        const value = keyMap.get(extractedKey);
                        if (!value) continue;
                        let replacementText = fullMatch.includes("{{") ? value : `'${value}'`;

                        fileMatches.push({
                            fileAbs: filePath,
                            fileRelFromSrc: path.basename(filePath),
                            line: lineNum + 1,
                            column: (match.index ?? 0) + 1,
                            text: fullMatch,
                            key: extractedKey,
                            replacementText,
                        });
                    }
                }
            }
        }

        return await applyReverseTranslations(fileMatches, outputChannel);
    } catch (error) {
        log(`[reverse] Error: ${error}`);
        return {
            success: 0,
            failed: 0,
            errors: [`Error: ${error}`],
        };
    }
}
