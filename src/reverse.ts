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

// Regex patterns for different types of i18n usage
const PATTERN_TYPES = {
    INTERPOLATION: "interpolation",    // {{ 'KEY' | translate }}
    BOUND_ATTR: "bound_attr",          // [attr]="'KEY' | translate"
    INTERPOLATED_ATTR: "interp_attr",  // attr="{{ 'KEY' | translate }}"
    DIRECTIVE: "directive",            // translate="KEY" or [translate]="'KEY'"
    TS_CALL: "ts_call"                 // i18n('KEY'), .instant('KEY'), .get('KEY')
};

type ReversePattern = {
    regex: RegExp;
    type: string;
    keyGroup: number;
    attrGroup?: number;
};

const REVERSE_PATTERNS: ReversePattern[] = [
    // {{ 'KEY' | translate }} (with optional parameters) - multiline aware, space tolerant
    {
        // Matches {{ 'KEY' | translate }} across lines, handling whitespace liberally
        // The regex needs to consume the entire block including newlines
        // [\s\S]*? is a non-greedy match for any character including newlines
        regex: /{{\s*['"`]([\s\S]*?)['"`]\s*\|\s*translate(?:\s*:\s*[^}]+)?\s*}}/g,
        type: PATTERN_TYPES.INTERPOLATION,
        keyGroup: 1
    },
    // [attr]="'KEY' | translate"
    {
        regex: /\[([a-zA-Z0-9-]+)\]\s*=\s*(['"])\s*(['"])([^'"`]+)\3\s*\|\s*translate(?:\s*:\s*(?:(?!\2).)+)?\s*\2/gms,
        type: PATTERN_TYPES.BOUND_ATTR,
        keyGroup: 4,
        attrGroup: 1
    },
    // attr="{{ 'KEY' | translate }}"
    {
        regex: /\b([a-zA-Z0-9-]+)\s*=\s*(['"])\s*{{\s*(['"])([^'"`]+)\3\s*\|\s*translate(?:\s*:\s*[^}]+)?\s*}}\s*\2/gms,
        type: PATTERN_TYPES.INTERPOLATED_ATTR,
        keyGroup: 4,
        attrGroup: 1
    },
    // [translate]="'KEY'"
    {
        regex: /\[translate\]\s*=\s*(['"])\s*(['"])([^'"`]+)\2\s*\1/gms,
        type: PATTERN_TYPES.DIRECTIVE,
        keyGroup: 3
    },
    // translate="KEY"
    {
        regex: /\btranslate\s*=\s*(['"])([^'"`]+)\1/gms,
        type: PATTERN_TYPES.DIRECTIVE,
        keyGroup: 2
    },
    // i18n('KEY') or i18nPipe ('KEY' | i18nPipe)
    {
        regex: /i18n\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gms,
        type: PATTERN_TYPES.TS_CALL,
        keyGroup: 1
    },
    {
        regex: /{{\s*['"`]([^'"`]+)['"`]\s*\|\s*i18nPipe\s*}}/gms,
        type: PATTERN_TYPES.INTERPOLATION,
        keyGroup: 1
    },
    {
        regex: /{{\s*['"`]([^'"`]+)['"`]\s*\|\s*i18n\s*}}/gms,
        type: PATTERN_TYPES.INTERPOLATION,
        keyGroup: 1
    },
    // TS calls: .instant('KEY'), .get('KEY')
    {
        regex: /(?:\bthis\.\w+|\btranslate)\.instant\s*\(\s*(['"])([^'"]+)\1\s*\)/gms,
        type: PATTERN_TYPES.TS_CALL,
        keyGroup: 2
    },
    {
        regex: /(?:\bthis\.\w+|\btranslate)\.get\s*\(\s*(['"])([^'"]+)\1\s*\)/gms,
        type: PATTERN_TYPES.TS_CALL,
        keyGroup: 2
    },
    // Parenthesized ('KEY' | translate)
    {
        regex: /\(\s*['"`]([^'"`]+)['"`]\s*\|\s*translate\s*\)/gms,
        type: PATTERN_TYPES.TS_CALL,
        keyGroup: 1
    }
];

/**
 * Find all i18n function calls in source files
 * Simple strategy: scan all files, look for patterns, match keys
 */
export async function findI18nMatches(
    targetDir: string,
    keyMap: Map<string, string>,
    ignoreGlobs: string[],
    srcDirForRel?: string
): Promise<ReversalMatch[]> {
    const matches: ReversalMatch[] = [];

    console.log(`[reverse] 🔍 Scanning source files...`);

    // Check if targetDir is a file or directory
    const stats = await fs.stat(targetDir);
    let sourceFiles: string[] = [];

    if (stats.isFile()) {
        sourceFiles = [targetDir];
    } else {
        // Glob expects forward slashes, so convert Windows paths
        const targetDirForGlob = targetDir.replace(/\\/g, '/');
        const sourcePattern = `${targetDirForGlob}/**/*.{ts,tsx,js,jsx,html}`;
        console.log(`[reverse] 🔍 Source pattern: ${sourcePattern}`);

        sourceFiles = await glob(sourcePattern, {
            absolute: true,
            ignore: ignoreGlobs,
        });
    }

    console.log(`[reverse] 📂 Found ${sourceFiles.length} source files to scan`);

    for (const sourceFile of sourceFiles) {
        try {
            const content = await fs.readFile(sourceFile, "utf8");
            const fileRelFromSrc = path.relative(srcDirForRel || targetDir, sourceFile);
            let fileMatchCount = 0;

            for (const p of REVERSE_PATTERNS) {
                let match;
                p.regex.lastIndex = 0;

                while ((match = p.regex.exec(content)) !== null) {
                    const fullMatch = match[0];
                    const extractedKey = match[p.keyGroup];

                    if (keyMap.has(extractedKey)) {
                        const value = keyMap.get(extractedKey);
                        if (!value) continue;

                        // Calculate line number for logging/reporting
                        // This involves scanning newlines up to the match index
                        const linesUpToMatch = content.substring(0, match.index).split('\n');
                        const lineNum = linesUpToMatch.length;
                        const column = linesUpToMatch[linesUpToMatch.length - 1].length + 1;

                        // Determine replacement text based on pattern type
                        let replacementText: string;
                        switch (p.type) {
                            case PATTERN_TYPES.INTERPOLATION:
                                replacementText = value;
                                break;
                            case PATTERN_TYPES.BOUND_ATTR: {
                                const attrNameBound = match[p.attrGroup ?? 0];
                                replacementText = `${attrNameBound}="${value}"`;
                                break;
                            }
                            case PATTERN_TYPES.INTERPOLATED_ATTR: {
                                const attrNameInterp = match[p.attrGroup ?? 0];
                                replacementText = `${attrNameInterp}="${value}"`;
                                break;
                            }
                            case PATTERN_TYPES.DIRECTIVE:
                                replacementText = value;
                                break;
                            case PATTERN_TYPES.TS_CALL:
                                replacementText = `'${value}'`;
                                break;
                            default:
                                replacementText = value;
                        }

                        fileMatchCount++;

                        matches.push({
                            fileAbs: sourceFile,
                            fileRelFromSrc,
                            line: lineNum,
                            column: column,
                            text: fullMatch,
                            key: extractedKey,
                            replacementText: replacementText,
                        });
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
                    // Use a function as second argument to avoid special '$' character issues
                    content = content.replace(match.text, () => match.replacementText);
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
        // Efficient scanning: only scan the folder path, but pass srcDir for correct relative path calculation
        const folderMatches = await findI18nMatches(folderPath, keyMap, ignoreGlobs, srcDir);
        log(`[reverse] Found ${folderMatches.length} matches in folder scope`);

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

        log(`[reverse] Reading and matching file...`);
        // Use the common findI18nMatches for consistency
        const fileMatches = await findI18nMatches(filePath, keyMap, [], srcDir);

        if (fileMatches.length === 0) {
            log(`[reverse] ⚠️ No translation keys found in ${path.basename(filePath)} that exist in the key map.`);
            return { success: 0, failed: 0, errors: [] };
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

/**
 * Reverse translate from a specific selection in a file
 */
export async function reverseTranslateSelectionScope(
    filePath: string,
    selection: { startLine: number, startCol: number, endLine: number, endCol: number },
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

        log(`[reverse] Matching selection in file...`);
        const allFileMatches = await findI18nMatches(filePath, keyMap, [], srcDir);

        // Filter matches to those that overlap with the selection
        const selectionMatches = allFileMatches.filter(m => {
            // Check if match start is within selection
            const isAfterStart = m.line > selection.startLine || (m.line === selection.startLine && m.column >= selection.startCol);
            const isBeforeEnd = m.line < selection.endLine || (m.line === selection.endLine && m.column <= selection.endCol);
            return isAfterStart && isBeforeEnd;
        });

        if (selectionMatches.length === 0) {
            log(`[reverse] ⚠️ No translation keys found in selection.`);
            return { success: 0, failed: 0, errors: [] };
        }

        log(`[reverse] Found ${selectionMatches.length} matches in selection.`);
        return await applyReverseTranslations(selectionMatches, outputChannel);
    } catch (error) {
        log(`[reverse] Error: ${error}`);
        return {
            success: 0,
            failed: 0,
            errors: [`Error: ${error}`],
        };
    }
}
