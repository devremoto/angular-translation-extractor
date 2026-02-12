import * as path from "node:path";
import * as fs from "node:fs/promises";
import { LanguageEntry, FoundString } from "./types";
import { ensureDir, readJsonIfExists, withoutExt } from "./utils";
import { makeKey } from "./keygen";

export type LocaleJson = Record<string, any>;
export type KeyMapByFile = Record<string, Record<string, string>>;

function normalizeLocaleJson(obj: LocaleJson): LocaleJson {
  const normalized: LocaleJson = {};

  for (const [key, value] of Object.entries(obj ?? {})) {
    if (key.includes(".")) {
      setNestedValue(normalized, key, value as string);
      continue;
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      setNestedValue(normalized, key, normalizeLocaleJson(value as LocaleJson));
      continue;
    }

    setNestedValue(normalized, key, value as string);
  }

  return normalized;
}

function setNestedValue(obj: any, path: string, value: any): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

export function getAllKeys(obj: any, prefix = ""): string[] {
  const keys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...getAllKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}

export function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split(".");
  let current = obj;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return typeof current === "string" ? current : undefined;
}

function getMainLanguageCode(code: string): string {
  const parts = code.split("-");
  return parts[0].toLowerCase();
}

export async function generatePerFileLocales(opts: {
  workspaceRoot: string;
  srcDir: string;
  outputRoot: string;
  baseLocaleCode: string;
  languages: LanguageEntry[];
  found: FoundString[];
  updateMode: "merge" | "overwrite" | "recreate";
  onlyMainLanguages?: boolean;
  singleFilePerLanguage?: boolean;
}): Promise<{
  baseFiles: Array<{ baseFileAbs: string; outDirAbs: string; targets: string[] }>;
  filesProcessed: number;
  stringsAdded: number;
  keyMapByFile: KeyMapByFile;
}> {
  const { workspaceRoot, srcDir, outputRoot, baseLocaleCode, languages, found, updateMode, onlyMainLanguages, singleFilePerLanguage } = opts;

  if (singleFilePerLanguage) {
    return generateAsSingleFilePerLanguage({ workspaceRoot, srcDir, outputRoot, baseLocaleCode, languages, found, updateMode, onlyMainLanguages });
  } else {
    return generateAsPerFileLocales({ workspaceRoot, srcDir, outputRoot, baseLocaleCode, languages, found, updateMode, onlyMainLanguages });
  }
}

async function generateAsSingleFilePerLanguage(opts: {
  workspaceRoot: string;
  srcDir: string;
  outputRoot: string;
  baseLocaleCode: string;
  languages: LanguageEntry[];
  found: FoundString[];
  updateMode: "merge" | "overwrite" | "recreate";
  onlyMainLanguages?: boolean;
}): Promise<{
  baseFiles: Array<{ baseFileAbs: string; outDirAbs: string; targets: string[] }>;
  filesProcessed: number;
  stringsAdded: number;
  keyMapByFile: KeyMapByFile;
}> {
  const { workspaceRoot, srcDir, outputRoot, baseLocaleCode, languages, found, updateMode, onlyMainLanguages } = opts;

  const outRootAbs = path.join(workspaceRoot, outputRoot);
  await ensureDir(outRootAbs);

  // Collect all strings
  let allLocales = languages.map(l => onlyMainLanguages ? getMainLanguageCode(l.code) : l.code);
  const mainBaseLocaleCode = onlyMainLanguages ? getMainLanguageCode(baseLocaleCode) : baseLocaleCode;
  allLocales = Array.from(new Set(allLocales));
  const targetLocales = allLocales.filter(c => c !== mainBaseLocaleCode);

  // Build single base file for all strings
  const baseFileAbs = path.join(outRootAbs, `${mainBaseLocaleCode}.json`);

  // For base language: recreate=start fresh, merge/overwrite=merge with existing
  const existingBaseRaw = updateMode === "recreate" ? {} : await readJsonIfExists<LocaleJson>(baseFileAbs, {});
  const existingBase = normalizeLocaleJson(existingBaseRaw);
  const existingKeys = getAllKeys(existingBase);
  const usedKeys = new Set(existingKeys);
  // Deep copy to avoid shared references
  const base: LocaleJson = JSON.parse(JSON.stringify(existingBase));

  const valToKey = new Map<string, string>();
  for (const key of existingKeys) {
    const val = getNestedValue(existingBase, key);
    if (val) valToKey.set(val, key);
  }

  let stringsAdded = 0;
  const keyMapByFile: KeyMapByFile = {};

  // Process all found strings
  for (const foundString of found) {
    const fileAbs = foundString.fileAbs;

    // Build prefix from file path
    const relFromSrc = foundString.fileRelFromSrc ?? path.relative(path.join(workspaceRoot, srcDir), fileAbs);
    const relNoExt = withoutExt(relFromSrc);
    const prefix = relNoExt
      .split("/")
      .map(segment =>
        (segment || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || "SEG"
      )
      .join(".");

    // Initialize keymap for this file if needed
    if (!keyMapByFile[fileAbs]) {
      keyMapByFile[fileAbs] = {};
    }

    // Handle existing keys
    if (foundString.isAlreadyTranslated) {
      if (!getNestedValue(base, foundString.text)) {
        setNestedValue(base, foundString.text, "");
        stringsAdded++;
      }
      continue;
    }

    // Add string if not already mapped
    if (!valToKey.has(foundString.text)) {
      const key = makeKey(foundString.text, usedKeys, prefix);
      setNestedValue(base, key, foundString.text);
      valToKey.set(foundString.text, key);
      stringsAdded++;
    }

    // Map text to key for this file
    const key = valToKey.get(foundString.text)!;
    keyMapByFile[fileAbs][foundString.text] = key;
  }

  // Write base language file
  await fs.writeFile(baseFileAbs, JSON.stringify(base, null, 2) + "\n", "utf8");

  const baseKeys = getAllKeys(base);

  // Generate target language files based on updateMode
  for (const code of targetLocales) {
    const targetAbs = path.join(outRootAbs, `${code}.json`);
    let merged: LocaleJson;

    if (updateMode === "merge") {
      // merge: Preserve existing translations, add blanks for new/missing/null/empty keys
      const existingRaw = await readJsonIfExists<LocaleJson>(targetAbs, {});
      const existing = normalizeLocaleJson(existingRaw);
      merged = JSON.parse(JSON.stringify(existing));

      for (const key of baseKeys) {
        const existingVal = getNestedValue(merged, key);
        // Mark for translation if: missing, null, or empty string
        if (existingVal === undefined || existingVal === null || existingVal === "") {
          setNestedValue(merged, key, "");
        }
      }
    } else {
      // overwrite/recreate: Start fresh with blank values for all keys
      merged = {};
      for (const key of baseKeys) {
        setNestedValue(merged, key, "");
      }
    }

    await fs.writeFile(targetAbs, JSON.stringify(merged, null, 2) + "\n", "utf8");
  }

  return {
    baseFiles: [{ baseFileAbs, outDirAbs: outRootAbs, targets: targetLocales }],
    filesProcessed: 1,  // Single consolidated file
    stringsAdded,
    keyMapByFile
  };
}

async function generateAsPerFileLocales(opts: {
  workspaceRoot: string;
  srcDir: string;
  outputRoot: string;
  baseLocaleCode: string;
  languages: LanguageEntry[];
  found: FoundString[];
  updateMode: "merge" | "overwrite" | "recreate";
  onlyMainLanguages?: boolean;
}): Promise<{
  baseFiles: Array<{ baseFileAbs: string; outDirAbs: string; targets: string[] }>;
  filesProcessed: number;
  stringsAdded: number;
  keyMapByFile: KeyMapByFile;
}> {
  const { workspaceRoot, srcDir, outputRoot, baseLocaleCode, languages, found, updateMode, onlyMainLanguages } = opts;

  const srcAbs = path.join(workspaceRoot, srcDir);
  const outRootAbs = path.join(workspaceRoot, outputRoot);

  const byFile = new Map<string, FoundString[]>();
  for (const s of found) {
    const arr = byFile.get(s.fileAbs) ?? [];
    arr.push(s);
    byFile.set(s.fileAbs, arr);
  }

  const baseFiles: Array<{ baseFileAbs: string; outDirAbs: string; targets: string[] }> = [];
  let filesProcessed = 0;
  let stringsAdded = 0;
  const keyMapByFile: KeyMapByFile = {};

  // Map language codes to main language if onlyMainLanguages is true, then deduplicate
  let allLocales = languages.map(l => onlyMainLanguages ? getMainLanguageCode(l.code) : l.code);
  const mainBaseLocaleCode = onlyMainLanguages ? getMainLanguageCode(baseLocaleCode) : baseLocaleCode;

  // Deduplicate locale codes
  allLocales = Array.from(new Set(allLocales));
  const targetLocales = allLocales.filter(c => c !== mainBaseLocaleCode);

  for (const [fileAbs, strings] of byFile.entries()) {
    const relFromSrc = strings[0]?.fileRelFromSrc ?? path.relative(srcAbs, fileAbs);
    const relNoExt = withoutExt(relFromSrc);
    const outDirAbs = path.join(outRootAbs, relNoExt);

    await ensureDir(outDirAbs);

    const baseFileAbs = path.join(outDirAbs, `${mainBaseLocaleCode}.json`);

    // For base language: recreate=start fresh, merge/overwrite=merge with existing
    const existingBaseRaw = updateMode === "recreate" ? {} : await readJsonIfExists<LocaleJson>(baseFileAbs, {});
    const existingBase = normalizeLocaleJson(existingBaseRaw);
    const existingKeys = getAllKeys(existingBase);
    const usedKeys = new Set(existingKeys);
    const base: LocaleJson = { ...existingBase };

    const valToKey = new Map<string, string>();
    for (const key of existingKeys) {
      const val = getNestedValue(existingBase, key);
      if (val) valToKey.set(val, key);
    }

    const prefix = relNoExt
      .split("/")
      .map(segment =>
        (segment || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || "SEG"
      )
      .join(".");

    for (const s of strings) {
      if (s.isAlreadyTranslated) {
        if (!getNestedValue(base, s.text)) {
          setNestedValue(base, s.text, "");
          stringsAdded++;
        }
        continue;
      }
      if (valToKey.has(s.text)) continue;
      const key = makeKey(s.text, usedKeys, prefix);
      setNestedValue(base, key, s.text);
      valToKey.set(s.text, key);
      stringsAdded++;
    }

    const textKeyMap: Record<string, string> = {};
    for (const [val, key] of valToKey.entries()) {
      textKeyMap[val] = key;
    }
    keyMapByFile[fileAbs] = textKeyMap;

    // Write base file
    await fs.writeFile(baseFileAbs, JSON.stringify(base, null, 2) + "\n", "utf8");

    const baseKeys = getAllKeys(base);

    // Generate target language files based on updateMode
    for (const code of targetLocales) {
      const targetAbs = path.join(outDirAbs, `${code}.json`);
      let merged: LocaleJson;

      if (updateMode === "merge") {
        // merge: Preserve existing translations, add blanks for new/missing/null/empty keys
        const existingRaw = await readJsonIfExists<LocaleJson>(targetAbs, {});
        const existing = normalizeLocaleJson(existingRaw);
        merged = JSON.parse(JSON.stringify(existing));

        for (const key of baseKeys) {
          const existingVal = getNestedValue(merged, key);
          // Mark for translation if: missing, null, or empty string
          if (existingVal === undefined || existingVal === null || existingVal === "") {
            setNestedValue(merged, key, "");
          }
        }
      } else {
        // overwrite/recreate: Start fresh with blank values for all keys
        merged = {};
        for (const key of baseKeys) {
          setNestedValue(merged, key, "");
        }
      }

      // Write target file
      await fs.writeFile(targetAbs, JSON.stringify(merged, null, 2) + "\n", "utf8");
    }

    baseFiles.push({ baseFileAbs, outDirAbs, targets: targetLocales });
    filesProcessed++;
  }

  return { baseFiles, filesProcessed, stringsAdded, keyMapByFile };
}

// Note: Translation JSON file update behavior is controlled by updateMode:
// - "merge": Preserves existing translations, only adds new keys with blank values
// - "overwrite": Recreates all non-default language files with blank values
// - "recreate": Recreates all files including default language with blank values
