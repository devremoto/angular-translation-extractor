import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs"; // For sync checks if needed
import { createRequire } from "node:module";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getConfig, ExtConfig } from "./config";

const execAsync = promisify(exec);
import { scanForStrings } from "./scan";
import { LanguageEntry, FoundString, RestrictedString } from "./types";
import { normalizeLanguages } from "./langMeta";
import { ensureDir, readJsonIfExists, posixRel } from "./utils";
import { generatePerFileLocales, getAllKeys, getNestedValue } from "./generate";
import { generateLoaderArtifacts } from "./loader-generator";
import { replaceExtractedStrings, ensureComponentStructure, addTranslateModuleImport, addLanguageSelectorComponent } from "./replaceSource";
import { updateMainTs } from "./updateMainTs";
import { runTranslateCommand } from "./translate";
import { updateAngularJson } from "./updateAngularJson";
import { captureConsoleLogs } from "./console-capture";
import { reverseTranslateFileScope, reverseTranslateFolderScope, reverseTranslateSelectionScope, reverseTranslateSelectedKeysInWorkspace } from './reverse';
import { extractFromJsTs } from "./extractJsTs";
import { extractFromHtml } from "./extractHtml";
import { Project, SyntaxKind } from "ts-morph";



async function loadAndNormalizeLanguages(workspaceRoot: string, languagesJsonPath: string): Promise<LanguageEntry[]> {
  const abs = path.join(workspaceRoot, languagesJsonPath);
  await ensureDir(path.dirname(abs));

  let entries = await readJsonIfExists<LanguageEntry[]>(abs, []);

  if (entries.length === 0) {
    entries = [
      {
        "rank": 1,
        "code": "en-US",
        "englishName": "English (United States)",
        "nativeName": "English (United States)",
        "flag": "https://flagcdn.com/w40/us.png",
        "default": true,
        "active": true
      },
      {
        "rank": 2,
        "code": "pt-BR",
        "englishName": "Portuguese (Brazil)",
        "nativeName": "Português (Brasil)",
        "flag": "https://flagcdn.com/w40/br.png",
        "default": false,
        "active": true
      },
      {
        "rank": 3,
        "code": "pt-PT",
        "englishName": "Portuguese (Portugal)",
        "nativeName": "Português (Portugal)",
        "flag": "https://flagcdn.com/w40/pt.png",
        "default": false,
        "active": false
      },
      {
        "rank": 4,
        "code": "es-ES",
        "englishName": "Spanish (Spain)",
        "nativeName": "Español (España)",
        "flag": "https://flagcdn.com/w40/es.png",
        "default": false,
        "active": true
      },
      {
        "rank": 5,
        "code": "fr-FR",
        "englishName": "French (France)",
        "nativeName": "Français (France)",
        "flag": "https://flagcdn.com/w40/fr.png",
        "default": false,
        "active": true
      },
      {
        "rank": 6,
        "code": "it-IT",
        "englishName": "Italian (Italy)",
        "nativeName": "Italiano (Italia)",
        "flag": "https://flagcdn.com/w40/it.png",
        "default": false,
        "active": true
      },
      {
        "rank": 7,
        "code": "zh-CN",
        "englishName": "Chinese (Simplified, China)",
        "nativeName": "中文 (中国)",
        "flag": "https://flagcdn.com/w40/cn.png",
        "default": false,
        "active": true
      }
    ];
  }

  const normalized = normalizeLanguages(entries);

  await fs.writeFile(abs, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return normalized;
}

async function getDefaultLocaleCodeFromLanguagesFile(
  workspaceRoot: string,
  languagesJsonPath: string
): Promise<string | undefined> {
  const abs = path.isAbsolute(languagesJsonPath)
    ? languagesJsonPath
    : path.join(workspaceRoot, languagesJsonPath);

  const raw = await readJsonIfExists<LanguageEntry[]>(abs, []);
  const normalized = normalizeLanguages(raw);
  return normalized.find(l => l.default === true)?.code;
}

function isPackageInstalled(pkgName: string, root: string, output?: vscode.OutputChannel): boolean {
  // 1. Check if listed in package.json (dependencies or devDependencies)
  // We want to ensure it is saved in the project.
  try {
    const pkgJsonPath = path.join(root, "package.json");
    if (fsSync.existsSync(pkgJsonPath)) {
      const content = fsSync.readFileSync(pkgJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      const hasDep = (pkg.dependencies && pkg.dependencies[pkgName]) ||
        (pkg.devDependencies && pkg.devDependencies[pkgName]);

      if (!hasDep) {
        if (output) output.appendLine(`[angular-i18n] Package '${pkgName}' is NOT listed in package.json.`);
        return false;
      }
    }
  } catch (err) {
    if (output) output.appendLine(`[angular-i18n] Error reading package.json: ${err}`);
  }

  // 2. Check if resolvable (physically installed)
  try {
    // Use Node's module resolution to find packages, which handles hoisting and monorepos correctly
    // We create a require function relative to the workspace's package.json
    const requireFunc = createRequire(path.join(root, "package.json"));
    requireFunc.resolve(pkgName);
    return true;
  } catch {
    if (output) output.appendLine(`[angular-i18n] Package '${pkgName}' is listed but NOT resolvable (not installed).`);
    return false;
  }
}

async function detectPackageManager(root: string): Promise<string> {
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  if (entries.includes("pnpm-lock.yaml")) return "pnpm";
  if (entries.includes("yarn.lock")) return "yarn";
  if (entries.includes("bun.lockb")) return "bun";
  return "npm";
}

async function installMissingPackages(root: string, packages: string[], output: vscode.OutputChannel): Promise<boolean> {
  const pm = await detectPackageManager(root);
  const pkgList = packages.join(" "); // Install as runtime dependency
  let cmd = `npm install ${pkgList}`;

  if (pm === "pnpm") cmd = `pnpm add ${pkgList}`;
  else if (pm === "yarn") cmd = `yarn add ${pkgList}`;
  else if (pm === "bun") cmd = `bun add ${pkgList}`;

  output.appendLine(`[angular-i18n] Installing packages with ${pm}: ${cmd}`);

  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: root });
    output.appendLine(stdout);
    if (stderr) {
      // npm often prints warnings to stderr, but invalid failures result in throw/exit code usually.
      // But let's log it.
      output.appendLine(`[angular-i18n] (stderr): ${stderr}`);
    }
    return true;
  } catch (error: any) {
    output.appendLine(`[angular-i18n] Installation failed: ${error.message}`);
    return false;
  }
}

async function ensurePackagesInstalled(workspaceRoot: string, output: vscode.OutputChannel): Promise<boolean> {
  const missingPackages: string[] = [];

  // We only check for the runtime dependencies the user needs in THEIR project
  if (!isPackageInstalled("@ngx-translate/core", workspaceRoot, output)) {
    missingPackages.push("@ngx-translate/core");
  }

  if (!isPackageInstalled("@ngx-translate/http-loader", workspaceRoot, output)) {
    missingPackages.push("@ngx-translate/http-loader");
  }

  if (missingPackages.length === 0) {
    output.appendLine(`[angular-i18n] ✓ All required packages are installed`);
    return true;
  }

  const installed = await installMissingPackages(workspaceRoot, missingPackages, output);
  if (installed) {
    // Re-check to verify they are actually there
    const stillMissing = missingPackages.filter(p => !isPackageInstalled(p, workspaceRoot, output));
    if (stillMissing.length > 0) {
      output.appendLine(`[angular-i18n] ⚠ Installation task finished but packages still seem missing: ${stillMissing.join(", ")}`);
      // We return true anyway to let the process try to continue, maybe fs check is cached or slow
      return true;
    }

    output.appendLine(`[angular-i18n] ✓ Packages installed successfully.`);
    return true;
  } else {
    output.appendLine(`[angular-i18n] ⚠ Installation failed.`);
    vscode.window.showErrorMessage("Package installation failed. Check terminal for details.");
    return false;
  }
}

async function performAppConfiguration(
  root: string,
  cfg: ExtConfig,
  baseLocaleCode: string,
  output: vscode.OutputChannel
) {
  output.appendLine(`[angular-i18n] Verifying application configuration...`);

  // 1. Angular.json assets
  try {
    await updateAngularJson({
      workspaceRoot: root,
      outputRoot: cfg.outputRoot,
      languagesJsonPath: cfg.languagesJsonPath
    });
  } catch (err) {
    output.appendLine(`[angular-i18n] ⚠ Could not update angular.json: ${err}`);
  }

  // 2. Main.ts providers
  try {
    const mainResult = await updateMainTs({
      workspaceRoot: root,
      srcDir: cfg.srcDir,
      mainTsPath: cfg.mainTsPath,
      baseLocaleCode: baseLocaleCode,
      bootstrapStyle: cfg.angularBootstrapStyle,
      updateMode: cfg.updateMode,
      outputRoot: cfg.outputRoot
    });
    if (mainResult.updated) output.appendLine(`[angular-i18n] ✅ main.ts updated`);
  } catch (err) {
    output.appendLine(`[angular-i18n] ⚠ Could not verify main.ts: ${(err as Record<string, unknown>)?.message || String(err)}`);
  }


}

interface ProcessOptions {
  skipHeavyOps?: boolean;
  skipReplacement?: boolean;
  forceUpdateMode?: "merge" | "overwrite";
}

interface DefaultJsonBackup {
  timestamp: number;
  baseLocaleCode: string;
  files: Array<{
    relativePath: string;
    content: Record<string, any>;
  }>;
}

interface ManagedDefaultSnapshot {
  baseLocaleCode: string;
  updatedAt: number;
  entries: Record<string, string>;
}

const MANAGED_DEFAULT_SNAPSHOT_KEY = "angular-i18n-managed-default-snapshot-v1";

function hasConsecutiveDuplicatePathSegment(relativePath: string): boolean {
  const normalized = relativePath
    .replace(/\\+/g, "/")
    .split("/")
    .filter(Boolean);

  for (let i = 1; i < normalized.length - 1; i++) {
    if (normalized[i] === normalized[i - 1]) {
      return true;
    }
  }

  return false;
}

function hasNonEmptyValues(obj: any): boolean {
  if (obj === null || obj === undefined || obj === '') {
    return false;
  }

  if (typeof obj !== 'object') {
    return true; // Non-empty primitive value
  }

  if (Array.isArray(obj)) {
    return obj.some(item => hasNonEmptyValues(item));
  }

  // For objects, check all values recursively
  const values = Object.values(obj);
  if (values.length === 0) {
    return false; // Empty object
  }

  return values.some(value => hasNonEmptyValues(value));
}

function flattenLocaleEntries(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {}
): Record<string, string> {
  for (const [key, value] of Object.entries(obj ?? {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[fullKey] = value;
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenLocaleEntries(value as Record<string, unknown>, fullKey, out);
    }
  }

  return out;
}

async function readDefaultLocaleKeyMap(
  workspaceRoot: string,
  outputRoot: string,
  baseLocaleCode: string
): Promise<Record<string, string>> {
  const baseFileAbs = path.join(workspaceRoot, outputRoot, `${baseLocaleCode}.json`);
  const baseJson = await readJsonIfExists<Record<string, unknown>>(baseFileAbs, {});
  return flattenLocaleEntries(baseJson);
}

function deleteNestedKey(obj: Record<string, unknown>, keyPath: string): boolean {
  const parts = keyPath.split(".");
  const chain: Array<{ parent: Record<string, unknown>; key: string }> = [];
  let current: Record<string, unknown> | undefined = obj;

  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return false;
    }
    chain.push({ parent: current, key: part });
    const next = current[part];
    current = (next && typeof next === "object" && !Array.isArray(next))
      ? (next as Record<string, unknown>)
      : undefined;
  }

  const last = chain[chain.length - 1];
  if (!last) return false;

  delete last.parent[last.key];

  for (let i = chain.length - 2; i >= 0; i--) {
    const node = chain[i];
    const child = node.parent[node.key];
    if (child && typeof child === "object" && !Array.isArray(child) && Object.keys(child as Record<string, unknown>).length === 0) {
      delete node.parent[node.key];
      continue;
    }
    break;
  }

  return true;
}

async function pruneSelectedKeysFromLocaleFiles(
  workspaceRoot: string,
  outputRoot: string,
  baseLocaleCode: string,
  localeCodes: string[],
  keysToPrune: string[]
): Promise<{ filesUpdated: number; keysRemoved: number }> {
  let filesUpdated = 0;
  let keysRemoved = 0;

  const outputAbs = path.join(workspaceRoot, outputRoot);
  const defaultPattern = new vscode.RelativePattern(outputAbs, `**/${baseLocaleCode}.json`);
  const defaultFiles = await vscode.workspace.findFiles(defaultPattern, "**/node_modules/**");

  for (const defaultFile of defaultFiles) {
    const baseDir = path.dirname(defaultFile.fsPath);

    for (const localeCode of localeCodes) {
      const localeFileAbs = path.join(baseDir, `${localeCode}.json`);

      try {
        await fs.access(localeFileAbs);
      } catch {
        continue;
      }

      const localeJson = await readJsonIfExists<Record<string, unknown>>(localeFileAbs, {});
      let changed = false;

      for (const key of keysToPrune) {
        if (deleteNestedKey(localeJson, key)) {
          keysRemoved++;
          changed = true;
        }
      }

      if (!changed) {
        continue;
      }

      await fs.writeFile(localeFileAbs, JSON.stringify(localeJson, null, 2) + "\n", "utf8");
      filesUpdated++;
    }
  }

  return { filesUpdated, keysRemoved };
}

function getSelectedPropertyNamesFromJsonText(selectedText: string): Set<string> {
  const propertyNames = new Set<string>();
  const keyRegex = /"([^"\\]+)"\s*:/g;
  let match: RegExpExecArray | null;

  while ((match = keyRegex.exec(selectedText)) !== null) {
    const keyName = match[1]?.trim();
    if (keyName) {
      propertyNames.add(keyName);
    }
  }

  return propertyNames;
}

function resolveDefaultKeysFromSelectedJsonRange(selectedText: string, allDefaultKeys: string[]): string[] {
  const selectedPropertyNames = getSelectedPropertyNamesFromJsonText(selectedText);
  if (selectedPropertyNames.size === 0) {
    return [];
  }

  const selectedKeys = allDefaultKeys.filter((fullKey) => {
    const segments = fullKey.split(".");
    for (const segment of segments) {
      if (selectedPropertyNames.has(segment)) {
        return true;
      }
    }
    return false;
  });

  return Array.from(new Set(selectedKeys));
}

async function backupDefaultJson(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  outputRoot: string,
  baseLocaleCode: string,
  output: vscode.OutputChannel
) {
  try {
    const workspaceId = vscode.workspace.workspaceFolders?.[0]?.uri.toString() || workspaceRoot;
    const backupKey = `angular-i18n-default-backup-${Buffer.from(workspaceId).toString('base64').slice(0, 32)}`;

    const outputAbs = path.join(workspaceRoot, outputRoot);
    const files: Array<{ relativePath: string; content: Record<string, any> }> = [];

    // Find all default language JSON files
    const searchPattern = new vscode.RelativePattern(outputAbs, `**/${baseLocaleCode}.json`);
    const foundFiles = await vscode.workspace.findFiles(searchPattern, '**/node_modules/**');

    if (foundFiles.length === 0) {
      output.appendLine(`[backup] No default language files found to backup`);
      return;
    }

    output.appendLine(`[backup] Found ${foundFiles.length} default language file(s), checking content...`);

    for (const fileUri of foundFiles) {
      const fileAbs = fileUri.fsPath;
      const relativePath = path.relative(outputAbs, fileAbs);

      if (hasConsecutiveDuplicatePathSegment(relativePath)) {
        output.appendLine(`[backup] ✗ Skipping suspicious path with duplicate folder segment: ${relativePath}`);
        continue;
      }

      try {
        const contentStr = await fs.readFile(fileAbs, 'utf-8');
        output.appendLine(`[backup] Reading ${relativePath} (${contentStr.length} bytes)`);

        const content = JSON.parse(contentStr);

        // Only backup files with actual content (non-empty values)
        if (hasNonEmptyValues(content)) {
          // Count actual non-empty string values for logging
          const countNonEmpty = (obj: any): number => {
            let count = 0;
            const traverse = (o: any) => {
              if (typeof o === 'string' && o.length > 0) count++;
              else if (typeof o === 'object' && o !== null) {
                Object.values(o).forEach(traverse);
              }
            };
            traverse(obj);
            return count;
          };
          const valueCount = countNonEmpty(content);

          if (valueCount > 0) {
            files.push({ relativePath, content });
            output.appendLine(`[backup] ✓ ${relativePath} - ${valueCount} non-empty values - WILL BACKUP`);
          } else {
            output.appendLine(`[backup] ✗ ${relativePath} - has keys but all values are empty strings - SKIPPING`);
          }
        } else {
          output.appendLine(`[backup] ✗ Skipping ${relativePath} - all values are empty`);
        }
      } catch (e) {
        output.appendLine(`[backup] ✗ Failed to read ${relativePath}: ${e}`);
      }
    }

    if (files.length > 0) {
      const backup: DefaultJsonBackup = {
        timestamp: Date.now(),
        baseLocaleCode,
        files
      };

      await context.workspaceState.update(backupKey, backup);
      output.appendLine(`[backup] ✓ Saved backup of ${files.length} file(s) to workspace state`);
    } else {
      output.appendLine(`[backup] ⚠ No valid files to backup (all had empty values)`);
    }
  } catch (err) {
    output.appendLine(`[backup] ✗ Failed to backup default JSON: ${err}`);
  }
}

async function restoreDefaultJson(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  outputRoot: string,
  baseLocaleCode: string,
  output: vscode.OutputChannel
): Promise<boolean> {
  try {
    const workspaceId = vscode.workspace.workspaceFolders?.[0]?.uri.toString() || workspaceRoot;
    const backupKey = `angular-i18n-default-backup-${Buffer.from(workspaceId).toString('base64').slice(0, 32)}`;

    const backup = context.workspaceState.get<DefaultJsonBackup>(backupKey);

    if (!backup || backup.baseLocaleCode !== baseLocaleCode) {
      output.appendLine(`[restore] No backup found for ${baseLocaleCode}`);
      return false;
    }

    if (backup.files.length === 0) {
      output.appendLine(`[restore] Backup exists but contains no files`);
      return false;
    }

    const hasInvalidPath = backup.files.some(file => hasConsecutiveDuplicatePathSegment(file.relativePath));
    if (hasInvalidPath) {
      output.appendLine(`[restore] Backup contains invalid duplicate-folder paths. Purging backup snapshot to prevent re-restore.`);
      await context.workspaceState.update(backupKey, undefined);
      return false;
    }

    output.appendLine(`[restore] Found backup from ${new Date(backup.timestamp).toLocaleString()} with ${backup.files.length} file(s)`);

    // Check if backup has meaningful content (non-empty values)
    const hasContent = backup.files.some(f => hasNonEmptyValues(f.content));
    if (!hasContent) {
      output.appendLine(`[restore] Backup exists but all files have empty values`);
      return false;
    }

    const outputAbs = path.join(workspaceRoot, outputRoot);
    let restored = 0;

    for (const file of backup.files) {
      // Skip if backup file has no meaningful content
      if (!hasNonEmptyValues(file.content)) {
        output.appendLine(`[restore] Skipping backup with empty values: ${file.relativePath}`);
        continue;
      }

      const fileAbs = path.join(outputAbs, file.relativePath);

      // Check if file is missing, empty, or contains only empty values
      let needsRestore = false;
      try {
        const stat = await fs.stat(fileAbs);
        if (stat.size === 0) {
          needsRestore = true;
          output.appendLine(`[restore] File is empty: ${file.relativePath}`);
        } else {
          // Check if file content has only empty values
          try {
            const content = await fs.readFile(fileAbs, 'utf-8');
            const parsed = JSON.parse(content);
            if (!hasNonEmptyValues(parsed)) {
              needsRestore = true;
              output.appendLine(`[restore] File has all empty values: ${file.relativePath}`);
            }
          } catch {
            // If we can't parse it, consider it corrupt and restore
            needsRestore = true;
            output.appendLine(`[restore] File is corrupt: ${file.relativePath}`);
          }
        }
      } catch {
        needsRestore = true;
        output.appendLine(`[restore] File missing: ${file.relativePath}`);
      }

      if (needsRestore) {
        await ensureDir(path.dirname(fileAbs));
        await fs.writeFile(fileAbs, JSON.stringify(file.content, null, 2) + '\n', 'utf-8');
        output.appendLine(`[restore] ✓ Restored ${file.relativePath} from backup`);
        restored++;
      }
    }

    if (restored > 0) {
      output.appendLine(`[restore] Restored ${restored} file(s) from backup (${new Date(backup.timestamp).toLocaleString()})`);
      return true;
    }

    return false;
  } catch (err) {
    output.appendLine(`[restore] Failed to restore default JSON: ${err}`);
    return false;
  }
}

async function detectMissingOrDeletedFiles(
  workspaceRoot: string,
  outputRoot: string,
  baseLocaleCode: string,
  languages: LanguageEntry[],
  output: vscode.OutputChannel
): Promise<{ hasMissingFiles: boolean; missingFiles: string[]; hasEmptyDefaultFiles: boolean; hasIncompleteTranslations: boolean }> {
  const outputAbs = path.join(workspaceRoot, outputRoot);
  const missingFiles: string[] = [];
  let hasEmptyDefaultFiles = false;
  let hasIncompleteTranslations = false;

  try {
    // Get all default language files
    const defaultPattern = new vscode.RelativePattern(outputAbs, `**/${baseLocaleCode}.json`);
    const defaultFiles = await vscode.workspace.findFiles(defaultPattern, '**/node_modules/**');

    if (defaultFiles.length === 0) {
      output.appendLine(`[detection] No default language files found - will attempt restore`);
      return { hasMissingFiles: true, missingFiles: ['default-language-missing'], hasEmptyDefaultFiles: false, hasIncompleteTranslations: false };
    }

    // Check if default files are empty or invalid
    for (const defaultFile of defaultFiles) {
      const fileAbs = defaultFile.fsPath;
      const relativePath = path.relative(outputAbs, fileAbs);

      try {
        const stat = await fs.stat(fileAbs);
        if (stat.size === 0) {
          output.appendLine(`[detection] Default file is empty: ${relativePath}`);
          hasEmptyDefaultFiles = true;
          missingFiles.push(`${relativePath} (empty)`);
        } else {
          // Check if file has meaningful content (non-empty values)
          const content = await fs.readFile(fileAbs, 'utf-8');
          const parsed = JSON.parse(content);
          if (!hasNonEmptyValues(parsed)) {
            output.appendLine(`[detection] Default file has all empty values: ${relativePath}`);
            hasEmptyDefaultFiles = true;
            missingFiles.push(`${relativePath} (all empty values)`);
          }
        }
      } catch (e) {
        output.appendLine(`[detection] Error reading default file ${relativePath}: ${e}`);
        hasEmptyDefaultFiles = true;
      }
    }

    // For each default file, check if corresponding language files exist AND have all properties
    for (const defaultFile of defaultFiles) {
      const dir = path.dirname(defaultFile.fsPath);
      const relativePath = path.relative(outputAbs, dir);

      // Load base language keys for comparison
      let baseKeys: string[] = [];
      try {
        const baseContent = await fs.readFile(defaultFile.fsPath, 'utf-8');
        const baseJson = JSON.parse(baseContent);
        baseKeys = getAllKeys(baseJson);
      } catch (e) {
        output.appendLine(`[detection] Could not load base keys from ${relativePath}/${baseLocaleCode}.json: ${e}`);
      }

      for (const lang of languages) {
        if (!lang.active && lang.code !== baseLocaleCode) continue;

        const langCode = lang.code;
        if (langCode === baseLocaleCode) continue; // Skip comparing base to itself

        const expectedFile = path.join(dir, `${langCode}.json`);

        try {
          await fs.access(expectedFile);

          // File exists - check if it has all properties from base language
          if (baseKeys.length > 0) {
            try {
              const targetContent = await fs.readFile(expectedFile, 'utf-8');
              const targetJson = JSON.parse(targetContent);

              // Check for missing, null, or empty properties
              let missingCount = 0;
              for (const key of baseKeys) {
                const value = getNestedValue(targetJson, key);
                if (value === undefined || value === null || value === "") {
                  missingCount++;
                }
              }

              if (missingCount > 0) {
                output.appendLine(`[detection] ${relativePath}/${langCode}.json has ${missingCount} missing/empty properties`);
                hasIncompleteTranslations = true;
              }
            } catch (e) {
              output.appendLine(`[detection] Error checking properties in ${relativePath}/${langCode}.json: ${e}`);
            }
          }
        } catch {
          missingFiles.push(`${relativePath}/${langCode}.json`);
        }
      }
    }

    if (missingFiles.length > 0) {
      output.appendLine(`[detection] Found ${missingFiles.length} missing translation file(s)`);
      missingFiles.slice(0, 5).forEach(f => output.appendLine(`  - ${f}`));
      if (missingFiles.length > 5) {
        output.appendLine(`  ... and ${missingFiles.length - 5} more`);
      }
    }

    return { hasMissingFiles: missingFiles.length > 0, missingFiles, hasEmptyDefaultFiles, hasIncompleteTranslations };
  } catch (err) {
    output.appendLine(`[detection] Error detecting missing files: ${err}`);
    return { hasMissingFiles: false, missingFiles: [], hasEmptyDefaultFiles: false, hasIncompleteTranslations: false };
  }
}

async function processLocalesAndArtifacts(
  context: vscode.ExtensionContext,
  root: string,
  cfg: ExtConfig,
  found: FoundString[],
  output: vscode.OutputChannel,
  options: ProcessOptions = {}
) {
  output.appendLine(`[angular-i18n] Reading locales list: ${cfg.languagesJsonPath}`);
  const langs = await loadAndNormalizeLanguages(root, cfg.languagesJsonPath);

  // Determine actual base locale code (MUST have a language with default: true)
  const defaultLang = langs.find(l => l.default === true);
  if (!defaultLang) {
    throw new Error(`No language marked with "default": true in ${cfg.languagesJsonPath}. At least one language must be marked as default.`);
  }
  const baseLocaleCode = defaultLang.code;
  output.appendLine(`[angular-i18n] Base locale: ${baseLocaleCode} (from ${defaultLang.englishName})`);

  const previousManagedSnapshot = context.workspaceState.get<ManagedDefaultSnapshot>(MANAGED_DEFAULT_SNAPSHOT_KEY);
  const previousManagedEntries = previousManagedSnapshot?.baseLocaleCode === baseLocaleCode
    ? (previousManagedSnapshot.entries ?? {})
    : {};
  const currentDefaultEntries = await readDefaultLocaleKeyMap(root, cfg.outputRoot, baseLocaleCode);

  const removedManagedKeys = Object.keys(previousManagedEntries).filter(key => !(key in currentDefaultEntries));
  const addedManagedKeys = Object.keys(currentDefaultEntries).filter(key => !(key in previousManagedEntries));
  const hasDefaultKeySetDelta = removedManagedKeys.length > 0 || addedManagedKeys.length > 0;

  if (removedManagedKeys.length > 0) {
    output.appendLine(`[angular-i18n] Detected ${removedManagedKeys.length} key(s) removed from default locale. Will prune and auto-revert references.`);
  }
  if (addedManagedKeys.length > 0) {
    output.appendLine(`[angular-i18n] Detected ${addedManagedKeys.length} key(s) newly added in default locale. Will sync other locale files.`);
  }

  // Check for language changes
  const storedLangs = context.workspaceState.get<LanguageEntry[]>("angular-i18n-languages", []);
  const oldCodes = new Set(storedLangs.map(l => l.code));
  const newCodes = new Set(langs.map(l => l.code));

  // Create map for easy lookup of old language properties
  const oldLangMap = new Map(storedLangs.map(l => [l.code, l]));

  // Check for missing or deleted files BEFORE checking language changes
  const { hasMissingFiles, missingFiles, hasEmptyDefaultFiles, hasIncompleteTranslations } = await detectMissingOrDeletedFiles(
    root,
    cfg.outputRoot,
    baseLocaleCode,
    langs,
    output
  );

  if (hasIncompleteTranslations) {
    output.appendLine(`[angular-i18n] Incomplete translations detected - will regenerate to fill missing properties.`);
  }

  // Try to restore default language if missing or empty
  let wasRestored = false;
  if (hasMissingFiles && (missingFiles.includes('default-language-missing') || hasEmptyDefaultFiles)) {
    const reason = hasEmptyDefaultFiles ? 'contains empty values' : 'missing';
    output.appendLine(`[angular-i18n] Default language files ${reason} - attempting restore from backup...`);
    const restored = await restoreDefaultJson(context, root, cfg.outputRoot, baseLocaleCode, output);
    if (restored) {
      output.appendLine(`[angular-i18n] ✓ Successfully restored default language files from backup`);
      wasRestored = true;
      // If we restored successfully, verify the restored files have content
      // Re-check to ensure restoration was successful
      const recheckResult = await detectMissingOrDeletedFiles(
        root,
        cfg.outputRoot,
        baseLocaleCode,
        langs,
        output
      );
      if (!recheckResult.hasEmptyDefaultFiles) {
        output.appendLine(`[angular-i18n] ✓ Restored files are valid. Will skip regenerating default language.`);
      } else {
        output.appendLine(`[angular-i18n] ⚠ Restored files still appear empty. Will regenerate from source.`);
        wasRestored = false;
      }
    } else {
      output.appendLine(`[angular-i18n] ⚠ Could not restore default language - will regenerate from source code`);
    }
  }

  let hasChanges = false;
  if (oldCodes.size !== newCodes.size) {
    hasChanges = true;
  } else {
    // Check for added/removed languages
    for (const c of oldCodes) {
      if (!newCodes.has(c)) {
        hasChanges = true;
        break;
      }
    }

    // Check for changes in active/default status
    if (!hasChanges) {
      for (const lang of langs) {
        const oldLang = oldLangMap.get(lang.code);
        if (oldLang && (oldLang.active !== lang.active || oldLang.default !== lang.default)) {
          hasChanges = true;
          break;
        }
      }
    }
  }

  // Track if any languages were newly activated
  let hasNewlyActivatedLangs = false;

  if (hasChanges) {
    output.appendLine(`[angular-i18n] 🔄 Language configuration change detected.`);
    const added = langs.filter(l => !oldCodes.has(l.code)).map(l => l.code);
    const removed = storedLangs.filter(l => !newCodes.has(l.code)).map(l => l.code);
    const statusChanged = langs.filter(l => {
      const oldLang = oldLangMap.get(l.code);
      return oldLang && (oldLang.active !== l.active || oldLang.default !== l.default);
    }).map(l => {
      const oldLang = oldLangMap.get(l.code);
      const changes: string[] = [];
      if (oldLang && oldLang.active !== l.active) {
        changes.push(`active: ${oldLang.active} → ${l.active}`);
        // Check if this is a newly activated language
        if (oldLang.active === false && l.active === true) {
          hasNewlyActivatedLangs = true;
        }
      }
      if (oldLang && oldLang.default !== l.default) {
        changes.push(`default: ${oldLang.default} → ${l.default}`);
      }
      return `${l.code} (${changes.join(', ')})`;
    });

    if (added.length) output.appendLine(`  + Added: ${added.join(", ")}`);
    if (removed.length) output.appendLine(`  - Removed: ${removed.join(", ")}`);
    if (statusChanged.length) output.appendLine(`  ~ Status changed: ${statusChanged.join(", ")}`);

    // Update stored state
    await context.workspaceState.update("angular-i18n-languages", langs);
  } else {
    output.appendLine(`[angular-i18n] Language configuration unchanged.`);
  }

  // Early exit if no changes detected
  const nothingNew = found.length === 0 || found.every(s => s.isAlreadyTranslated);

  // Don't skip if: languages were newly activated, files are missing, translations incomplete, or there are changes
  if (!hasChanges && !hasMissingFiles && !hasIncompleteTranslations && !hasDefaultKeySetDelta && nothingNew && (options.forceUpdateMode ?? cfg.updateMode) === "merge") {
    output.appendLine(`[angular-i18n] All strings valid/translated and configuration unchanged. Skipping generation.`);
    return {
      gen: { baseFiles: [], filesProcessed: 0, stringsAdded: 0, keyMapByFile: {} },
      generatedLangs: [],
      baseLocaleCode
    };
  }

  if (hasNewlyActivatedLangs) {
    output.appendLine(`[angular-i18n] Newly activated languages detected - ensuring files are generated.`);
  }

  if (hasMissingFiles) {
    output.appendLine(`[angular-i18n] Missing translation files detected - will regenerate.`);
  }

  const generatedLangs = langs.filter(lang => {
    if (lang.active === true) return true;
    if (lang.code === baseLocaleCode) return true;
    return false;
  });

  output.appendLine(`[angular-i18n] Generating locale JSONs under: ${cfg.outputRoot}`);

  // If we restored valid backup, use merge mode to preserve restored values
  const effectiveUpdateMode = wasRestored ? "merge" : (options.forceUpdateMode ?? cfg.updateMode);
  if (wasRestored) {
    output.appendLine(`[angular-i18n] Using merge mode to preserve restored backup values`);
  }

  const gen = await generatePerFileLocales({
    workspaceRoot: root,
    srcDir: cfg.srcDir,
    outputRoot: cfg.outputRoot,
    baseLocaleCode: baseLocaleCode,
    languages: generatedLangs,
    found,
    updateMode: effectiveUpdateMode,
    pruneKeys: removedManagedKeys,
  });

  if (removedManagedKeys.length > 0) {
    const removedKeyValues = removedManagedKeys.reduce<Record<string, string>>((acc, key) => {
      const value = previousManagedEntries[key];
      if (typeof value === "string" && value.trim().length > 0) {
        acc[key] = value;
      }
      return acc;
    }, {});

    const reverseResult = await reverseTranslateSelectedKeysInWorkspace(
      root,
      cfg.srcDir,
      removedKeyValues,
      cfg.ignoreGlobs,
      output
    );

    if (reverseResult.success > 0 || reverseResult.failed > 0) {
      output.appendLine(`[angular-i18n] Auto-revert completed for removed keys. Success: ${reverseResult.success}, Failed: ${reverseResult.failed}`);
    }
  }

  // Backup default language files immediately after generation
  // Only backup if we actually generated content (not empty values)
  if (gen.stringsAdded > 0) {
    output.appendLine(`[angular-i18n] Backing up default language files with ${gen.stringsAdded} strings...`);
    // Add a small delay to ensure files are written
    await new Promise(resolve => setTimeout(resolve, 100));
    await backupDefaultJson(context, root, cfg.outputRoot, baseLocaleCode, output);
  } else if (gen.filesProcessed > 0 && found.length > 0 && !wasRestored) {
    // Only backup if files were processed, we had strings, AND we didn't just restore
    // (Don't backup immediately after restoring - keep the restored backup)
    output.appendLine(`[angular-i18n] Backing up default language files after processing...`);
    await new Promise(resolve => setTimeout(resolve, 100));
    await backupDefaultJson(context, root, cfg.outputRoot, baseLocaleCode, output);
  } else if (wasRestored) {
    output.appendLine(`[angular-i18n] Skipping backup - using restored backup from earlier`);
  } else {
    output.appendLine(`[angular-i18n] Skipping backup - no new strings were added (strings added: ${gen.stringsAdded}, found: ${found.length})`);
  }

  let replaceResult = { stringsReplaced: 0 };
  if (!options.skipReplacement) {
    replaceResult = await replaceExtractedStrings({
      workspaceRoot: root,
      found,
      keyMapByFile: gen.keyMapByFile,
      bootstrapStyle: cfg.angularBootstrapStyle
    });
  }

  if (!options.skipHeavyOps) {
    const loaderArtifacts = await generateLoaderArtifacts({
      workspaceRoot: root,
      srcDir: cfg.srcDir,
      outputRoot: cfg.outputRoot,
      baseLocaleCode: baseLocaleCode,
      languages: generatedLangs,
      baseFiles: gen.baseFiles,
      updateMode: options.forceUpdateMode ?? cfg.updateMode,
      languagesJsonPath: cfg.languagesJsonPath
    });

    if (loaderArtifacts.packageJsonUpdated) {
      output.appendLine(`[angular-i18n] ✓ Updated package.json scripts`);
    }

    await performAppConfiguration(root, cfg, baseLocaleCode, output);
  }

  const latestDefaultEntries = await readDefaultLocaleKeyMap(root, cfg.outputRoot, baseLocaleCode);
  await context.workspaceState.update(MANAGED_DEFAULT_SNAPSHOT_KEY, {
    baseLocaleCode,
    updatedAt: Date.now(),
    entries: latestDefaultEntries,
  } as ManagedDefaultSnapshot);
  output.appendLine(`[angular-i18n] Managed default snapshot updated (${Object.keys(latestDefaultEntries).length} keys).`);

  output.appendLine(`[angular-i18n] Process complete. Strings added: ${gen.stringsAdded}, Replaced: ${replaceResult.stringsReplaced}`);

  // Auto-translate Logic (omitted here for brevity in refactor but kept in main flow if needed)
  // For extractFile, we might want to run translate.
  // For this Refactor, I am keeping the logic in the main command mostly, but I extracted the core generation/replacement.
  // Actually, I should probably have kept the auto-translate logic in the shared function if we want it for single file too.
  // I will leave it out of this helper for now to avoid complexity and only run it for full scan or explicit translate command.

  return { gen, replaceResult, generatedLangs, baseLocaleCode, langs };
}

async function runExtractionPipeline(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  action: (root: string, cfg: ExtConfig, output: vscode.OutputChannel) => Promise<{ found: FoundString[]; restricted: RestrictedString[] }>,
  options: ProcessOptions = {}
) {
  const root = folder.uri.fsPath;
  const cfg = getConfig();
  const output = vscode.window.createOutputChannel("Angular Translation Extractor");
  output.show(true);

  const normalizeGlob = (value: string) => (value || "").replace(/\\+/g, "/").replace(/^\.\//, "");
  const normalizedSrcDir = normalizeGlob(cfg.srcDir).replace(/\/+$/, "");
  const normalizedSkipGlobs = (cfg.skipGlobs || []).map(normalizeGlob);
  const excludesSourceDir = normalizedSkipGlobs.includes("**/*")
    || normalizedSkipGlobs.includes("src/**")
    || normalizedSkipGlobs.includes(`${normalizedSrcDir}/**`)
    || normalizedSkipGlobs.includes(`${normalizedSrcDir}/**/*`);

  if (excludesSourceDir) {
    const msg = `Extraction is skipped because i18nExtractor.skipGlobs contains a source exclusion (${normalizedSrcDir}/** or **/*). Remove it from settings and run again.`;
    output.appendLine(`[angular-i18n] ${msg}`);
    vscode.window.showWarningMessage(msg);
    return null;
  }

  try {
    output.appendLine(`[angular-i18n] Checking required npm packages...`);
    const packagesOk = await ensurePackagesInstalled(root, output);
    if (!packagesOk) {
      output.appendLine(`[angular-i18n] ⚠ Warning: npm package installation may have failed. Continuing anyway...`);
    }

    const scanResult = await action(root, cfg, output);
    if (!scanResult) {
      return null;
    }

    await writeAggressiveModeRestrictedReport(root, cfg, scanResult.restricted, output);

    const found = scanResult.found;

    const { gen, generatedLangs, baseLocaleCode } = await processLocalesAndArtifacts(context, root, cfg, found, output, options);

    await executeAutoTranslate(cfg, root, baseLocaleCode, generatedLangs, gen.baseFiles, output);
    await runNgBuild(root, output);

    return { gen, generatedLangs, baseLocaleCode, output, root, cfg };

  } catch (err: unknown) {
    const msg = (err as Record<string, unknown>)?.message ? String((err as Record<string, unknown>).message) : String(err);
    vscode.window.showErrorMessage(`Extraction failed: ${msg}`);
    output.appendLine(`[angular-i18n] Failed ❌ ${msg}`);
    throw err;
  }
}

async function writeAggressiveModeRestrictedReport(
  root: string,
  cfg: ExtConfig,
  restricted: RestrictedString[],
  output: vscode.OutputChannel
) {
  try {
    const translateDirAbs = path.join(root, cfg.srcDir, "translate");
    await ensureDir(translateDirAbs);

    const reportPath = path.join(translateDirAbs, "aggressive-mode-restricted.json");
    const report = {
      generatedAt: new Date().toISOString(),
      aggressiveMode: cfg.aggressiveMode,
      totalRestricted: restricted.length,
      restricted: restricted.map(item => ({
        file: item.fileRelFromSrc,
        line: item.line,
        column: item.column,
        text: item.text,
        kind: item.kind,
        reason: item.reason,
        context: item.context
      }))
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    output.appendLine(`[aggressive-mode] Report saved: ${path.relative(root, reportPath)} (${restricted.length} restricted string(s))`);
  } catch (err) {
    output.appendLine(`[aggressive-mode] Failed to write restricted report: ${err}`);
  }
}

async function executeAutoTranslate(
  cfg: ExtConfig,
  root: string,
  baseLocaleCode: string,
  generatedLangs: LanguageEntry[],
  baseFiles: Array<{ baseFileAbs: string; outDirAbs: string; targets: string[] }>,
  output: vscode.OutputChannel
) {
  if (!cfg.autoTranslate) return;

  const mod = await import("./google-translate");
  const translateJsonFile = mod.translateJsonFile;
  output.appendLine(`[auto-translate] Starting Google Translate...`);

  const effectiveBaseLocale = baseLocaleCode;

  for (const baseFile of baseFiles) {
    const { baseFileAbs, outDirAbs } = baseFile;

    for (const lang of generatedLangs) {
      const langCode = lang.code;
      if (langCode === effectiveBaseLocale) continue; // Skip base lang

      if (lang.active === false) {
        output.appendLine(`[auto-translate] Skipping ${lang.code} (active: false)`);
        continue;
      }

      if (!cfg.autoTranslateDefaultLanguage && lang.default === true) {
        continue;
      }

      const targetLocale = lang.code;
      const translationTargetLang = targetLocale;
      const outputFileName = targetLocale;

      try {
        output.appendLine(`[auto-translate] Translating ${path.basename(baseFileAbs)} to ${targetLocale}...`);

        await translateJsonFile({
          inputFile: baseFileAbs,
          outputDir: outDirAbs,
          targetLang: translationTargetLang,
          sourceLang: effectiveBaseLocale,
          outputFileName: outputFileName,
          onProgress: (msg: string) => output.appendLine(`  ${msg}`)
        });

        const delay = Math.max(100, cfg.googleTranslateDelay);
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      } catch (e: unknown) {
        const msg = (e as Error).message || String(e);
        output.appendLine(`[auto-translate] Failed for ${targetLocale}: ${msg}`);
      }
    }
  }
  output.appendLine(`[auto-translate] Completed.`);
}

async function runNgBuild(root: string, output: vscode.OutputChannel) {
  output.appendLine(`[angular-i18n] Running ng build...`);
  try {
    const buildCode = await runTranslateCommand({
      cwd: root,
      command: "ng",
      args: ["build"],
      onStdout: s => output.append(s),
      onStderr: s => output.append(s)
    });

    if (buildCode !== 0) {
      output.appendLine(`[angular-i18n] ng build failed (exit ${buildCode}).`);
    } else {
      output.appendLine(`[angular-i18n] ng build completed.`);
    }
  } catch (err: unknown) {
    output.appendLine(`[angular-i18n] ng build error: ${(err as Record<string, unknown>)?.message || String(err)}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const updatePruneSelectedKeysContext = async (editor?: vscode.TextEditor) => {
    try {
      const currentEditor = editor ?? vscode.window.activeTextEditor;
      if (!currentEditor) {
        await vscode.commands.executeCommand("setContext", "angularTranslation.isDefaultLocaleJsonEditor", false);
        return;
      }

      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        await vscode.commands.executeCommand("setContext", "angularTranslation.isDefaultLocaleJsonEditor", false);
        return;
      }

      const cfg = getConfig();
      const root = folders[0].uri.fsPath;
      const defaultLocaleCode = await getDefaultLocaleCodeFromLanguagesFile(root, cfg.languagesJsonPath);
      if (!defaultLocaleCode) {
        await vscode.commands.executeCommand("setContext", "angularTranslation.isDefaultLocaleJsonEditor", false);
        return;
      }

      const fileName = path.basename(currentEditor.document.uri.fsPath);
      const isJsonDocument = ["json", "jsonc"].includes(currentEditor.document.languageId)
        || path.extname(fileName).toLowerCase() === ".json";
      const isDefaultLocaleJson = isJsonDocument && fileName === `${defaultLocaleCode}.json`;

      await vscode.commands.executeCommand("setContext", "angularTranslation.isDefaultLocaleJsonEditor", isDefaultLocaleJson);
    } catch {
      await vscode.commands.executeCommand("setContext", "angularTranslation.isDefaultLocaleJsonEditor", false);
    }
  };

  void updatePruneSelectedKeysContext();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void updatePruneSelectedKeysContext(editor);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      void updatePruneSelectedKeysContext();
    })
  );

  const disposable = vscode.commands.registerCommand("angularTranslation.extract", async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showErrorMessage("Open a workspace folder first.");
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const activeFile = activeEditor.document.uri.fsPath;
      const activeFileName = path.basename(activeFile);
      const isJsonEditor = ["json", "jsonc"].includes(activeEditor.document.languageId)
        || path.extname(activeFileName).toLowerCase() === ".json";

      if (isJsonEditor) {
        const root = folders[0].uri.fsPath;
        const cfg = getConfig();
        const defaultLocaleCode = await getDefaultLocaleCodeFromLanguagesFile(root, cfg.languagesJsonPath);

        if (defaultLocaleCode) {
          const expectedDefaultFileName = `${defaultLocaleCode}.json`;
          if (activeFileName !== expectedDefaultFileName) {
            vscode.window.showErrorMessage(
              `Extract translations (All app) can only be triggered from the default locale JSON file (${expectedDefaultFileName}) when launched from a JSON editor.`
            );
            return;
          }
        }
      }
    }

    await runExtractionPipeline(context, folders[0], async (root, cfg, output) => {
      output.appendLine(`[angular-i18n] Scanning ${cfg.srcDir}/ (js/ts/html)...`);
      const { found, restricted } = await scanForStrings({ workspaceRoot: root, cfg });
      output.appendLine(`[angular-i18n] Found ${found.length} candidate strings.`);
      output.appendLine(`[angular-i18n] Restricted by aggressiveMode (${cfg.aggressiveMode}): ${restricted.length}`);
      return { found, restricted };
    });

    vscode.window.showInformationMessage("Angular translation extraction completed.");
  });

  const extractFileDisposable = vscode.commands.registerCommand("angularTranslation.extractFile", async (uri?: vscode.Uri) => {
    if (!uri) return;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;

    await runExtractionPipeline(context, folders[0], async (root, cfg, output) => {
      const fileAbs = uri.fsPath;
      const srcAbs = path.join(root, cfg.srcDir);
      const relFromSrc = posixRel(srcAbs, fileAbs);
      output.appendLine(`[extractFile] Processing: ${relFromSrc}`);

      const ext = path.extname(fileAbs).toLowerCase();
      let found: FoundString[] = [];
      const restricted: RestrictedString[] = [];

      if (ext === ".html") {
        found = await extractFromHtml(fileAbs, relFromSrc, cfg.minStringLength, cfg.htmlAttributeNames);
      } else if (ext === ".ts" || ext === ".js") {
        found = await extractFromJsTs(
          fileAbs,
          relFromSrc,
          cfg.minStringLength,
          cfg.htmlAttributeNames,
          cfg.aggressiveMode,
          cfg.aggressiveModeAllowCallRegex,
          cfg.aggressiveModeAllowContextRegex,
          (item) => restricted.push(item)
        );
      }

      if (found.length === 0) {
        output.appendLine(`[extractFile] No strings found in file.`);
      } else {
        vscode.window.showInformationMessage(`Extracted ${found.length} strings from file.`);
      }
      output.appendLine(`[extractFile] Restricted by aggressiveMode (${cfg.aggressiveMode}): ${restricted.length}`);
      return { found, restricted };
    }, { skipHeavyOps: false }); // keep false to ensure config integrity
  });

  const runExtractionForSelection = async (editor: vscode.TextEditor, useParenthesis: boolean = false) => {
    const selection = editor.selection;
    if (selection.isEmpty) return;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;

    const fileAbs = editor.document.uri.fsPath;
    const ext = path.extname(fileAbs).toLowerCase();

    // Prevent extraction inside <style> tags
    if ([".html", ".ts", ".js"].includes(ext)) {
      const docText = editor.document.getText();
      const selectionStart = editor.document.offsetAt(selection.start);
      const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
      let match: RegExpExecArray | null;
      while ((match = styleRegex.exec(docText)) !== null) {
        if (selectionStart >= match.index && selectionStart < match.index + match[0].length) {
          vscode.window.showErrorMessage("Cannot extract text inside <style> tags.");
          return;
        }
      }
    }

    let range = new vscode.Range(selection.start, selection.end);
    let startOffset = editor.document.offsetAt(selection.start);
    let endOffset = editor.document.offsetAt(selection.end);
    const docText = editor.document.getText();

    // Check availability of quotes expansion
    if ((ext === ".ts" || ext === ".js") && startOffset > 0 && endOffset < docText.length) {
      const charBefore = docText[startOffset - 1];
      const charAfter = docText[endOffset];
      if (["'", '"', '`'].includes(charBefore) && charBefore === charAfter) {
        range = new vscode.Range(editor.document.positionAt(startOffset - 1), editor.document.positionAt(endOffset + 1));
      }
    }

    const rawText = editor.document.getText(range);
    let extractedText = rawText.trim();
    // Strip surrounding quotes if present
    if (extractedText.length >= 2) {
      const first = extractedText[0];
      const last = extractedText[extractedText.length - 1];
      if (["'", '"', '`'].includes(first) && first === last) {
        extractedText = extractedText.slice(1, -1);
      }
    }

    let kind = ext === ".html" ? "html-text" : "js-string";
    // Check for inline template in TS files using ts-morph
    if (ext === ".ts" || ext === ".js") {
      const selectionStart = editor.document.offsetAt(selection.start);
      try {
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile("temp.ts", docText);
        const componentClass = sourceFile.getClasses().find(c => c.getDecorator("Component"));

        let componentDecoratorObject: any;
        if (componentClass) {
          const decorator = componentClass.getDecorator("Component");
          const args = decorator?.getArguments();
          if (args && args.length > 0 && args[0].getKind() === SyntaxKind.ObjectLiteralExpression) {
            componentDecoratorObject = args[0];
          }
        }

        if (componentDecoratorObject) {
          const templateProp = componentDecoratorObject.getProperty("template");
          if (templateProp?.getKind() === SyntaxKind.PropertyAssignment) {
            const init = templateProp.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
            if (init) {
              const iStart = init.getStart();
              const iEnd = init.getEnd();
              if (selectionStart >= iStart && selectionStart < iEnd) {
                const k = init.getKind();
                if ([SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.TemplateExpression].includes(k)) {
                  kind = "html-text";
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn("ts-morph check failed:", e);
      }
    }

    const found: FoundString = {
      fileAbs,
      fileRelFromSrc: posixRel(path.join(folders[0].uri.fsPath, getConfig().srcDir), fileAbs),
      kind: kind as "html-text" | "js-string",
      line: range.start.line + 1,
      column: range.start.character,
      text: extractedText,
      rawText: rawText
    };

    const result = await runExtractionPipeline(context, folders[0], async () => ({ found: [found], restricted: [] }), {
      skipReplacement: true,
      forceUpdateMode: "merge"
    });

    if (result) {
      const keyMap = result.gen.keyMapByFile[fileAbs];
      // Try exact match or rawText as fallback
      // Fallback: try rawText if text lookup fails.
      // Sometimes whitespace normalization in pipeline differs from selection.
      let key = keyMap ? keyMap[found.text] : undefined;
      if (!key && keyMap && found.rawText) {
        key = keyMap[found.rawText];
      }
      // If still not found, try without quotes if rawText had them
      if (!key && keyMap && found.rawText) {
        const stripped = found.rawText.replace(/^['"`]|['"`]$/g, '');
        key = keyMap[stripped];
      }

      if (key) {
        await editor.edit(editBuilder => {
          let replacement = "";
          if (useParenthesis) {
            replacement = `( '${key}' | translate )`;
          } else {
            if (ext === ".ts") {
              replacement = `this.translate.instant('${key}')`;
            } else {
              // html
              replacement = `{{ '${key}' | translate }}`;
            }
          }
          editBuilder.replace(range, replacement);
        });

        await editor.document.save();

        if (ext === ".ts") {
          try {
            await ensureComponentStructure(fileAbs, result.cfg.angularBootstrapStyle);
          } catch (e) { console.error(e); }
        }
        else if (ext === ".html" && result.cfg.angularBootstrapStyle === "standalone") {
          const potTs = fileAbs.replace(/\.html$/, ".ts");
          try {
            await fs.access(potTs);
            await addTranslateModuleImport(potTs, true);
          } catch (e) { console.error(e); }
        }

        vscode.window.showInformationMessage(`Extracted to key '${key}'`);
      } else {
        result.output.appendLine(`[extractSelection] Failed to find key for text: "${found.text}"`);
        if (keyMap) {
          result.output.appendLine(`[extractSelection] Available keys for file: ${JSON.stringify(Object.keys(keyMap))}`);
        }
        vscode.window.showErrorMessage(`Could not generate key for selection. Check Output for details.`);
      }
    }
  };

  const extractSelectionDisposable = vscode.commands.registerCommand("angularTranslation.extractSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) await runExtractionForSelection(editor, false);
  });

  const extractSelectionParenthesisDisposable = vscode.commands.registerCommand("angularTranslation.extractSelectionParenthesis", async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) await runExtractionForSelection(editor, true);
  });

  context.subscriptions.push(disposable, extractFileDisposable, extractSelectionDisposable, extractSelectionParenthesisDisposable);



  // Register reverse translation from folder
  const reverseFromFolderDisposable = vscode.commands.registerCommand(
    "angularTranslation.reverseFromFolder",
    async (folderUri: vscode.Uri) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        vscode.window.showErrorMessage("Open a workspace folder first.");
        return;
      }

      const root = folders[0].uri.fsPath;
      const cfg = getConfig();
      const folderPath = folderUri?.fsPath || root;

      const output = vscode.window.createOutputChannel(
        "Angular Translation Reverse"
      );
      output.show(true);

      const restoreConsole = captureConsoleLogs(output);

      try {
        // Load languages to get baseLocaleCode
        const langs = await loadAndNormalizeLanguages(root, cfg.languagesJsonPath);
        const defaultLang = langs.find(l => l.default === true);
        if (!defaultLang) {
          throw new Error(`No language marked with "default": true in ${cfg.languagesJsonPath}`);
        }
        const baseLocaleCode = defaultLang.code;

        output.appendLine(
          `[angular-i18n-reverse] Starting reverse translation for folder: ${folderPath}`
        );
        output.appendLine(
          `[angular-i18n-reverse] Base locale code: ${baseLocaleCode}`
        );

        const result = await reverseTranslateFolderScope(
          folderPath,
          root,
          path.join(root, cfg.srcDir),
          path.join(root, cfg.outputRoot),
          cfg.languagesJsonPath,
          baseLocaleCode,
          cfg.ignoreGlobs,
          { appendLine: (msg: string) => output.appendLine(msg) }
        );

        output.appendLine(
          `[angular-i18n-reverse] Completed: ${result.success} replacements made`
        );
        if (result.failed > 0) {
          output.appendLine(
            `[angular-i18n-reverse] ${result.failed} replacements failed`
          );
        }

        if (result.errors.length > 0) {
          output.appendLine("[angular-i18n-reverse] Errors:");
          result.errors.forEach((err: string) =>
            output.appendLine(`  - ${err}`)
          );
        }

        vscode.window.showInformationMessage(
          `Reverse translation completed: ${result.success} replacements made`
        );
      } catch (err: unknown) {
        const msg = (err as Record<string, unknown>)?.message ? String((err as Record<string, unknown>).message) : String(err);
        vscode.window.showErrorMessage(
          `Reverse translation failed: ${msg}`
        );
        output.appendLine(`[angular-i18n-reverse] Failed ❌ ${msg}`);
      } finally {
        restoreConsole();
      }
    }
  );

  context.subscriptions.push(reverseFromFolderDisposable);

  // Register reverse translation from file
  const reverseFromFileDisposable = vscode.commands.registerCommand(
    "angularTranslation.reverseFromFile",
    async (fileUri: vscode.Uri) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        vscode.window.showErrorMessage("Open a workspace folder first.");
        return;
      }

      const root = folders[0].uri.fsPath;
      const cfg = getConfig();
      const filePath = fileUri?.fsPath;

      if (!filePath) {
        vscode.window.showErrorMessage("No file selected.");
        return;
      }

      const output = vscode.window.createOutputChannel(
        "Angular Translation Reverse"
      );
      output.show(true);

      const restoreConsole = captureConsoleLogs(output);

      try {
        // Load languages to get baseLocaleCode
        const langs = await loadAndNormalizeLanguages(root, cfg.languagesJsonPath);
        const defaultLang = langs.find(l => l.default === true);
        if (!defaultLang) {
          throw new Error(`No language marked with "default": true in ${cfg.languagesJsonPath}`);
        }
        const baseLocaleCode = defaultLang.code;

        output.appendLine(
          `[angular-i18n-reverse] Starting reverse translation for file: ${filePath}`
        );
        output.appendLine(
          `[angular-i18n-reverse] Base locale code: ${baseLocaleCode}`
        );

        const result = await reverseTranslateFileScope(
          filePath,
          root,
          path.join(root, cfg.srcDir),
          path.join(root, cfg.outputRoot),
          cfg.languagesJsonPath,
          baseLocaleCode,
          cfg.ignoreGlobs,
          { appendLine: (msg: string) => output.appendLine(msg) }
        );

        output.appendLine(
          `[angular-i18n-reverse] Completed: ${result.success} replacements made`
        );
        if (result.failed > 0) {
          output.appendLine(
            `[angular-i18n-reverse] ${result.failed} replacements failed`
          );
        }

        if (result.errors.length > 0) {
          output.appendLine("[angular-i18n-reverse] Errors:");
          result.errors.forEach((err: string) =>
            output.appendLine(`  - ${err}`)
          );
        }

        vscode.window.showInformationMessage(
          `Reverse translation completed: ${result.success} replacements made`
        );
      } catch (err: unknown) {
        const msg = (err as Record<string, unknown>)?.message ? String((err as Record<string, unknown>).message) : String(err);
        vscode.window.showErrorMessage(
          `Reverse translation failed: ${msg}`
        );
        output.appendLine(`[angular-i18n-reverse] Failed ❌ ${msg}`);
      } finally {
        restoreConsole();
      }
    }
  );

  context.subscriptions.push(reverseFromFileDisposable);

  // Register reverse translation from selection
  const reverseSelectionDisposable = vscode.commands.registerCommand(
    "angularTranslation.reverseSelection",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        vscode.window.showErrorMessage("Open a workspace folder first.");
        return;
      }

      const root = folders[0].uri.fsPath;
      const cfg = getConfig();
      const filePath = editor.document.uri.fsPath;
      const selection = editor.selection;

      const output = vscode.window.createOutputChannel(
        "Angular Translation Reverse"
      );
      output.show(true);

      const restoreConsole = captureConsoleLogs(output);

      try {
        // Load languages to get baseLocaleCode
        const langs = await loadAndNormalizeLanguages(root, cfg.languagesJsonPath);
        const defaultLang = langs.find(l => l.default === true);
        if (!defaultLang) {
          throw new Error(`No language marked with "default": true in ${cfg.languagesJsonPath}`);
        }
        const baseLocaleCode = defaultLang.code;

        output.appendLine(
          `[angular-i18n-reverse] Starting reverse translation for selection in: ${filePath}`
        );

        const result = await reverseTranslateSelectionScope(
          filePath,
          {
            startLine: selection.start.line + 1,
            startCol: selection.start.character + 1,
            endLine: selection.end.line + 1,
            endCol: selection.end.character + 1,
          },
          root,
          path.join(root, cfg.srcDir),
          path.join(root, cfg.outputRoot),
          cfg.languagesJsonPath,
          baseLocaleCode,
          cfg.ignoreGlobs,
          { appendLine: (msg: string) => output.appendLine(msg) }
        );

        output.appendLine(
          `[angular-i18n-reverse] Completed: ${result.success} replacements made`
        );

        if (result.success > 0 || result.failed > 0) {
          vscode.window.showInformationMessage(
            `Reverse translation completed: ${result.success} replacements made`
          );
        } else {
          vscode.window.showInformationMessage("No translatable keys found in selection.");
        }

      } catch (err: unknown) {
        const msg = (err as Record<string, unknown>)?.message ? String((err as Record<string, unknown>).message) : String(err);
        vscode.window.showErrorMessage(
          `Reverse translation failed: ${msg}`
        );
      } finally {
        restoreConsole();
      }
    }
  );

  context.subscriptions.push(reverseSelectionDisposable);

  const pruneSelectedKeysDisposable = vscode.commands.registerCommand(
    "angularTranslation.pruneSelectedKeys",
    async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        vscode.window.showErrorMessage("Open a workspace folder first.");
        return;
      }

      const root = folders[0].uri.fsPath;
      const cfg = getConfig();
      const output = vscode.window.createOutputChannel("Angular Translation Extractor");
      output.show(true);

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Open the default JSON file and select properties to prune.");
        return;
      }

      if (editor.selection.isEmpty) {
        vscode.window.showErrorMessage("Select a JSON text range with properties to prune.");
        return;
      }

      const currentFile = editor.document.uri.fsPath;
      if (path.extname(currentFile).toLowerCase() !== ".json") {
        vscode.window.showErrorMessage("Prune Selected Keys can only run from a JSON file.");
        return;
      }

      try {
        const langs = await loadAndNormalizeLanguages(root, cfg.languagesJsonPath);
        const defaultLang = langs.find(l => l.default === true);
        if (!defaultLang) {
          throw new Error(`No language marked with "default": true in ${cfg.languagesJsonPath}.`);
        }

        const baseLocaleCode = defaultLang.code;
        const expectedDefaultFileName = `${baseLocaleCode}.json`;
        const currentFileName = path.basename(currentFile);

        if (currentFileName !== expectedDefaultFileName) {
          vscode.window.showErrorMessage(
            `Prune Selected Keys can only be executed from the default locale file (${expectedDefaultFileName}).`
          );
          return;
        }

        const defaultEntries = await readDefaultLocaleKeyMap(root, cfg.outputRoot, baseLocaleCode);
        const allKeys = Object.keys(defaultEntries).sort((a, b) => a.localeCompare(b));

        if (allKeys.length === 0) {
          vscode.window.showInformationMessage("No keys found in default locale JSON.");
          return;
        }

        const selectedText = editor.document.getText(editor.selection);
        const selectedKeys = resolveDefaultKeysFromSelectedJsonRange(selectedText, allKeys);

        if (selectedKeys.length === 0) {
          vscode.window.showErrorMessage("No translation properties were detected in the selected JSON range.");
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Remove ${selectedKeys.length} key(s) from locale files and auto-revert usages in source files?`,
          { modal: true },
          "Remove"
        );

        if (confirm !== "Remove") {
          return;
        }

        output.appendLine(`[angular-i18n] Manual prune started for ${selectedKeys.length} key(s).`);

        const selectedKeyValues = selectedKeys.reduce<Record<string, string>>((acc, key) => {
          const value = defaultEntries[key];
          if (typeof value === "string" && value.trim().length > 0) {
            acc[key] = value;
          }
          return acc;
        }, {});

        const reverseResult = await reverseTranslateSelectedKeysInWorkspace(
          root,
          cfg.srcDir,
          selectedKeyValues,
          cfg.ignoreGlobs,
          output
        );

        const localeCodes = Array.from(new Set(langs.map(l => l.code)));
        const pruneResult = await pruneSelectedKeysFromLocaleFiles(
          root,
          cfg.outputRoot,
          baseLocaleCode,
          localeCodes,
          selectedKeys
        );

        await backupDefaultJson(context, root, cfg.outputRoot, baseLocaleCode, output);

        const latestDefaultEntries = await readDefaultLocaleKeyMap(root, cfg.outputRoot, baseLocaleCode);
        await context.workspaceState.update(MANAGED_DEFAULT_SNAPSHOT_KEY, {
          baseLocaleCode,
          updatedAt: Date.now(),
          entries: latestDefaultEntries,
        } as ManagedDefaultSnapshot);

        output.appendLine(`[angular-i18n] Manual prune complete. Files updated: ${pruneResult.filesUpdated}, keys removed: ${pruneResult.keysRemoved}.`);
        output.appendLine(`[angular-i18n] Auto-revert result. Success: ${reverseResult.success}, Failed: ${reverseResult.failed}.`);
        output.appendLine(`[angular-i18n] Managed default snapshot updated (${Object.keys(latestDefaultEntries).length} keys).`);

        await runNgBuild(root, output);

        vscode.window.showInformationMessage(
          `Removed ${selectedKeys.length} key(s). Reverted ${reverseResult.success} occurrence(s) in source.`
        );
      } catch (err: unknown) {
        const msg = (err as Record<string, unknown>)?.message ? String((err as Record<string, unknown>).message) : String(err);
        output.appendLine(`[angular-i18n] Manual prune failed ❌ ${msg}`);
        vscode.window.showErrorMessage(`Prune selected keys failed: ${msg}`);
      }
    }
  );

  context.subscriptions.push(pruneSelectedKeysDisposable);

  const excludeWorkspacePathDisposable = vscode.commands.registerCommand(
    "angularTranslation.excludeWorkspacePath",
    async (uri?: vscode.Uri) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        vscode.window.showErrorMessage("Open a workspace folder first.");
        return;
      }

      const workspaceFolder = folders[0];
      const root = workspaceFolder.uri.fsPath;

      const targetPath = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!targetPath) {
        vscode.window.showErrorMessage("Select a file or folder to exclude from extraction.");
        return;
      }

      const normalizedRoot = path.resolve(root);
      const normalizedTarget = path.resolve(targetPath);
      const rel = path.relative(normalizedRoot, normalizedTarget);

      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        vscode.window.showErrorMessage("Selected path is outside the current workspace.");
        return;
      }

      let stat: fsSync.Stats;
      try {
        stat = fsSync.statSync(normalizedTarget);
      } catch {
        vscode.window.showErrorMessage("Could not read the selected path.");
        return;
      }

      const toPosix = (value: string) => value.split(path.sep).join("/");
      const relPosix = toPosix(rel);
      const skipGlob = relPosix === "" ? "**/*" : (stat.isDirectory() ? `${relPosix}/**` : relPosix);

      if (skipGlob === "**/*") {
        const confirm = await vscode.window.showWarningMessage(
          "This will exclude the entire workspace from extraction. Continue?",
          { modal: true },
          "Exclude"
        );
        if (confirm !== "Exclude") {
          return;
        }
      }

      const config = vscode.workspace.getConfiguration("i18nExtractor", workspaceFolder.uri);
      const current = config.get<string[]>("skipGlobs", []);

      if (current.includes(skipGlob)) {
        const stateKeys = context.workspaceState.keys();
        const confirmClear = await vscode.window.showWarningMessage(
          `Path is already excluded: ${skipGlob}. Remove ${stateKeys.length} workspace state item(s)?`,
          { modal: true },
          "Remove"
        );

        if (confirmClear === "Remove") {
          const cleared = await clearAllI18nWorkspaceState(context, workspaceFolder);
          vscode.window.showInformationMessage(`i18n workspace state cleared (${cleared} item(s)).`);
          return;
        }

        vscode.window.showInformationMessage(`Path is already excluded: ${skipGlob}`);
        return;
      }

      const updated = [...current, skipGlob];
      await config.update("skipGlobs", updated, vscode.ConfigurationTarget.Workspace);

      if (skipGlob === "**/*") {
        const stateKeys = context.workspaceState.keys();
        const confirmClear = await vscode.window.showWarningMessage(
          `Remove ${stateKeys.length} workspace state item(s) while excluding the entire workspace?`,
          { modal: true },
          "Remove"
        );
        if (confirmClear === "Remove") {
          const cleared = await clearAllI18nWorkspaceState(context, workspaceFolder);
          vscode.window.showInformationMessage(`Excluded from extraction: **/* (cleared ${cleared} workspaceState item(s))`);
          return;
        }

        vscode.window.showInformationMessage("Excluded from extraction: **/* (workspaceState preserved)");
        return;
      }

      vscode.window.showInformationMessage(`Excluded from extraction: ${skipGlob}`);
    }
  );

  context.subscriptions.push(excludeWorkspacePathDisposable);

  const clearWorkspaceStateDisposable = vscode.commands.registerCommand(
    "angularTranslation.clearWorkspaceState",
    async (uri?: vscode.Uri) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        vscode.window.showErrorMessage("Open a workspace folder first.");
        return;
      }

      const workspaceFolder = uri ? vscode.workspace.getWorkspaceFolder(uri) ?? folders[0] : folders[0];
      const _root = workspaceFolder.uri.fsPath;

      const stateKeys = context.workspaceState.keys();

      const confirm = await vscode.window.showWarningMessage(
        `Remove ${stateKeys.length} workspace state item(s)? This cannot be undone.`,
        { modal: true },
        "Remove"
      );

      if (confirm !== "Remove") return;

      const cleared = await clearAllI18nWorkspaceState(context, workspaceFolder);
      vscode.window.showInformationMessage(`i18n workspace state cleared (${cleared} item(s)).`);
    }
  );

  context.subscriptions.push(clearWorkspaceStateDisposable);

  async function clearAllI18nWorkspaceState(context: vscode.ExtensionContext, _workspaceFolder: vscode.WorkspaceFolder): Promise<number> {
    const keys = context.workspaceState.keys();
    for (const k of keys) {
      try {
        // Clear key
        await context.workspaceState.update(k, undefined);
      } catch {
        // ignore individual failures
      }
    }
    return keys.length;
  }

  // Register insert Language Selector command
  const insertSelectorDisposable = vscode.commands.registerCommand(
    "angularTranslation.insertSelector",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const currentFile = editor.document.uri.fsPath;

      // 1. Insert snippet at cursor
      const snippet = `<tg-language-selector mode="white"></tg-language-selector>`;
      await editor.insertSnippet(new vscode.SnippetString(snippet));

      // 2. Find associated TS file
      // Expecting standard Angular naming: name.component.html -> name.component.ts
      let targetTsFile: string | null = null;
      if (currentFile.endsWith(".html")) {
        const potentialTs = currentFile.replace(/\.html$/, ".ts");
        try {
          await fs.access(potentialTs);
          targetTsFile = potentialTs;
        } catch {
          // If TS file doesn't exist, we can't add imports
          return;
        }
      } else {
        // Should not happen due to 'when' clause, but safe check
        return;
      }

      if (!targetTsFile) return;

      // 3. Find TgLanguageSelectorComponent in workspace
      const files = await vscode.workspace.findFiles("**/tg-language-selector.component.ts", "**/node_modules/**", 1);
      if (files.length === 0) {
        // Silent fail or warning? User asked to "include the import", implying they expect it to work if present.
        // If not present, maybe they haven't generated it yet.
        return;
      }

      const selectorFile = files[0].fsPath;

      // 4. Calculate relative import path
      const tsDir = path.dirname(targetTsFile);
      let relativePath = path.relative(tsDir, selectorFile);

      if (!relativePath.startsWith(".")) {
        relativePath = "./" + relativePath;
      }
      // Normalize slashes
      relativePath = relativePath.split(path.sep).join(path.posix.sep);

      // 5. Add import and component config
      try {
        await addLanguageSelectorComponent(targetTsFile, relativePath);
      } catch (err: unknown) {
        const msg = (err as Record<string, unknown>)?.message ? String((err as Record<string, unknown>).message) : String(err);
        console.error(`[angular-i18n] Failed to add selector import: ${msg}`);
        vscode.window.showWarningMessage(`Failed to add selector import: ${msg}`);
      }
    }
  );
  context.subscriptions.push(insertSelectorDisposable);
}

export function deactivate() { }
