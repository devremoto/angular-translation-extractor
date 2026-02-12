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
import { LanguageEntry, FoundString } from "./types";
import { normalizeLanguages } from "./langMeta";
import { ensureDir, readJsonIfExists, posixRel } from "./utils";
import { generatePerFileLocales } from "./generate";
import { generateLoaderArtifacts, updateManifest } from "./loader-generator";
import { replaceExtractedStrings, ensureComponentStructure, addTranslateModuleImport } from "./replaceSource";
import { updateMainTs } from "./updateMainTs";
import { updateEnvironment } from "./updateEnvironment";
import { runTranslateCommand } from "./translate";
import { updateAngularJson } from "./updateAngularJson";
import { captureConsoleLogs } from "./console-capture";
import { reverseTranslateFileScope, reverseTranslateFolderScope, reverseTranslateSelectionScope } from './reverse';
import { extractFromJsTs } from "./extractJsTs";
import { extractFromHtml } from "./extractHtml";



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

  const msg = `Missing required packages: ${missingPackages.join(", ")}. Install them now?`;
  const result = await vscode.window.showWarningMessage(msg, "Install", "Ignore");

  if (result === "Install") {
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

  output.appendLine(`[angular-i18n] ⚠ Could not verify installation of: ${missingPackages.join(", ")}`);
  output.appendLine(`[angular-i18n] This warning is safe to ignore if you know they are installed or if you are in a non-standard environment.`);

  return true;
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

  // 3. Environment files
  try {
    await updateEnvironment({
      workspaceRoot: root,
      srcDir: cfg.srcDir,
      enableTransalationCache: cfg.enableTransalationCache
    });
  } catch (err) {
    output.appendLine(`[angular-i18n] ⚠ Could not update environment: ${err}`);
  }
}

async function processLocalesAndArtifacts(
  root: string,
  cfg: ExtConfig,
  found: FoundString[],
  output: vscode.OutputChannel,
  skipHeavyOps: boolean = false
) {
  output.appendLine(`[angular-i18n] Reading locales list: ${cfg.languagesJsonPath}`);
  const langs = await loadAndNormalizeLanguages(root, cfg.languagesJsonPath);

  const defaultLang = normalizeLanguages(langs).find(l => l.default === true)?.code;
  const baseLocaleCode = defaultLang ?? cfg.baseLocaleCode;

  const generatedLangs = langs.filter(lang => {
    if (lang.active === true) return true;
    if (lang.code === baseLocaleCode) return true;
    if (!cfg.onlyGenerateActiveLangs) return true;
    return false;
  });

  // Update manifest (lightweight)
  try {
    await updateManifest({
      workspaceRoot: root,
      outputRoot: cfg.outputRoot,
      baseLocaleCode: baseLocaleCode,
      languages: langs,
      onlyMainLanguages: cfg.onlyMainLanguages
    });
  } catch (err) {
    output.appendLine(`[angular-i18n] ⚠ Failed to pre-update manifest: ${err}`);
  }

  output.appendLine(`[angular-i18n] Generating locale JSONs under: ${cfg.outputRoot}`);
  const gen = await generatePerFileLocales({
    workspaceRoot: root,
    srcDir: cfg.srcDir,
    outputRoot: cfg.outputRoot,
    baseLocaleCode: baseLocaleCode,
    languages: generatedLangs,
    found,
    updateMode: cfg.updateMode,
    onlyMainLanguages: cfg.onlyMainLanguages,
    singleFilePerLanguage: cfg.singleFilePerLanguage
  });

  const replaceResult = await replaceExtractedStrings({
    workspaceRoot: root,
    found,
    keyMapByFile: gen.keyMapByFile,
    bootstrapStyle: cfg.angularBootstrapStyle
  });

  if (!skipHeavyOps) {
    const loaderArtifacts = await generateLoaderArtifacts({
      workspaceRoot: root,
      srcDir: cfg.srcDir,
      outputRoot: cfg.outputRoot,
      baseLocaleCode: baseLocaleCode,
      languages: generatedLangs,
      baseFiles: gen.baseFiles,
      updateMode: cfg.updateMode,
      onlyMainLanguages: cfg.onlyMainLanguages,
      singleFilePerLanguage: cfg.singleFilePerLanguage,
      enableTransalationCache: cfg.enableTransalationCache,
      languagesJsonPath: cfg.languagesJsonPath
    });

    if (loaderArtifacts.packageJsonUpdated) {
      output.appendLine(`[angular-i18n] ✓ Updated package.json scripts`);
    }

    await performAppConfiguration(root, cfg, baseLocaleCode, output);
  }

  output.appendLine(`[angular-i18n] Process complete. Strings added: ${gen.stringsAdded}, Replaced: ${replaceResult.stringsReplaced}`);

  // Auto-translate Logic (omitted here for brevity in refactor but kept in main flow if needed)
  // For extractFile, we might want to run translate.
  // For this Refactor, I am keeping the logic in the main command mostly, but I extracted the core generation/replacement.
  // Actually, I should probably have kept the auto-translate logic in the shared function if we want it for single file too.
  // I will leave it out of this helper for now to avoid complexity and only run it for full scan or explicit translate command.

  return { gen, replaceResult, generatedLangs, baseLocaleCode, langs };
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

  if (cfg.translationService !== "google" && cfg.translationService !== "libretranslate") {
    if (cfg.useTranslateCommand) {
      // Fallback to command line translation
      // for (const bf of baseFiles) {
      //   for (const targetLocale of generatedLangs.map(l => l.code)) {
      //     if (targetLocale === baseLocaleCode) continue;
      //     // Basic support for custom command in selection/file mode
      //     // We reuse the logic from main flow if possible, but for now focusing on the services
      //   }
      // }
    }
    return;
  }

  // Dynamic imports

  let translateJsonFile: any;
  if (cfg.translationService === "google") {
    const mod = await import("./google-translate");
    translateJsonFile = mod.translateJsonFile;
  } else {
    const mod = await import("./libretranslate");
    translateJsonFile = mod.translateJsonFile;
  }

  const serviceName = cfg.translationService === "google" ? "Google Translate" : "LibreTranslate";
  output.appendLine(`[auto-translate] Starting ${serviceName}...`);

  const effectiveBaseLocale = cfg.onlyMainLanguages
    ? baseLocaleCode.split("-")[0]
    : baseLocaleCode;

  for (const baseFile of baseFiles) {
    const { baseFileAbs, outDirAbs } = baseFile;

    for (const lang of generatedLangs) {
      const langCode = cfg.onlyMainLanguages ? lang.code.split("-")[0] : lang.code;
      if (langCode === effectiveBaseLocale) continue; // Skip base lang

      if (lang.active === false) {
        output.appendLine(`[auto-translate] Skipping ${lang.code} (active: false)`);
        continue;
      }

      if (!cfg.autoTranslateDefaultLanguage && lang.default === true) {
        continue;
      }

      const targetLocale = lang.code;
      const translationTargetLang = cfg.onlyMainLanguages ? targetLocale.split("-")[0] : targetLocale;
      const outputFileName = cfg.onlyMainLanguages ? translationTargetLang : targetLocale;

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
  const disposable = vscode.commands.registerCommand("angularTranslation.extract", async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showErrorMessage("Open a workspace folder first.");
      return;
    }

    const root = folders[0].uri.fsPath;
    const cfg = getConfig();

    const output = vscode.window.createOutputChannel("Angular Translation Extractor");
    output.show(true);

    try {
      // Ensure required npm packages are installed
      output.appendLine(`[angular-i18n] Checking required npm packages...`);
      const packagesOk = await ensurePackagesInstalled(root, output);
      if (!packagesOk) {
        output.appendLine(`[angular-i18n] ⚠ Warning: npm package installation may have failed. Continuing anyway...`);
      }

      output.appendLine(`[angular-i18n] Scanning ${cfg.srcDir}/ (js/ts/html)...`);
      const found = await scanForStrings({ workspaceRoot: root, cfg });
      output.appendLine(`[angular-i18n] Found ${found.length} candidate strings.`);

      const { gen, generatedLangs, baseLocaleCode } = await processLocalesAndArtifacts(root, cfg, found, output, false);

      await executeAutoTranslate(cfg, root, baseLocaleCode, generatedLangs, gen.baseFiles, output);

      await runNgBuild(root, output);

      vscode.window.showInformationMessage("Angular translation extraction completed.");
    } catch (err: unknown) {
      const msg = (err as Record<string, unknown>)?.message ? String((err as Record<string, unknown>).message) : String(err);
      vscode.window.showErrorMessage(`Angular translation extraction failed: ${msg}`);
      output.appendLine(`[angular-i18n] Failed ❌ ${msg}`);
    }
  });

  const extractFileDisposable = vscode.commands.registerCommand("angularTranslation.extractFile", async (uri?: vscode.Uri) => {
    if (!uri) return;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;
    const root = folders[0].uri.fsPath;
    const cfg = getConfig();
    const output = vscode.window.createOutputChannel("Angular Translation Extractor");
    output.show(true);

    try {
      // Ensure required npm packages are installed
      output.appendLine(`[angular-i18n] Checking required npm packages...`);
      const packagesOk = await ensurePackagesInstalled(root, output);
      if (!packagesOk) {
        output.appendLine(`[angular-i18n] ⚠ Warning: npm package installation may have failed. Continuing anyway...`);
      }

      const fileAbs = uri.fsPath;
      const srcAbs = path.join(root, cfg.srcDir);
      const relFromSrc = posixRel(srcAbs, fileAbs);

      output.appendLine(`[extractFile] Processing: ${relFromSrc}`);

      let found: FoundString[] = [];
      const ext = path.extname(fileAbs).toLowerCase();

      if (ext === ".html") {
        found = await extractFromHtml(fileAbs, relFromSrc, cfg.minStringLength, cfg.htmlAttributeNames);
      } else if (ext === ".ts" || ext === ".js") {
        found = await extractFromJsTs(fileAbs, relFromSrc, cfg.minStringLength, cfg.htmlAttributeNames);
      }

      if (found.length === 0) {
        output.appendLine(`[extractFile] No strings found in file.`);
        return;
      }

      // We set skipHeavyOps to false to ensure main.ts and config are updated even for single file
      // This ensures providers are present if this is the first time running extraction
      const { gen, generatedLangs, baseLocaleCode } = await processLocalesAndArtifacts(root, cfg, found, output, false);

      await executeAutoTranslate(cfg, root, baseLocaleCode, generatedLangs, gen.baseFiles, output);
      await runNgBuild(root, output);

      vscode.window.showInformationMessage(`Extracted ${found.length} strings from file.`);
    } catch (e: unknown) {
      const msg = (e as Error).message || String(e);
      vscode.window.showErrorMessage(`Extraction failed: ${msg}`);
    }
  });

  const extractSelectionDisposable = vscode.commands.registerCommand("angularTranslation.extractSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const selection = editor.selection;
    if (selection.isEmpty) return;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;
    const root = folders[0].uri.fsPath;
    const cfg = getConfig();

    const fileAbs = editor.document.uri.fsPath;
    const srcAbs = path.join(root, cfg.srcDir);
    const fileRelFromSrc = posixRel(srcAbs, fileAbs);
    const ext = path.extname(fileAbs).toLowerCase();

    let range = new vscode.Range(selection.start, selection.end);
    let text = editor.document.getText(range);

    // Prevent extraction inside <style> tags (in HTML or inline templates in TS/JS)
    if (ext === ".html" || ext === ".ts" || ext === ".js") {
      const docText = editor.document.getText();
      const selectionStart = editor.document.offsetAt(selection.start);
      // Simple regex to find style blocks
      const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
      let match: RegExpExecArray | null;
      while ((match = styleRegex.exec(docText)) !== null) {
        const styleStart = match.index;
        const styleEnd = match.index + match[0].length;
        // Check if selection overlaps with style block
        if (selectionStart >= styleStart && selectionStart < styleEnd) {
          vscode.window.showErrorMessage("Cannot extract text inside <style> tags.");
          return;
        }
      }
    }

    // Handle TS/JS quotes expansion
    if (ext === ".ts" || ext === ".js") {
      const docText = editor.document.getText();
      const startOffset = editor.document.offsetAt(selection.start);
      const endOffset = editor.document.offsetAt(selection.end);

      if (startOffset > 0 && endOffset < docText.length) {
        const charBefore = docText[startOffset - 1];
        const charAfter = docText[endOffset];
        if ((charBefore === "'" && charAfter === "'") ||
          (charBefore === '"' && charAfter === '"') ||
          (charBefore === '`' && charAfter === '`')) {
          range = new vscode.Range(
            editor.document.positionAt(startOffset - 1),
            editor.document.positionAt(endOffset + 1)
          );
        }
      }
    }

    // Refresh text to the potentially expanded range to ensure we capture what is being replaced
    // However, for the *content* (found.text), we might want to strip quotes if they exist,
    // so that the generated key/value doesn't include them.
    // If we expanded above, we captured quotes. If user selected quotes, we have quotes.
    // We want `rawText` to HAVE quotes (for replacement), and `text` to NOT HAVE quotes (for extraction).

    // Update rawText range
    const rawText = editor.document.getText(range);

    // Logic to strip quotes from the text to be extracted
    let extractedText = rawText;
    const trimmed = extractedText.trim();
    if (trimmed.length >= 2) {
      const first = trimmed.charAt(0);
      const last = trimmed.charAt(trimmed.length - 1);
      if ((first === '"' && last === '"') ||
        (first === "'" && last === "'") ||
        (first === '`' && last === '`')) {
        extractedText = trimmed.slice(1, -1);
      }
    }

    const found: FoundString = {
      fileAbs,
      fileRelFromSrc,
      kind: ext === ".html" ? "html-text" : "js-string",
      line: range.start.line + 1,
      column: range.start.character,
      text: extractedText,
      rawText: rawText
    };

    try {
      // Ensure required npm packages are installed
      const output = vscode.window.createOutputChannel("Angular Translation Extractor");
      output.show(true);
      output.appendLine(`[angular-i18n] Checking required npm packages...`);
      const packagesOk = await ensurePackagesInstalled(root, output);
      if (!packagesOk) {
        output.appendLine(`[angular-i18n] ⚠ Warning: npm package installation may have failed. Continuing anyway...`);
      }

      // We use 'processLocalesAndArtifacts' parts manually to separate generation from replacement
      const langs = await loadAndNormalizeLanguages(root, cfg.languagesJsonPath);

      const defaultLang = normalizeLanguages(langs).find(l => l.default === true)?.code;
      const baseLocaleCode = defaultLang ?? cfg.baseLocaleCode;

      const generatedLangs = langs.filter(lang => {
        if (lang.active === true) return true;
        if (lang.code === baseLocaleCode) return true;
        if (!cfg.onlyGenerateActiveLangs) return true;
        return false;
      });

      // Generate/Update JSONs only
      const gen = await generatePerFileLocales({
        workspaceRoot: root,
        srcDir: cfg.srcDir,
        outputRoot: cfg.outputRoot,
        baseLocaleCode: baseLocaleCode,
        languages: generatedLangs,
        found: [found],
        updateMode: "merge", // Always merge for single selection
        onlyMainLanguages: cfg.onlyMainLanguages,
        singleFilePerLanguage: cfg.singleFilePerLanguage
      });

      // Run auto-translate
      await executeAutoTranslate(cfg, root, baseLocaleCode, generatedLangs, gen.baseFiles, output);

      // Generate loader artifacts (including tg-language-selector)
      const loaderArtifacts = await generateLoaderArtifacts({
        workspaceRoot: root,
        srcDir: cfg.srcDir,
        outputRoot: cfg.outputRoot,
        baseLocaleCode: baseLocaleCode,
        languages: generatedLangs,
        baseFiles: gen.baseFiles,
        updateMode: "merge", // match the updateMode used in generatePerFileLocales for selection
        onlyMainLanguages: cfg.onlyMainLanguages,
        singleFilePerLanguage: cfg.singleFilePerLanguage,
        enableTransalationCache: cfg.enableTransalationCache,
        languagesJsonPath: cfg.languagesJsonPath
      });

      if (loaderArtifacts.packageJsonUpdated) {
        output.appendLine(`[angular-i18n] ✓ Updated package.json scripts`);
      }

      // Calculate replacement
      const keyMap = gen.keyMapByFile[fileAbs];
      if (!keyMap || !keyMap[found.text]) {
        vscode.window.showErrorMessage("Could not generate key for selection.");
        return;
      }
      const key = keyMap[found.text];

      // Apply replacement in Editor
      await editor.edit(editBuilder => {
        let replacement = "";
        if (ext === ".html") {
          replacement = `{{ '${key}' | translate }}`;
        } else {
          replacement = `this.translate.instant('${key}')`; // Default assumption: inside class method
          // TODO: Could try to detect if we are in template literal or static context?
          // For now, this is the safe standard.
        }
        editBuilder.replace(range, replacement);
      });

      // Save to disk to ensure ensureComponentStructure works on latest content
      await editor.document.save();

      // Ensure Angular component has proper imports/injections
      if (ext === ".ts") {
        await ensureComponentStructure(fileAbs, cfg.angularBootstrapStyle);
      } else if (ext === ".html") {
        // Try to find companion .ts
        const potentialTs = fileAbs.replace(/\.html$/, ".ts");
        try {
          // If TS exists: 
          // 1. Check if we need TranslateModule (only if standalone)
          // 2. We don't need TranslateService injection for pipe usage in HTML
          if (cfg.angularBootstrapStyle === "standalone") {
            await fs.access(potentialTs);
            await addTranslateModuleImport(potentialTs, true);
          }
        } catch {
          // No companion TS found
        }
      }

      // Ensure application configuration (angular.json, main.ts, environments) is correct
      await performAppConfiguration(root, cfg, baseLocaleCode, output);

      await runNgBuild(root, output);

      vscode.window.showInformationMessage(`Extracted '${text}' to key '${key}'`);

    } catch (e: unknown) {
      const msg = (e as Error).message || String(e);
      vscode.window.showErrorMessage(`Deep extraction failed: ${msg}`);
    }
  });

  context.subscriptions.push(disposable, extractFileDisposable, extractSelectionDisposable);



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
        output.appendLine(
          `[angular-i18n-reverse] Starting reverse translation for folder: ${folderPath}`
        );
        output.appendLine(
          `[angular-i18n-reverse] Base locale code: ${cfg.baseLocaleCode}`
        );

        const result = await reverseTranslateFolderScope(
          folderPath,
          root,
          path.join(root, cfg.srcDir),
          path.join(root, cfg.outputRoot),
          cfg.languagesJsonPath,
          cfg.baseLocaleCode,
          cfg.onlyMainLanguages,
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
        output.appendLine(
          `[angular-i18n-reverse] Starting reverse translation for file: ${filePath}`
        );
        output.appendLine(
          `[angular-i18n-reverse] Base locale code: ${cfg.baseLocaleCode}`
        );

        const result = await reverseTranslateFileScope(
          filePath,
          root,
          path.join(root, cfg.srcDir),
          path.join(root, cfg.outputRoot),
          cfg.languagesJsonPath,
          cfg.baseLocaleCode,
          cfg.onlyMainLanguages,
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
          cfg.baseLocaleCode,
          cfg.onlyMainLanguages,
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
}

export function deactivate() { }
