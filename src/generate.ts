import * as path from "node:path";
import * as fs from "node:fs/promises";
import { LanguageEntry, FoundString } from "./types";
import { ensureDir, readJsonIfExists, withoutExt } from "./utils";
import { makeKey } from "./keygen";

export type LocaleJson = Record<string, any>;
export type KeyMapByFile = Record<string, Record<string, string>>;

function deleteNestedValue(obj: Record<string, any>, path: string): boolean {
  const parts = path.split(".");
  const chain: Array<{ parent: Record<string, any>; key: string }> = [];
  let current: any = obj;

  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return false;
    }
    chain.push({ parent: current, key: part });
    current = current[part];
  }

  const last = chain[chain.length - 1];
  if (!last) return false;
  delete last.parent[last.key];

  for (let i = chain.length - 2; i >= 0; i--) {
    const { parent, key } = chain[i];
    const child = parent[key];
    if (
      child &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      Object.keys(child).length === 0
    ) {
      delete parent[key];
      continue;
    }
    break;
  }

  return true;
}

function pruneLocaleKeys(locale: LocaleJson, keysToPrune: Iterable<string>): void {
  for (const key of keysToPrune) {
    deleteNestedValue(locale, key);
  }
}

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

export async function generatePerFileLocales(opts: {
  workspaceRoot: string;
  srcDir: string;
  outputRoot: string;
  baseLocaleCode: string;
  languages: LanguageEntry[];
  found: FoundString[];
  updateMode: "merge" | "overwrite" | "recreate";
  pruneKeys?: string[];
}): Promise<{
  baseFiles: Array<{ baseFileAbs: string; outDirAbs: string; targets: string[] }>;
  filesProcessed: number;
  stringsAdded: number;
  keyMapByFile: KeyMapByFile;
  baseKeys: string[];
}> {
  const { workspaceRoot, srcDir, outputRoot, baseLocaleCode, languages, found, updateMode, pruneKeys } = opts;


  return generateAsSingleFilePerLanguage({ workspaceRoot, srcDir, outputRoot, baseLocaleCode, languages, found, updateMode, pruneKeys });



}

async function generateAsSingleFilePerLanguage(opts: {
  workspaceRoot: string;
  srcDir: string;
  outputRoot: string;
  baseLocaleCode: string;
  languages: LanguageEntry[];
  found: FoundString[];
  updateMode: "merge" | "overwrite" | "recreate";
  pruneKeys?: string[];
}): Promise<{
  baseFiles: Array<{ baseFileAbs: string; outDirAbs: string; targets: string[] }>;
  filesProcessed: number;
  stringsAdded: number;
  keyMapByFile: KeyMapByFile;
  baseKeys: string[];
}> {
  const { workspaceRoot, srcDir, outputRoot, baseLocaleCode, languages, found, updateMode, pruneKeys = [] } = opts;

  const outRootAbs = path.join(workspaceRoot, outputRoot);
  await ensureDir(outRootAbs);

  // Collect all strings
  let allLocales = languages.map(l => l.code);
  const mainBaseLocaleCode = baseLocaleCode;
  allLocales = Array.from(new Set(allLocales));
  const targetLocales = allLocales.filter(c => c !== mainBaseLocaleCode);

  // Build single base file for all strings
  const baseFileAbs = path.join(outRootAbs, `${mainBaseLocaleCode}.json`);

  // For base language: recreate=start fresh, merge/overwrite=merge with existing
  const existingBaseRaw = updateMode === "recreate" ? {} : await readJsonIfExists<LocaleJson>(baseFileAbs, {});
  const existingBase = normalizeLocaleJson(existingBaseRaw);
  const pruneKeySet = new Set(pruneKeys);
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
    const rawSegments = relNoExt.split("/").map(segment =>
      (segment || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "SEG"
    );
    // Collapse consecutive duplicate segments (e.g. app/app) to avoid repeated keys like APP.APP
    const dedupedSegments: string[] = [];
    for (let i = 0; i < rawSegments.length; i++) {
      if (i === 0 || rawSegments[i] !== rawSegments[i - 1]) dedupedSegments.push(rawSegments[i]);
    }
    const prefix = dedupedSegments.join(".");

    // Initialize keymap for this file if needed
    if (!keyMapByFile[fileAbs]) {
      keyMapByFile[fileAbs] = {};
    }

    // Handle existing keys
    if (foundString.isAlreadyTranslated) {
      if (pruneKeySet.has(foundString.text)) {
        continue;
      }
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
    const key = valToKey.get(foundString.text);
    if (key) {
      keyMapByFile[fileAbs][foundString.text] = key;
    }
  }

  if (pruneKeySet.size > 0) {
    pruneLocaleKeys(base, pruneKeySet);
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

    if (pruneKeySet.size > 0) {
      pruneLocaleKeys(merged, pruneKeySet);
    }

    await fs.writeFile(targetAbs, JSON.stringify(merged, null, 2) + "\n", "utf8");
  }

  return {
    baseFiles: [{ baseFileAbs, outDirAbs: outRootAbs, targets: targetLocales }],
    filesProcessed: 1,  // Single consolidated file
    stringsAdded,
    keyMapByFile,
    baseKeys
  };
}


// Note: Translation JSON file update behavior is controlled by updateMode:
// - "merge": Preserves existing translations, only adds new keys with blank values
// - "overwrite": Recreates all non-default language files with blank values
// - "recreate": Recreates all files including default language with blank values
