import * as path from "node:path";
import * as fs from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { LanguageEntry } from "./types";
import { ensureDir } from "./utils";

export function getGoogleTranslateScript(outputRoot: string, baseLocaleCode: string): string {
  return `const fs = require("fs");
const path = require("path");
const axios = require("axios");
const glob = require("fast-glob");

const OUTPUT_ROOT = "${outputRoot}";
const BASE_LANG = "${baseLocaleCode}";
let EFFECTIVE_BASE_LANG = BASE_LANG;

// Extract main language code (e.g., "pt" from "pt-BR")
function getMainLang(code) {
  return code.split("-")[0].toLowerCase();
}

const BASE_LANG_MAIN = getMainLang(BASE_LANG);

// Parse command line args
const args = process.argv.slice(2);
const isFast = args.includes("--fast");
const isDiff = args.includes("--diff");
const isParallel = args.includes("--parallel");
const isForce = args.includes("--force");
const DEFAULT_DELAY = isFast ? 0 : 500;

async function translateWithGoogle(text, targetLang) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: getMainLang(EFFECTIVE_BASE_LANG) || "auto",
    tl: targetLang,
    dt: "t",
    q: text,
  });

  const response = await axios.post(
    \`https://translate.google.com/translate_a/single?\${params}\`,
    {},
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }
  );

  if (Array.isArray(response.data) && response.data[0]) {
    return response.data[0][0][0];
  }
  return text;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateKeys(keysToTranslate, targetLang) {
  if (isParallel) {
    // Parallel translation with concurrency limit
    const batchSize = 5;
    const results = {};
    for (let i = 0; i < keysToTranslate.length; i += batchSize) {
      const batch = keysToTranslate.slice(i, i + batchSize);
      const promises = batch.map(async ([key, value]) => {
        try {
          const translated = await translateWithGoogle(value, targetLang);
          results[key] = translated;
          if (DEFAULT_DELAY > 0) await sleep(DEFAULT_DELAY);
        } catch (error) {
          console.error(\`  ❌ Error translating "\${key}": \${error.message}\`);
          results[key] = value;
        }
      });
      await Promise.all(promises);
    }
    return results;
  } else {
    // Sequential translation (default)
    const results = {};
    for (const [key, value] of keysToTranslate) {
      try {
        const translated = await translateWithGoogle(value, targetLang);
        results[key] = translated;
        if (DEFAULT_DELAY > 0) await sleep(DEFAULT_DELAY);
      } catch (error) {
        console.error(\`  ❌ Error translating "\${key}": \${error.message}\`);
        results[key] = value;
      }
    }
    return results;
  }
}

async function main() {
  console.log("🌐 Starting Google Translate...");
  if (isDiff) console.log("📋 Diff mode - showing what would be translated\\n");
  if (isFast) console.log("⚡ Fast mode - no delays between requests\\n");
  if (isParallel) console.log("🚀 Parallel mode - translate up to 5 languages at once\\n");
  if (isForce) console.log("💪 Force mode - overwriting existing translations\\n");

  // Find all base language JSON files
  const baseFiles = await glob(\`\${OUTPUT_ROOT}/**/*.json\`, {
    ignore: ["**/translate-manifest.json"],
  });

      const hasBaseLang = baseFiles.some(
        (file) => path.basename(file).replace(".json", "") === BASE_LANG
      );
      const hasMainBaseLang = baseFiles.some(
        (file) => path.basename(file).replace(".json", "") === BASE_LANG_MAIN
      );

      if (!hasBaseLang && hasMainBaseLang) {
        EFFECTIVE_BASE_LANG = BASE_LANG_MAIN;
      }

      const baseLanguageFiles = baseFiles.filter(
        (file) => path.basename(file).replace(".json", "") === EFFECTIVE_BASE_LANG
      );

  if (baseLanguageFiles.length === 0) {
    console.log(\`❌ No \${EFFECTIVE_BASE_LANG}.json files found in \${OUTPUT_ROOT}\`);
    process.exit(1);
  }

  console.log(\`📁 Found \${baseLanguageFiles.length} base language file(s)\`);

  // Get target languages from manifest
  const manifestPath = path.join(OUTPUT_ROOT, "translate-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.log("❌ translate-manifest.json not found");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const allLanguages = Object.keys(manifest.locales || {});
      const targetLanguages = allLanguages.filter((code) => code !== EFFECTIVE_BASE_LANG).map((code) => ({ code }));

  console.log(\`🎯 Target languages: \${targetLanguages.map((l) => l.code).join(", ")}\`);

  let totalTranslated = 0;

  for (const baseFile of baseLanguageFiles) {
    console.log(\`\\n📄 Processing: \${baseFile}\`);
    const baseDir = path.dirname(baseFile);
    const content = JSON.parse(fs.readFileSync(baseFile, "utf-8"));

    for (const targetLang of targetLanguages) {
      const targetFile = path.join(baseDir, \`\${targetLang.code}.json\`);
      const translations = fs.existsSync(targetFile)
        ? JSON.parse(fs.readFileSync(targetFile, "utf-8"))
        : {};

      const keysToTranslate = Object.entries(content).filter(
        ([key, value]) => isForce || !translations[key] || (typeof translations[key] === 'string' && translations[key].trim() === '')
      );

      if (keysToTranslate.length === 0) {
        console.log(\`  ✓ \${targetLang.code}: all keys translated\`);
        continue;
      }

      console.log(\`  → \${targetLang.code}: \${keysToTranslate.length} key(s) to translate\`);
      
      if (isDiff) {
        // Show what would be translated
        keysToTranslate.forEach(([key, value]) => {
          console.log(\`    • "\${key}": "\${value}"\`);
        });
        continue;
      }

      // Extract main language code for translation API (e.g., "pt" from "pt-BR")
      const mainLang = getMainLang(targetLang.code);
      const results = await translateKeys(keysToTranslate, mainLang);
      Object.assign(translations, results);

      fs.writeFileSync(targetFile, JSON.stringify(translations, null, 2) + "\\n");
      totalTranslated += keysToTranslate.length;
      console.log(\`  ✅ \${targetLang.code}: saved\`);
    }
  }

  if (isDiff) {
    console.log("\\n📋 Diff mode - use without --diff to apply translations");
  } else {
    console.log(\`\\n✅ Translation complete! (\${totalTranslated} keys translated)\`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
`;
}

export function getLibretranslateScript(outputRoot: string, baseLocaleCode: string): string {
  return `const fs = require("fs");
const path = require("path");
const axios = require("axios");
const glob = require("fast-glob");

const OUTPUT_ROOT = "${outputRoot}";
const BASE_LANG = "${baseLocaleCode}";
let EFFECTIVE_BASE_LANG = BASE_LANG;
const LIBRETRANSLATE_URL = "https://libretranslate.de/translate";

// Extract main language code (e.g., "pt" from "pt-BR")
function getMainLang(code) {
  return code.split("-")[0].toLowerCase();
}

const BASE_LANG_MAIN = getMainLang(BASE_LANG);

// Parse command line args
const args = process.argv.slice(2);
const isFast = args.includes("--fast");
const isDiff = args.includes("--diff");
const isParallel = args.includes("--parallel");
const isForce = args.includes("--force");
const DEFAULT_DELAY = isFast ? 0 : 500;

async function translateWithLibretranslate(text, targetLang) {
  const response = await axios.post(LIBRETRANSLATE_URL, {
    q: text,
    source: getMainLang(EFFECTIVE_BASE_LANG) || "auto",
    target: targetLang,
  });

  if (response.data && response.data.translatedText) {
    return response.data.translatedText;
  }
  return text;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateKeys(keysToTranslate, targetLang) {
  if (isParallel) {
    // Parallel translation with concurrency limit
    const batchSize = 5;
    const results = {};
    for (let i = 0; i < keysToTranslate.length; i += batchSize) {
      const batch = keysToTranslate.slice(i, i + batchSize);
      const promises = batch.map(async ([key, value]) => {
        try {
          const translated = await translateWithLibretranslate(value, targetLang);
          results[key] = translated;
          if (DEFAULT_DELAY > 0) await sleep(DEFAULT_DELAY);
        } catch (error) {
          console.error(\`  ❌ Error translating "\${key}": \${error.message}\`);
          results[key] = value;
        }
      });
      await Promise.all(promises);
    }
    return results;
  } else {
    // Sequential translation (default)
    const results = {};
    for (const [key, value] of keysToTranslate) {
      try {
        const translated = await translateWithLibretranslate(value, targetLang);
        results[key] = translated;
        if (DEFAULT_DELAY > 0) await sleep(DEFAULT_DELAY);
      } catch (error) {
        console.error(\`  ❌ Error translating "\${key}": \${error.message}\`);
        results[key] = value;
      }
    }
    return results;
  }
}

async function main() {
  console.log("⚠️  LibreTranslate has poor translation quality. Results may require manual review.");
  console.log("🌐 Starting LibreTranslate...");
  if (isDiff) console.log("📋 Diff mode - showing what would be translated\\n");
  if (isFast) console.log("⚡ Fast mode - no delays between requests\\n");
  if (isParallel) console.log("🚀 Parallel mode - translate up to 5 languages at once\\n");
  if (isForce) console.log("💪 Force mode - overwriting existing translations\\n");

  // Find all base language JSON files
  const baseFiles = await glob(\`\${OUTPUT_ROOT}/**/*.json\`, {
    ignore: ["**/translate-manifest.json"],
  });

  const hasBaseLang = baseFiles.some(
    (file) => path.basename(file).replace(".json", "") === BASE_LANG
  );
  const hasMainBaseLang = baseFiles.some(
    (file) => path.basename(file).replace(".json", "") === BASE_LANG_MAIN
  );

  if (!hasBaseLang && hasMainBaseLang) {
    EFFECTIVE_BASE_LANG = BASE_LANG_MAIN;
  }

  const baseLanguageFiles = baseFiles.filter(
    (file) => path.basename(file).replace(".json", "") === EFFECTIVE_BASE_LANG
  );

  if (baseLanguageFiles.length === 0) {
    console.log(\`❌ No \${EFFECTIVE_BASE_LANG}.json files found in \${OUTPUT_ROOT}\`);
    process.exit(1);
  }

  console.log(\`📁 Found \${baseLanguageFiles.length} base language file(s)\`);

  // Get target languages from manifest
  const manifestPath = path.join(OUTPUT_ROOT, "translate-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.log("❌ translate-manifest.json not found");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const allLanguages = Object.keys(manifest.locales || {});
  const targetLanguages = allLanguages.filter((code) => code !== EFFECTIVE_BASE_LANG).map((code) => ({ code }));

  console.log(\`🎯 Target languages: \${targetLanguages.map((l) => l.code).join(", ")}\`);

  let totalTranslated = 0;

  for (const baseFile of baseLanguageFiles) {
    console.log(\`\\n📄 Processing: \${baseFile}\`);
    const baseDir = path.dirname(baseFile);
    const content = JSON.parse(fs.readFileSync(baseFile, "utf-8"));

    for (const targetLang of targetLanguages) {
      const targetFile = path.join(baseDir, \`\${targetLang.code}.json\`);
      const translations = fs.existsSync(targetFile)
        ? JSON.parse(fs.readFileSync(targetFile, "utf-8"))
        : {};

      const keysToTranslate = Object.entries(content).filter(
        ([key, value]) => isForce || !translations[key] || (typeof translations[key] === 'string' && translations[key].trim() === '')
      );

      if (keysToTranslate.length === 0) {
        console.log(\`  ✓ \${targetLang.code}: all keys translated\`);
        continue;
      }

      console.log(\`  → \${targetLang.code}: \${keysToTranslate.length} key(s) to translate\`);
      
      if (isDiff) {
        // Show what would be translated
        keysToTranslate.forEach(([key, value]) => {
          console.log(\`    • "\${key}": "\${value}"\`);
        });
        continue;
      }

      // Extract main language code for translation API (e.g., "pt" from "pt-BR")
      const mainLang = getMainLang(targetLang.code);
      const results = await translateKeys(keysToTranslate, mainLang);
      Object.assign(translations, results);

      fs.writeFileSync(targetFile, JSON.stringify(translations, null, 2) + "\\n");
      totalTranslated += keysToTranslate.length;
      console.log(\`  ✅ \${targetLang.code}: saved\`);
    }
  }

  if (isDiff) {
    console.log("\\n📋 Diff mode - use without --diff to apply translations");
  } else {
    console.log(\`\\n⚠️  Remember to review translations for quality and accuracy!\`);
    console.log(\`✅ Translation complete! (\${totalTranslated} keys translated)\`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
`;
}

async function updatePackageJsonScripts(workspaceRoot: string): Promise<{ updated: boolean; reason?: string }> {
  const packageJsonPath = path.join(workspaceRoot, "package.json");

  try {
    // Check if package.json exists
    const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);

    // Ensure scripts object exists
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }

    // Add translation scripts if they don't exist or overwrite with correct values
    packageJson.scripts["i18n:translate:google"] = "node scripts/translate-google.cjs --fast --parallel";
    packageJson.scripts["i18n:translate:libretranslate"] = "node scripts/translate-libretranslate.cjs --fast --parallel";

    // Write updated package.json
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n", "utf-8");

    return { updated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[updatePackageJsonScripts] ✗ Error: ${message}`);
    return { updated: false, reason: message };
  }
}

export async function generateLoaderArtifacts(opts: {
  workspaceRoot: string;
  srcDir: string;
  outputRoot: string;
  baseLocaleCode: string;
  languages: LanguageEntry[];
  baseFiles: Array<{ baseFileAbs: string; outDirAbs: string; targets: string[] }>;
  updateMode: "merge" | "overwrite" | "recreate";
  onlyMainLanguages?: boolean;
  singleFilePerLanguage?: boolean;
}): Promise<{ loaderPath: string; readmePath: string; languageSelectorPath: string; packageJsonUpdated: boolean; packageJsonReason?: string }> {
  const { workspaceRoot, srcDir, outputRoot, baseLocaleCode, languages, baseFiles, updateMode, onlyMainLanguages, singleFilePerLanguage } = opts;

  const translateDirAbs = path.join(workspaceRoot, srcDir, "translate");
  await ensureDir(translateDirAbs);

  const outputRootAbs = path.join(workspaceRoot, outputRoot);

  // Convert outputRoot to relative path for use in loader (e.g., "src/assets/I18n" -> "./assets/I18n/")
  const outputRootRelative = `./${outputRoot.replace(/^src\//, "")}/`.replace(/\/\/+/g, "/");

  const loaderPath = path.join(translateDirAbs, "tg-translate-loader.ts");
  const readmePath = path.join(translateDirAbs, "readme.md");
  const manifestPath = path.join(outputRootAbs, "translate-manifest.json");

  const loaderSource = `import { HttpClient } from "@angular/common/http";
import { TranslateLoader } from "@ngx-translate/core";
import { forkJoin, Observable, of } from "rxjs";
import { map, switchMap, catchError, tap } from "rxjs/operators";

export type TgTranslations = Record<string, unknown>;

export class TgTranslationLoader implements TranslateLoader {
  constructor(
    private http: HttpClient,
    private prefix: string = "${outputRootRelative}",
    private suffix: string = ".json",
    private manifestFile: string = "translate-manifest.json"
  ) {}

  public getTranslation(lang: string): Observable<TgTranslations> {
    const cacheKey = \`tg-translation-\${lang}\`;
    
    // Check sessionStorage cache first
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        return of(JSON.parse(cached));
      } catch (err) {
        console.warn(\`[TgTranslationLoader] Cache parse error, reloading: \${err}\`);
      }
    }

    const normalizedPrefix = this.prefix.endsWith("/") ? this.prefix : this.prefix + "/";
    const manifestUrl = normalizedPrefix + this.manifestFile;
    
    return this.http.get<{ locales?: Record<string, string[]> }>(manifestUrl).pipe(
      map(manifest => {
        // Try specific language first (e.g., "en-US")
        let files = manifest?.locales?.[lang] ?? [];
        
        // If not found, try main language code (e.g., "en" from "en-US")
        if (!files.length && lang.includes("-")) {
          const mainLang = lang.split("-")[0].toLowerCase();
          files = manifest?.locales?.[mainLang] ?? [];
        }
        
        return files;
      }),
      switchMap(files => {
        if (!files.length) {
          console.warn(\`[TgTranslationLoader] No translation files found for language: \${lang}\`);
          return of({} as TgTranslations);
        }
        const urls = files.map(file => normalizedPrefix + file.replace(/^\\//, ""));
        return forkJoin(
          urls.map(url => this.http.get<TgTranslations>(url).pipe(
            catchError(err => {
              console.error(\`[TgTranslationLoader] ✗ Failed to load \${url}:\`, err);
              return of({} as TgTranslations);
            })
          ))
        ).pipe(
          map(chunks => {
            const merged = chunks.reduce((acc, chunk) => deepMerge(acc, chunk), {} as TgTranslations);
            
            // Cache in sessionStorage
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify(merged));
            } catch (err) {
              console.warn(\`[TgTranslationLoader] Warning: Could not cache translation: \${err}\`);
            }
            
            return merged;
          })
        );
      }),
      catchError(err => {
        console.error(\`[TgTranslationLoader] ✗ Failed to load manifest from \${manifestUrl}:\`, err);
        console.error(\`[TgTranslationLoader] Make sure:\`);
        console.error(\`  1. The manifest file exists at: \${manifestUrl}\`);
        console.error(\`  2. The i18n folder is included in angular.json assets array\`);
        console.error(\`  3. The Angular dev server is serving the files correctly\`);
        return of({} as TgTranslations);
      })
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(target: TgTranslations, source: TgTranslations): TgTranslations {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      target[key] = deepMerge({ ...existing }, value as TgTranslations);
    } else {
      target[key] = value;
    }
  }
  return target;
}
`;

  const readme = `# TgTranslationLoader

This folder is auto-generated by the **Angular Translation Extractor** extension.

It contains:
- \`tg-translate-loader.ts\` - An Angular HTTP loader that merges all locale JSON files into one object
- \`readme.md\` - This file with usage and configuration guidance

## About the Extractor

The Angular Translation Extractor intelligently scans your TypeScript and HTML files to extract user-facing strings for translation.

### What Gets Extracted

✅ **Extracted strings:**
- Strings in \`@Component\` decorators (template, selector, etc.)
- Alert/confirmation messages: \`alert()\`, \`confirm()\`, \`prompt()\`
- Console messages: \`console.log()\`, \`console.error()\`, \`console.warn()\`
- Message service calls: \`this.toastr.error()\`, \`this.snackBar.open()\`, \`showMessage()\`
- Object properties: \`title\`, \`message\`, \`placeholder\`, \`label\`, \`tooltip\`, \`errorMessage\`, etc.
- HTML text content and attribute values

❌ **Skipped strings:**
- Control flow conditions: \`if\`, \`for\`, \`while\`, \`switch\`, ternary operators
- Import/export statements
- Technical identifiers and constants
- URLs, paths, and module specifiers
- State object values

### Automatic Translation Services

The extension includes **built-in automatic translation** - no API key or account required!

You can choose between two free translation services:

#### Option 1: Google Translate (Recommended) ⭐

Google Translate provides **high-quality translations** using the same public API as translate.google.com.

**Pros:**
- Excellent translation quality
- Fast and reliable
- Handles context well
- Free to use

**Cons:**
- Rate limited (built-in delays prevent blocking)
- May change their API without notice (though unlikely)

#### Option 2: LibreTranslate (Alternative)

LibreTranslate is an open-source translation service hosted in the cloud.

**Pros:**
- Free and open-source
- No rate limiting concerns
- Self-hostable if you need to
- Good for low-volume translations

**Cons:**
- ⚠️ **Lower translation quality compared to Google Translate**
- May produce awkward or grammatically incorrect translations
- Recommended only if Google Translate is unavailable
- Translations should be reviewed and corrected manually

#### Configuration

Choose your translation service in VS Code settings:

\`\`\`json
{
  "i18nExtractor.autoTranslate": true,
  "i18nExtractor.autoTranslateDefaultLanguage": false,
  "i18nExtractor.translationService": "google"  // or "libretranslate"
}
\`\`\`

Key settings:
- \`i18nExtractor.autoTranslate\` - Enable/disable automatic translation (default: \`true\`)
- \`i18nExtractor.autoTranslateDefaultLanguage\` - Translate the default language (default: \`false\`)
- \`i18nExtractor.translationService\` - Choose \`"google"\` (default, recommended) or \`"libretranslate"\`
- \`i18nExtractor.googleTranslateDelay\` - Delay between requests in milliseconds (default: \`500\`, minimum: \`100\`)

#### How It Works

When you run the extraction command:
1. Extracts all user-facing strings from your code
2. Generates a base language JSON file (e.g., \`en.json\`) with all extracted strings
3. **Automatically translates** the base file to all configured target languages using your chosen service
4. Creates translated JSON files (e.g., \`pt.json\`, \`es.json\`, \`fr.json\`, etc.)

#### Translation Process Example

\`\`\`
Base language file: src/assets/I18n/home/en.json
{
  "title": "Welcome",
  "message": "Hello World"
}

↓ Translation Service (Google or LibreTranslate)

Target files:
- src/assets/I18n/home/pt.json → { "title": "Bem-vindo", "message": "Olá Mundo" }
- src/assets/I18n/home/es.json → { "title": "Bienvenido", "message": "Hola Mundo" }
- src/assets/I18n/home/fr.json → { "title": "Bienvenue", "message": "Bonjour le monde" }
\`\`\`

#### Rate Limiting Protection

The extension includes automatic rate limiting protection:
- Default 500ms delay between translation requests
- Prevents temporary blocking from the translation service
- Configurable via \`googleTranslateDelay\` setting
- Progress shown in the output panel during translation

#### Translation Quality Notes

**Google Translate:**
- Produces professional-quality translations suitable for production
- Can be used directly in applications
- Minimal manual review needed

**LibreTranslate:**
- Generated translations may contain grammatical errors
- Sentence structure may not be natural
- **Always review and correct translations manually before using in production**
- Good for quick previews or testing purposes

#### Disabling Automatic Translation

To disable automatic translation entirely:

\`\`\`json
{
  "i18nExtractor.autoTranslate": false
}
\`\`\`

Or to skip translating the default language (source):

\`\`\`json
{
  "i18nExtractor.autoTranslateDefaultLanguage": false  // don't translate default language
}
\`\`\`

Or use a custom translation command instead.

#### Tips for Using Auto-Translated Content

- Translations are saved to JSON files and can be manually refined later
- Professional translators can review and improve auto-translated content
- Re-running extraction with \`updateMode: "merge"\` preserves existing manual translations

#### Troubleshooting Translation Issues

If translations fail:
1. Check your internet connection
2. Increase the \`googleTranslateDelay\` setting (try \`1000\` or \`2000\` ms)
3. Check the Output panel for detailed error messages
4. If using LibreTranslate and it fails, switch back to Google Translate:
   \`\`\`json
   "i18nExtractor.translationService": "google"
   \`\`\`
5. For LibreTranslate quality issues, consider using Google Translate instead

## What This Loader Does

The loader reads locale JSON files from:
- \`${outputRoot}\`

Each source file gets its own folder, and each locale gets its own JSON file. The loader uses a manifest file (\`translate-manifest.json\`) to know which JSONs to load for a given locale and merges them into one nested object.

## Language Code Fallback

The loader automatically handles language code fallback:
- When requesting \`en-US\`, it first tries to load \`en-US.json\`
- If not found, it falls back to \`en.json\` (main language code)
- This allows you to use the \`onlyMainLanguages\` configuration to generate fewer JSON files

Example: Instead of maintaining \`en-US.json\`, \`en-GB.json\`, \`en-CA.json\`, you can just have one \`en.json\` that serves all English variants.

## Usage in Angular Standalone App

\`\`\`typescript
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { importProvidersFrom } from "@angular/core";
import { TgTranslationLoader } from "./translate/tg-translate-loader";

export function HttpLoaderFactory(http: HttpClient): TranslateLoader {
  return new TgTranslationLoader(http, "${outputRootRelative}");
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    importProvidersFrom(
      TranslateModule.forRoot({
        defaultLanguage: "${baseLocaleCode}",
        loader: {
          provide: TranslateLoader,
          useFactory: HttpLoaderFactory,
          deps: [HttpClient]
        }
      })
    )
  ]
};
\`\`\`

## Usage in Component

\`\`\`typescript
import { Component, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TranslateModule],
  template: \`
    <h1>{{ 'app.title' | translate }}</h1>
    <p>{{ 'app.welcome' | translate }}</p>
    <button (click)="switchLanguage('pt')">Português</button>
    <button (click)="switchLanguage('es')">Español</button>
  \`
})
export class AppComponent {
  private translate = inject(TranslateService);

  switchLanguage(lang: string) {
    this.translate.use(lang);
  }
}
\`\`\`

## Configuration Options

The loader accepts the following options:

- \`prefix\` (optional): Base URL to the locale root folder (default: \`"${outputRootRelative}"\`)
- \`suffix\` (optional): File suffix for JSON files (default: \`".json"\`)
- \`manifestFile\` (optional): Manifest file name (default: \`"translate-manifest.json"\`)

Example with custom configuration:
\`\`\`typescript
export function HttpLoaderFactory(http: HttpClient): TranslateLoader {
  return new TgTranslationLoader(
    http,
    "./custom/path/",  // custom prefix
    ".json",           // suffix
    "manifest.json"    // custom manifest file name
  );
}
\`\`\`

## Files Generated

- Loader: \`${path.posix.join(srcDir, "translate", "tg-translate-loader.ts")}\`
- Readme: \`${path.posix.join(srcDir, "translate", "readme.md")}\`
- Manifest: \`${path.posix.join(outputRoot, "translate-manifest.json")}\`

## Configured Languages

${languages.map(l => `- **${l.code}** - ${l.englishName || l.code}${l.default ? ' (default)' : ''}`).join("\n")}

## Extension Configuration

Access settings via: **File → Preferences → Settings** → Search for "Angular Translation Extractor"

Key settings:
- \`i18nExtractor.autoTranslate\` - Automatically translate to target languages (default: \`true\`)
- \`i18nExtractor.autoTranslateDefaultLanguage\` - Translate the default language (default: \`false\`)
- \`i18nExtractor.outputRoot\` - Where to generate JSON files (default: \`"src/assets/I18n"\`)
- \`i18nExtractor.translationService\` - Translation service to use: \`"google"\` (recommended) or \`"libretranslate"\` (lower quality)
- \`i18nExtractor.googleTranslateDelay\` - Delay between translation requests in milliseconds (default: \`500\`)
- \`i18nExtractor.onlyMainLanguages\` - Generate only main language codes like \`en\`, \`pt\` (default: \`false\`)
- \`i18nExtractor.onlyGenerateActiveLangs\` - Only generate files for active languages (default: \`false\`)

### Translation Service Comparison

| Feature | Google Translate | LibreTranslate |
|---------|------------------|----------------|
| Quality | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐ Poor |
| Speed | Fast | Fast |
| Free | Yes | Yes |
| API Key Required | No | No |
| Rate Limiting | Yes (managed) | No |
| Recommended | ✅ Yes | ❌ Use only if needed |

## Manual Translation Scripts

Translation scripts have been generated in your \`scripts/\` directory for manual re-translation at any time:

### Google Translate Script

**Command:** \`npm run i18n:translate:google\`

**Location:** \`scripts/translate-google.cjs\`

Translates all missing keys using Google Translate (high quality).

**Basic Usage:**
\`\`\`bash
npm run i18n:translate:google
\`\`\`

**Command-line Options:**

- \`--fast\` - Remove delays between API requests (default: 500ms delay)
  \`\`\`bash
  npm run i18n:translate:google -- --fast
  \`\`\`
  Speeds up translation by ~50-100% depending on number of keys.

- \`--diff\` - Preview what will be translated without applying changes
  \`\`\`bash
  npm run i18n:translate:google -- --diff
  \`\`\`
  Show all untranslated keys for review before translation.

- \`--parallel\` - Translate multiple keys concurrently (up to 5 at once)
  \`\`\`bash
  npm run i18n:translate:google -- --parallel
  \`\`\`
  Speeds up translation significantly for large files.

- **Combine options:**
  \`\`\`bash
  npm run i18n:translate:google -- --fast --parallel
  \`\`\`

**What it does:**
- Finds all \`${baseLocaleCode}.json\` files in \`${outputRoot}\`
- For each target language, translates only missing keys
- Preserves existing translations (won't overwrite manual edits)
- Shows progress with colored output

**Example output (normal mode):**
\`\`\`
🌐 Starting Google Translate...
📁 Found 2 base language file(s)
🎯 Target languages: pt, es

📄 Processing: ./src/assets/I18n/common/en.json
  → pt: 5 key(s) to translate
  ✅ pt: saved
  → es: 5 key(s) to translate
  ✅ es: saved

✅ Translation complete! (10 keys translated)
\`\`\`

**Example output (--diff mode):**
\`\`\`
🌐 Starting Google Translate...
📋 Diff mode - showing what would be translated

📁 Found 1 base language file(s)
🎯 Target languages: pt, es

📄 Processing: ./src/assets/I18n/common/en.json
  → pt: 3 key(s) to translate
    • "welcome": "Welcome to our app"
    • "goodbye": "Goodbye"
    • "error": "An error occurred"

📋 Diff mode - use without --diff to apply translations
\`\`\`

### LibreTranslate Script

**Command:** \`npm run i18n:translate:libretranslate\`

**Location:** \`scripts/translate-libretranslate.cjs\`

Translates all missing keys using LibreTranslate (lower quality, requires review).

**Basic Usage:**
\`\`\`bash
npm run i18n:translate:libretranslate
\`\`\`

**Command-line Options:**

- \`--fast\` - Remove delays between API requests
  \`\`\`bash
  npm run i18n:translate:libretranslate -- --fast
  \`\`\`

- \`--diff\` - Preview translations without applying them
  \`\`\`bash
  npm run i18n:translate:libretranslate -- --diff
  \`\`\`

- \`--parallel\` - Translate multiple keys concurrently
  \`\`\`bash
  npm run i18n:translate:libretranslate -- --parallel
  \`\`\`

- **Combine options:**
  \`\`\`bash
  npm run i18n:translate:libretranslate -- --fast --parallel
  \`\`\`

**Important:** ⚠️ LibreTranslate produces lower-quality translations. **Always use \`--diff\` first to review** and manually correct the translations before deploying.

**Recommended workflow:**
\`\`\`bash
# 1. Preview what LibreTranslate would translate
npm run i18n:translate:libretranslate -- --diff

# 2. Review the output carefully

# 3. Apply translations
npm run i18n:translate:libretranslate

# 4. Manually fix any awkward or incorrect translations in the JSON files

# 5. Commit your changes
\`\`\`

### Required Dependencies

Both scripts require these npm packages (should already be in your \`package.json\`):

\`\`\`json
{
  "dependencies": {
    "axios": "^1.6.0",
    "fast-glob": "^3.3.2"
  }
}
\`\`\`

If they're missing, install them:

\`\`\`bash
npm install axios fast-glob
\`\`\`

### Integration with package.json

Add these scripts to your \`package.json\` to enable npm commands:

\`\`\`json
{
  "scripts": {
    "i18n:translate:google": "node scripts/translate-google.cjs",
    "i18n:translate:libretranslate": "node scripts/translate-libretranslate.cjs"
  }
}
\`\`\`

## Notes


- This loader uses Angular HttpClient and is designed for runtime use in Angular apps
- Ensure the \`${outputRoot}\` folder is served as static assets
- The extension automatically updates \`main.ts\` to wire up the TranslateModule (can be disabled in settings)
- All generated files can be safely regenerated by running the extraction command again

## Need Help?

Run the command: **Angular Translation Extractor: Extract Strings** from the VS Code Command Palette (Ctrl+Shift+P)
`;

  const manifest = buildManifest({
    outputRootAbs,
    baseLocaleCode,
    languages,
    baseFiles,
    onlyMainLanguages
  });

  const allowOverwrite = updateMode !== "merge";

  if (await shouldWriteFile(loaderPath, allowOverwrite)) {
    await fs.writeFile(loaderPath, loaderSource, "utf8");
  }
  if (await shouldWriteFile(readmePath, allowOverwrite)) {
    await fs.writeFile(readmePath, readme, "utf8");
  }
  if (await shouldWriteFile(manifestPath, allowOverwrite)) {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  }

  // Generate language selector component
  const selectorComponentPath = path.join(translateDirAbs, "language-selector.component.ts");
  const selectorTemplatePath = path.join(translateDirAbs, "language-selector.component.html");
  const selectorStylePath = path.join(translateDirAbs, "language-selector.component.css");

  const selectorComponent = getLanguageSelectorComponent(outputRootRelative);
  const selectorTemplate = getLanguageSelectorTemplate();
  const selectorStyle = getLanguageSelectorStyle();

  if (await shouldWriteFile(selectorComponentPath, allowOverwrite)) {
    await fs.writeFile(selectorComponentPath, selectorComponent, "utf8");
  }
  if (await shouldWriteFile(selectorTemplatePath, allowOverwrite)) {
    await fs.writeFile(selectorTemplatePath, selectorTemplate, "utf8");
  }
  if (await shouldWriteFile(selectorStylePath, allowOverwrite)) {
    await fs.writeFile(selectorStylePath, selectorStyle, "utf8");
  }

  // Generate translation scripts
  const scriptsDir = path.join(workspaceRoot, "scripts");
  await ensureDir(scriptsDir);

  const googleTranslateScript = getGoogleTranslateScript(outputRoot, baseLocaleCode);
  const libretranslateScript = getLibretranslateScript(outputRoot, baseLocaleCode);

  const googleScriptPath = path.join(scriptsDir, "translate-google.cjs");
  const libretranslateScriptPath = path.join(scriptsDir, "translate-libretranslate.cjs");

  if (await shouldWriteFile(googleScriptPath, allowOverwrite)) {
    await fs.writeFile(googleScriptPath, googleTranslateScript, "utf8");
  }
  if (await shouldWriteFile(libretranslateScriptPath, allowOverwrite)) {
    await fs.writeFile(libretranslateScriptPath, libretranslateScript, "utf8");
  }

  // Update package.json with translation scripts
  const pkgResult = await updatePackageJsonScripts(workspaceRoot);
  if (pkgResult.updated) {
    console.log(`[loader-generator] ✓ Updated package.json with translation scripts`);
  } else {
    console.log(`[loader-generator] ⚠ Could not update package.json: ${pkgResult.reason}`);
  }

  return {
    loaderPath,
    readmePath,
    languageSelectorPath: selectorComponentPath,
    packageJsonUpdated: pkgResult.updated,
    packageJsonReason: pkgResult.reason
  };
}

function getMainLanguageCode(code: string): string {
  const parts = code.split("-");
  return parts[0].toLowerCase();
}

function buildManifest(opts: {
  outputRootAbs: string;
  baseLocaleCode: string;
  languages: LanguageEntry[];
  baseFiles: Array<{ baseFileAbs: string; outDirAbs: string; targets: string[] }>;
  onlyMainLanguages?: boolean;
}): { locales: Record<string, string[]> } {
  const { outputRootAbs, baseLocaleCode, languages, baseFiles, onlyMainLanguages } = opts;

  const locales: Record<string, string[]> = {};

  // Get all locale codes, converting to main language codes if needed
  const allLocales = new Set(languages.map(l => onlyMainLanguages ? getMainLanguageCode(l.code) : l.code));
  const mainBaseLocaleCode = onlyMainLanguages ? getMainLanguageCode(baseLocaleCode) : baseLocaleCode;
  allLocales.add(mainBaseLocaleCode);

  for (const locale of allLocales) {
    locales[locale] = [];
  }

  // Collect all JSON files from baseFiles
  const fileSet = new Set<string>();

  for (const entry of baseFiles) {
    const outDirAbs = entry.outDirAbs;
    for (const locale of Object.keys(locales)) {
      const fileAbs = path.join(outDirAbs, `${locale}.json`);
      const rel = path.relative(outputRootAbs, fileAbs).split(path.sep).join("/");
      fileSet.add(rel);
      locales[locale].push(rel);
    }
  }

  // Also scan the actual output directory for any additional JSON files that weren't in baseFiles
  // This handles cases where JSON files exist at the root or in other locations
  try {
    const scanDir = (dir: string, baseRel: string = "") => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "translate-manifest.json" || entry.name === "readme.md") continue;

        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(baseRel, entry.name).split(path.sep).join("/");

        if (entry.isDirectory()) {
          scanDir(fullPath, relPath);
        } else if (entry.isFile() && entry.name.endsWith(".json")) {
          // Extract locale code from filename (xxx.json -> xxx)
          const localeMatch = entry.name.match(/^(.+)\.json$/);
          if (localeMatch) {
            const locale = localeMatch[1];
            if (locales.hasOwnProperty(locale) && !fileSet.has(relPath)) {
              fileSet.add(relPath);
              locales[locale].push(relPath);
            }
          }
        }
      }
    };

    if (existsSync(outputRootAbs)) {
      scanDir(outputRootAbs);
    }
  } catch (err) {
    console.warn(`[buildManifest] Warning scanning output directory: ${err}`);
  }

  return { locales };
}

async function shouldWriteFile(fileAbs: string, allowOverwrite: boolean): Promise<boolean> {
  if (allowOverwrite) return true;
  try {
    await fs.stat(fileAbs);
    return false;
  } catch {
    return true;
  }
}

function getLanguageSelectorComponent(outputRootRelative: string): string {
  return `import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { HttpClient } from '@angular/common/http';

export interface Language {
  code: string;
  englishName?: string;
  nativeName?: string;
  flag?: string;
  default?: boolean;
  active?: boolean;
  rank?: number;
}

@Component({
  selector: 'app-language-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './language-selector.component.html',
  styleUrls: ['./language-selector.component.css']
})
export class LanguageSelectorComponent implements OnInit {
  languages: Language[] = [];
  currentLanguage: Language | null = null;
  isOpen = false;

  constructor(
    private translateService: TranslateService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.loadLanguages();
    
    // Set initial language
    const currentLang = this.translateService.currentLang || this.translateService.defaultLang;
    if (currentLang) {
      this.currentLanguage = this.languages.find(l => l.code === currentLang) || null;
    }
  }

  private loadLanguages(): void {
    // Try to load from manifest or languages JSON
    this.http.get<{ locales: Record<string, string[]> }>('${outputRootRelative}translate-manifest.json')
      .subscribe({
        next: (manifest) => {
          this.languages = Object.keys(manifest.locales).map(code => ({ code }));
          this.tryLoadLanguageMetadata();
        },
        error: () => {
          // Fallback: try to load from i18n-languages.json
          this.tryLoadLanguageMetadata();
        }
      });
  }

  private tryLoadLanguageMetadata(): void {
    this.http.get<Language[]>('assets/i18n-languages.json')
      .subscribe({
        next: (langs) => {
          if (this.languages.length === 0) {
            this.languages = langs.filter(l => l.active !== false);
          } else {
            // Merge metadata
            this.languages = this.languages.map(lang => {
              const metadata = langs.find(l => l.code === lang.code);
              return metadata ? { ...lang, ...metadata } : lang;
            });
          }
          
          const currentLang = this.translateService.currentLang || this.translateService.defaultLang;
          if (currentLang) {
            this.currentLanguage = this.languages.find(l => l.code === currentLang) || this.languages[0] || null;
          }
        },
        error: () => {
          // Use basic language list without metadata
          if (!this.currentLanguage && this.languages.length > 0) {
            this.currentLanguage = this.languages[0];
          }
        }
      });
  }

  selectLanguage(language: Language): void {
    this.currentLanguage = language;
    this.translateService.use(language.code);
    this.isOpen = false;
    
    // Save preference to localStorage
    localStorage.setItem('selectedLanguage', language.code);
  }

  toggleDropdown(): void {
    this.isOpen = !this.isOpen;
  }

  getDisplayName(language: Language): string {
    return language.nativeName || language.englishName || language.code.toUpperCase();
  }
}
`;
}

function getLanguageSelectorTemplate(): string {
  return `<div class="language-selector" (click)="toggleDropdown()">
  <div class="current-language">
    <img 
      *ngIf="currentLanguage?.flag" 
      [src]="currentLanguage.flag" 
      [alt]="getDisplayName(currentLanguage)"
      class="flag-icon"
    >
    <span class="language-name">{{ getDisplayName(currentLanguage!) }}</span>
    <svg class="dropdown-icon" [class.open]="isOpen" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 6l4 4 4-4z"/>
    </svg>
  </div>

  <div class="language-dropdown" *ngIf="isOpen">
    <div 
      *ngFor="let language of languages" 
      class="language-option"
      [class.selected]="language.code === currentLanguage?.code"
      (click)="selectLanguage(language); $event.stopPropagation()"
    >
      <img 
        *ngIf="language.flag" 
        [src]="language.flag" 
        [alt]="getDisplayName(language)"
        class="flag-icon"
      >
      <span class="language-name" [title]="language.englishName">
        {{ getDisplayName(language) }}
      </span>
      <svg *ngIf="language.code === currentLanguage?.code" class="check-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.854 3.146a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 9.793l6.646-6.647a.5.5 0 0 1 .708 0z"/>
      </svg>
    </div>
  </div>
</div>

<!-- Optional: Add click-outside directive or use a backdrop -->
<div class="language-backdrop" *ngIf="isOpen" (click)="isOpen = false"></div>
`;
}

function getLanguageSelectorStyle(): string {
  return `.language-selector {
  position: relative;
  display: inline-block;
  user-select: none;
  z-index: 1000;
}

.current-language {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--background, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 150px;
}

.current-language:hover {
  background: var(--hover-background, #f5f5f5);
  border-color: var(--hover-border-color, #d0d0d0);
}

.flag-icon {
  width: 24px;
  height: 18px;
  object-fit: cover;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.language-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color, #333333);
}

.dropdown-icon {
  transition: transform 0.2s ease;
  color: var(--icon-color, #666666);
}

.dropdown-icon.open {
  transform: rotate(180deg);
}

.language-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--background, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  animation: dropdownSlide 0.2s ease;
  max-height: 300px;
  overflow-y: auto;
}

@keyframes dropdownSlide {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.language-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.language-option:hover {
  background: var(--hover-background, #f5f5f5);
}

.language-option.selected {
  background: var(--selected-background, #e3f2fd);
  color: var(--selected-text-color, #1976d2);
}

.language-option .language-name {
  flex: 1;
}

.check-icon {
  color: var(--selected-text-color, #1976d2);
}

.language-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
}

/* Scrollbar styling (optional) */
.language-dropdown::-webkit-scrollbar {
  width: 6px;
}

.language-dropdown::-webkit-scrollbar-track {
  background: transparent;
}

.language-dropdown::-webkit-scrollbar-thumb {
  background: var(--scrollbar-color, #cccccc);
  border-radius: 3px;
}

.language-dropdown::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-hover-color, #999999);
}

/* Dark mode support (optional - uses CSS variables) */
@media (prefers-color-scheme: dark) {
  .language-selector {
    --background: #2d2d2d;
    --hover-background: #3d3d3d;
    --border-color: #404040;
    --hover-border-color: #505050;
    --text-color: #e0e0e0;
    --icon-color: #a0a0a0;
    --selected-background: #1e3a5f;
    --selected-text-color: #64b5f6;
    --scrollbar-color: #505050;
    --scrollbar-hover-color: #606060;
  }
}
`;
}
