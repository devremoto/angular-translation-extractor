import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getConfig } from "./config";
import { scanForStrings } from "./scan";
import { LanguageEntry } from "./types";
import { normalizeLanguages } from "./langMeta";
import { ensureDir, readJsonIfExists } from "./utils";
import { generatePerFileLocales } from "./generate";
import { generateLoaderArtifacts, updateManifest } from "./loader-generator";
import { replaceExtractedStrings } from "./replaceSource";
import { updateMainTs } from "./updateMainTs";
import { runTranslateCommand } from "./translate";
import { updateAngularJson } from "./updateAngularJson";
import { captureConsoleLogs } from "./console-capture";
import { reverseTranslateFileScope, reverseTranslateFolderScope } from './reverse';

const execAsync = promisify(exec);

async function loadAndNormalizeLanguages(workspaceRoot: string, languagesJsonPath: string): Promise<LanguageEntry[]> {
  const abs = path.join(workspaceRoot, languagesJsonPath);
  await ensureDir(path.dirname(abs));

  const entries = await readJsonIfExists<LanguageEntry[]>(abs, []);
  const normalized = normalizeLanguages(entries);

  await fs.writeFile(abs, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return normalized;
}

function isPackageInstalled(pkgName: string, nodeModulesPath: string): boolean {
  const pkgPath = path.join(nodeModulesPath, pkgName);
  try {
    require.resolve(pkgPath);
    return true;
  } catch {
    return false;
  }
}

async function ensurePackagesInstalled(workspaceRoot: string, output: vscode.OutputChannel): Promise<boolean> {
  const nodeModulesPath = path.join(workspaceRoot, "node_modules");
  const packagesToCheck = ["axios", "fast-glob"];
  const missingPackages: string[] = [];

  for (const pkg of packagesToCheck) {
    if (!isPackageInstalled(pkg, nodeModulesPath)) {
      missingPackages.push(pkg);
    }
  }

  if (missingPackages.length === 0) {
    output.appendLine(`[angular-i18n] ✓ All required packages are installed`);
    return true;
  }

  output.appendLine(`[angular-i18n] ⚠ Missing packages: ${missingPackages.join(", ")}`);
  output.appendLine(`[angular-i18n] Installing: npm install ${missingPackages.join(" ")} --force --save-dev`);

  try {
    const { stdout, stderr } = await execAsync(`npm install ${missingPackages.join(" ")} --force --save-dev`, {
      cwd: workspaceRoot,
      timeout: 60000
    });

    if (stdout) output.appendLine(`[angular-i18n] npm install stdout: ${stdout}`);
    if (stderr) output.appendLine(`[angular-i18n] npm install stderr: ${stderr}`);

    output.appendLine(`[angular-i18n] ✓ Packages installed successfully`);
    return true;
  } catch (err: unknown) {
    const errorMsg = (err as Record<string, unknown>)?.message || String(err);
    output.appendLine(`[angular-i18n] ✗ Failed to install packages: ${errorMsg}`);
    output.appendLine(`[angular-i18n] Please run manually: npm install ${missingPackages.join(" ")} --force --save-dev`);
    return false;
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

      output.appendLine(`[angular-i18n] Reading locales list: ${cfg.languagesJsonPath}`);
      const langs = await loadAndNormalizeLanguages(root, cfg.languagesJsonPath);
      output.appendLine(`[angular-i18n] Loaded ${langs.length} languages: ${langs.map(l => l.code).join(", ")}`);

      const defaultLang = normalizeLanguages(langs).find(l => l.default === true)?.code;
      const baseLocaleCode = defaultLang ?? cfg.baseLocaleCode;
      output.appendLine(`[angular-i18n] Base locale code: ${baseLocaleCode}`);
      output.appendLine(`[angular-i18n] onlyGenerateActiveLangs: ${cfg.onlyGenerateActiveLangs}`);

      const hasBase = langs.some(l => l.code === baseLocaleCode);
      if (!hasBase) {
        output.appendLine(`[angular-i18n] Warning: baseLocaleCode (${baseLocaleCode}) not found in languages list.`);
      }

      // Filter languages based on onlyGenerateActiveLangs configuration
      // - Always generate languages with active:true
      // - Always generate base locale
      // - If onlyGenerateActiveLangs is false, generate all languages
      let generatedLangs = langs.filter(lang => {
        if (lang.active === true) return true;
        if (lang.code === baseLocaleCode) return true;
        if (!cfg.onlyGenerateActiveLangs) return true;
        return false;
      });

      output.appendLine(`[angular-i18n] Languages to generate (${generatedLangs.length}): ${generatedLangs.map(l => l.code).join(", ")}`);
      output.appendLine(`[angular-i18n] onlyMainLanguages: ${cfg.onlyMainLanguages}`);

      // Update manifest immediately with known languages
      // This ensures external tools or translation scripts have a valid manifest even if extraction finds 0 strings
      try {
        await updateManifest({
          workspaceRoot: root,
          outputRoot: cfg.outputRoot,
          baseLocaleCode: baseLocaleCode,
          languages: langs,
          onlyMainLanguages: cfg.onlyMainLanguages
        });
        output.appendLine(`[angular-i18n] Updated translate-manifest.json`);
      } catch (err) {
        output.appendLine(`[angular-i18n] ⚠ Failed to pre-update manifest: ${err}`);
      }

      output.appendLine(`[angular-i18n] Scanning ${cfg.srcDir}/ (js/ts/html)...`);
      const found = await scanForStrings({ workspaceRoot: root, cfg });
      output.appendLine(`[angular-i18n] Found ${found.length} candidate strings.`);

      // Count by type for debugging
      const byKind = found.reduce((acc: Record<string, number>, f) => {
        acc[f.kind] = (acc[f.kind] || 0) + 1;
        return acc;
      }, {});
      output.appendLine(`[angular-i18n] Breakdown by kind: ${Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(', ')}`);

      // Count by file type for debugging
      const tsFiles = new Set(found.filter(f => f.fileRelFromSrc.endsWith('.ts')).map(f => f.fileAbs));
      const htmlFiles = new Set(found.filter(f => f.fileRelFromSrc.endsWith('.html')).map(f => f.fileAbs));
      output.appendLine(`[angular-i18n] Files with extracted strings: ${tsFiles.size} TS files, ${htmlFiles.size} HTML files`);

      output.appendLine(`[angular-i18n] Generating locale JSONs under: ${cfg.outputRoot}`);
      output.appendLine(`[angular-i18n] Single file per language mode: ${cfg.singleFilePerLanguage}`);
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

      output.appendLine(`[angular-i18n] Files processed: ${gen.filesProcessed}`);
      output.appendLine(`[angular-i18n] Strings added: ${gen.stringsAdded}`);
      output.appendLine(`[angular-i18n] Base files for manifest: ${gen.baseFiles.length}`);

      const replaceResult = await replaceExtractedStrings({
        workspaceRoot: root,
        found,
        keyMapByFile: gen.keyMapByFile,
        bootstrapStyle: cfg.angularBootstrapStyle
      });

      const loaderArtifacts = await generateLoaderArtifacts({
        workspaceRoot: root,
        srcDir: cfg.srcDir,
        outputRoot: cfg.outputRoot,
        baseLocaleCode: baseLocaleCode,
        languages: generatedLangs,
        baseFiles: gen.baseFiles,
        updateMode: cfg.updateMode,
        onlyMainLanguages: cfg.onlyMainLanguages,
        singleFilePerLanguage: cfg.singleFilePerLanguage
      });

      output.appendLine(`[angular-i18n] Loader artifacts generated: ${loaderArtifacts.loaderPath}`);

      if (loaderArtifacts.packageJsonUpdated) {
        output.appendLine(`[angular-i18n] ✓ Updated package.json with translation scripts`);
        output.appendLine(`[angular-i18n]   - npm run i18n:translate:google`);
        output.appendLine(`[angular-i18n]   - npm run i18n:translate:libretranslate`);
      } else {
        output.appendLine(`[angular-i18n] ⚠ Could not update package.json: ${loaderArtifacts.packageJsonReason || 'unknown error'}`);
      }

      // Update angular.json to include i18n assets
      try {
        await updateAngularJson({
          workspaceRoot: root,
          outputRoot: cfg.outputRoot
        });
        output.appendLine(`[angular-i18n] ✓ Updated angular.json assets configuration`);
      } catch (err: unknown) {
        output.appendLine(`[angular-i18n] ⚠ Could not update angular.json: ${(err as Record<string, unknown>)?.message || String(err)}`);
      }

      //if (cfg.updateMode !== "merge") {
      output.appendLine(`[angular-i18n] Updating main.ts (bootstrap style: ${cfg.angularBootstrapStyle}, update mode: ${cfg.updateMode})...`);
      const mainResult = await updateMainTs({
        workspaceRoot: root,
        srcDir: cfg.srcDir,
        mainTsPath: cfg.mainTsPath,
        baseLocaleCode: baseLocaleCode,
        bootstrapStyle: cfg.angularBootstrapStyle,
        updateMode: cfg.updateMode,
        outputRoot: cfg.outputRoot
      });
      if (mainResult.updated) {
        output.appendLine(`[angular-i18n] ✅ main.ts updated: ${mainResult.mainTsPath}`);
      } else {
        output.appendLine(`[angular-i18n] ⚠️ main.ts not updated: ${mainResult.reason}`);
      }
      //}

      output.appendLine(`[angular-i18n] Files processed: ${gen.filesProcessed}`);
      output.appendLine(`[angular-i18n] Strings added to base locales: ${gen.stringsAdded}`);
      output.appendLine(`[angular-i18n] Strings replaced in source: ${replaceResult.stringsReplaced}`);
      output.appendLine(`[angular-i18n] Source files updated: ${replaceResult.filesUpdated}`);
      output.appendLine(`[angular-i18n] TypeScript files updated (TranslateModule): ${replaceResult.tsFilesUpdated}`);
      output.appendLine(`[angular-i18n] Loader generated: ${loaderArtifacts.loaderPath}`);
      output.appendLine(`[angular-i18n] Loader readme: ${loaderArtifacts.readmePath}`);
      output.appendLine(`[angular-i18n] Language selector component: ${loaderArtifacts.languageSelectorPath}`);

      if (cfg.autoTranslate && (cfg.translationService === "google" || cfg.translationService === "libretranslate")) {
        // Dynamic imports with variables confuse esbuild, so we must use static imports
        let translateJsonFile: any;
        if (cfg.translationService === "google") {
          const mod = await import("./google-translate");
          translateJsonFile = mod.translateJsonFile;
        } else {
          const mod = await import("./libretranslate");
          translateJsonFile = mod.translateJsonFile;
        }

        const fg = await import("fast-glob");

        const serviceName = cfg.translationService === "google" ? "Google Translate" : "LibreTranslate";
        output.appendLine(`[angular-i18n] Starting ${serviceName}...`);

        if (cfg.translationService === "libretranslate") {
          output.appendLine(`[angular-i18n] ⚠️  WARNING: LibreTranslate has lower translation quality than Google Translate. Consider using Google Translate for better results.`);
        }

        // Find all base language JSON files in the output directory
        // Account for onlyMainLanguages setting when determining base file name
        const effectiveBaseLocale = cfg.onlyMainLanguages
          ? baseLocaleCode.split("-")[0]
          : baseLocaleCode;
        const outputRootAbs = path.join(root, cfg.outputRoot);
        const basePattern = path.join(outputRootAbs, `**/${effectiveBaseLocale}.json`).replace(/\\/g, "/");
        const baseFiles = await fg.default(basePattern, { ignore: ["**/node_modules/**"] });

        output.appendLine(`[angular-i18n] Base files found: ${baseFiles.length}`);

        if (baseFiles.length === 0) {
          output.appendLine(`[angular-i18n] No base language files (${effectiveBaseLocale}.json) found in ${cfg.outputRoot}`);
        }

        for (const baseFileAbs of baseFiles) {
          const outDirAbs = path.dirname(baseFileAbs);
          output.appendLine(`[angular-i18n] Translating from base file: ${baseFileAbs}`);
          output.appendLine(`[angular-i18n] Target languages: ${generatedLangs.filter(l => {
            const langCode = cfg.onlyMainLanguages ? l.code.split("-")[0] : l.code;
            return langCode !== effectiveBaseLocale;
          }).map(l => l.code).join(", ")}`);

          if (generatedLangs.length <= 1) {
            output.appendLine(`[angular-i18n] No target languages configured. Add more languages to ${cfg.languagesJsonPath}`);
          }

          for (const lang of generatedLangs) {
            const langCode = cfg.onlyMainLanguages ? lang.code.split("-")[0] : lang.code;
            if (langCode === effectiveBaseLocale) continue;

            // Skip default language if autoTranslateDefaultLanguage is false
            if (!cfg.autoTranslateDefaultLanguage && lang.default === true) {
              output.appendLine(`[angular-i18n] Skipping default language ${lang.code} (autoTranslateDefaultLanguage=false)`);
              continue;
            }

            const targetLocale = lang.code;
            try {
              output.appendLine(`[angular-i18n] Translating to ${targetLocale}...`);

              // Extract main language code for translation API
              // Only split if onlyMainLanguages is true
              const translationTargetLang = cfg.onlyMainLanguages ? targetLocale.split("-")[0] : targetLocale;

              // Determine output filename based on onlyMainLanguages setting
              const outputFileName = cfg.onlyMainLanguages ? translationTargetLang : targetLocale;

              await translateJsonFile({
                inputFile: baseFileAbs,
                outputDir: outDirAbs,
                targetLang: translationTargetLang,
                sourceLang: effectiveBaseLocale,
                outputFileName: outputFileName,
                onProgress: (msg: string) => output.appendLine(msg)
              });

              // Add delay to avoid rate limiting
              const delay = Math.max(100, cfg.googleTranslateDelay);
              await new Promise(resolve => setTimeout(resolve, delay));
            } catch (err: unknown) {
              output.appendLine(`[angular-i18n] ${serviceName} failed for ${targetLocale}: ${(err as Record<string, unknown>)?.message || String(err)}. Continuing...`);
            }
          }
        }

        output.appendLine(`[angular-i18n] ${serviceName} completed.`);
      } else if (cfg.useTranslateCommand) {
        for (const bf of gen.baseFiles) {
          for (const targetLocale of bf.targets) {
            const args = cfg.translateArgsTemplate.map(a =>
              a
                .replaceAll("{baseFile}", bf.baseFileAbs)
                .replaceAll("{outDir}", bf.outDirAbs)
                .replaceAll("{baseLocale}", baseLocaleCode)
                .replaceAll("{targetLocale}", targetLocale)
            );

            output.appendLine(`[angular-i18n] Running: ${cfg.translateCommand} ${args.join(" ")}`);
            const code = await runTranslateCommand({
              cwd: root,
              command: cfg.translateCommand,
              args,
              onStdout: s => output.append(s),
              onStderr: s => output.append(s)
            });

            if (code !== 0) {
              output.appendLine(`[angular-i18n] Translate failed for ${targetLocale} (exit ${code}). Continuing...`);
            }
          }
        }
      }

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

      vscode.window.showInformationMessage("Angular translation extraction completed.");
      output.appendLine(`[angular-i18n] Done ✅`);
    } catch (err: unknown) {
      const msg = (err as Record<string, unknown>)?.message ? String((err as Record<string, unknown>).message) : String(err);
      vscode.window.showErrorMessage(`Angular translation extraction failed: ${msg}`);
      output.appendLine(`[angular-i18n] Failed ❌ ${msg}`);
    }
  });

  context.subscriptions.push(disposable);

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
}

export function deactivate() { }
