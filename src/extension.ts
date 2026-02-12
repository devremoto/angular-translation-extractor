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
import { generateLoaderArtifacts } from "./loader-generator";
import { replaceExtractedStrings, ensureComponentStructure, addTranslateModuleImport } from "./replaceSource";
import { updateMainTs } from "./updateMainTs";
import { runTranslateCommand } from "./translate";
import { updateAngularJson } from "./updateAngularJson";
import { captureConsoleLogs } from "./console-capture";
import { reverseTranslateFileScope, reverseTranslateFolderScope, reverseTranslateSelectionScope } from './reverse';
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

  // Check for language changes
  const storedLangs = context.workspaceState.get<LanguageEntry[]>("angular-i18n-languages", []);
  const oldCodes = new Set(storedLangs.map(l => l.code));
  const newCodes = new Set(langs.map(l => l.code));

  let hasChanges = false;
  if (oldCodes.size !== newCodes.size) {
    hasChanges = true;
  } else {
    for (const c of oldCodes) {
      if (!newCodes.has(c)) {
        hasChanges = true;
        break;
      }
    }
    // Also check active/default status if needed, but code set covers add/remove
  }

  if (hasChanges) {
    output.appendLine(`[angular-i18n] 🔄 Language configuration change detected.`);
    const added = langs.filter(l => !oldCodes.has(l.code)).map(l => l.code);
    const removed = storedLangs.filter(l => !newCodes.has(l.code)).map(l => l.code);

    if (added.length) output.appendLine(`  + Added: ${added.join(", ")}`);
    if (removed.length) output.appendLine(`  - Removed: ${removed.join(", ")}`);

    // Update stored state
    await context.workspaceState.update("angular-i18n-languages", langs);
  } else {
    output.appendLine(`[angular-i18n] Language configuration unchanged.`);
  }

  const defaultLang = normalizeLanguages(langs).find(l => l.default === true)?.code;
  const baseLocaleCode = defaultLang ?? cfg.baseLocaleCode;

  const generatedLangs = langs.filter(lang => {
    if (lang.active === true) return true;
    if (lang.code === baseLocaleCode) return true;
    if (!cfg.onlyGenerateActiveLangs) return true;
    return false;
  });

  output.appendLine(`[angular-i18n] Generating locale JSONs under: ${cfg.outputRoot}`);
  const gen = await generatePerFileLocales({
    workspaceRoot: root,
    srcDir: cfg.srcDir,
    outputRoot: cfg.outputRoot,
    baseLocaleCode: baseLocaleCode,
    languages: generatedLangs,
    found,
    updateMode: options.forceUpdateMode ?? cfg.updateMode,
    onlyMainLanguages: cfg.onlyMainLanguages,
    singleFilePerLanguage: cfg.singleFilePerLanguage
  });

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
      onlyMainLanguages: cfg.onlyMainLanguages,
      singleFilePerLanguage: cfg.singleFilePerLanguage,
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

async function runExtractionPipeline(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  action: (root: string, cfg: ExtConfig, output: vscode.OutputChannel) => Promise<FoundString[]>,
  options: ProcessOptions = {}
) {
  const root = folder.uri.fsPath;
  const cfg = getConfig();
  const output = vscode.window.createOutputChannel("Angular Translation Extractor");
  output.show(true);

  try {
    output.appendLine(`[angular-i18n] Checking required npm packages...`);
    const packagesOk = await ensurePackagesInstalled(root, output);
    if (!packagesOk) {
      output.appendLine(`[angular-i18n] ⚠ Warning: npm package installation may have failed. Continuing anyway...`);
    }

    const found = await action(root, cfg, output);
    if (!found) { // allow empty found list to proceed for sync purposes
      return null;
    }

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

    await runExtractionPipeline(context, folders[0], async (root, cfg, output) => {
      output.appendLine(`[angular-i18n] Scanning ${cfg.srcDir}/ (js/ts/html)...`);
      const found = await scanForStrings({ workspaceRoot: root, cfg });
      output.appendLine(`[angular-i18n] Found ${found.length} candidate strings.`);
      return found;
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

      if (ext === ".html") {
        found = await extractFromHtml(fileAbs, relFromSrc, cfg.minStringLength, cfg.htmlAttributeNames);
      } else if (ext === ".ts" || ext === ".js") {
        found = await extractFromJsTs(fileAbs, relFromSrc, cfg.minStringLength, cfg.htmlAttributeNames);
      }

      if (found.length === 0) {
        output.appendLine(`[extractFile] No strings found in file.`);
      } else {
        vscode.window.showInformationMessage(`Extracted ${found.length} strings from file.`);
      }
      return found;
    }, { skipHeavyOps: false }); // keep false to ensure config integrity
  });

  const extractSelectionDisposable = vscode.commands.registerCommand("angularTranslation.extractSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
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

    const result = await runExtractionPipeline(context, folders[0], async () => [found], {
      skipReplacement: true,
      forceUpdateMode: "merge"
    });

    if (result) {
      const keyMap = result.gen.keyMapByFile[fileAbs];
      if (keyMap && keyMap[found.text]) {
        const key = keyMap[found.text];
        await editor.edit(editBuilder => {
          const replacement = (kind === "html-text")
            ? `{{ '${key}' | translate }}`
            : `this.translate.instant('${key}')`;
          editBuilder.replace(range, replacement);
        });
        await editor.document.save();

        if (ext === ".ts") await ensureComponentStructure(fileAbs, result.cfg.angularBootstrapStyle);
        else if (ext === ".html" && result.cfg.angularBootstrapStyle === "standalone") {
          const potTs = fileAbs.replace(/\.html$/, ".ts");
          await fs.access(potTs).then(() => addTranslateModuleImport(potTs, true)).catch(() => { });
        }

        // Re-run app config to secure everything
        await performAppConfiguration(result.root, result.cfg, result.baseLocaleCode, result.output);
        vscode.window.showInformationMessage(`Extracted '${extractedText}' to key '${key}'`);
      } else {
        vscode.window.showErrorMessage("Could not generate key for selection.");
      }
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
