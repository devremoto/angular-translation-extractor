# Angular Translation Extractor

A VS Code extension that automatically extracts hard-coded user-facing strings from your Angular source code, generates organized i18n JSON files with support for multiple locales, and automatically replaces strings in your source code with translation keys.

## Features

- 🔍 **Automatic String Extraction** - Scans JS/TS/HTML files for user-facing strings
- 📁 **Per-File Organization** - Generates separate locale files for each component with replicated folder structure
- 🔄 **Source Code Transformation** - Automatically replaces strings with translation keys (`{{ 'KEY' | translate }}` in HTML, `translateService.translate('KEY')` in TS)
- 🧩 **Auto-Import TranslateModule** - Automatically adds TranslateModule to component imports arrays
- 💉 **Auto-Inject TranslateService** - Automatically injects TranslateService into TypeScript component constructors
- 🌍 **Smart Language Handling** - Generate files for specific locales (en-US) or main languages (en) with automatic fallback
- 🎯 **Active Language Filtering** - Generate only active languages from your configuration
- 🔑 **Nested Key Structure** - UPPERCASE keys with underscores in hierarchical JSON format
- ✨ **Auto-fill Metadata** - Automatically generates language names and flags
- 🔄 **Translation Preservation** - Existing translations are never overwritten
- 🚫 **Smart Filtering** - Automatically excludes technical strings, imports, object keys, state object values
- 📦 **Custom Loader Generator** - Creates optimized Angular HttpClient loader with language fallback support
- 🎨 **main.ts Auto-Wiring** - Automatically configures TranslateModule in your Angular bootstrap
- 🎨 **Language Selector Component** - Generates ready-to-use UI component for language switching
- 🔧 **Translation Command Integration** - Optional automatic translation after extraction

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X or Cmd+Shift+X)
3. Search for "Angular Translation Extractor"
4. Click Install

### From VSIX File

1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions
4. Click the "..." menu → "Install from VSIX..."
5. Select the downloaded file

### Manual Installation

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to open a new VS Code window with the extension loaded

## Requirements

### Dependencies

- **VS Code**: 1.85.0 or higher
- **Node.js**: For language metadata generation and extension runtime
- **Angular Project**: This extension is designed for Angular applications using `@ngx-translate/core`

### Required NPM Packages (in your Angular project)

```bash
npm install @ngx-translate/core @ngx-translate/http-loader
```

These packages are required for the generated translation loader to work in your Angular application.

## Getting Started

### 1. Create a Languages List File

Create a JSON file (default: `src/app/core/json/language-code.json`) with your target locales:

```json
[
  {
    "rank": 1,
    "code": "en-US",
    "default": true,
    "active": true
  },
  {
    "rank": 2,
    "code": "pt-BR",
    "active": true
  },
  {
    "rank": 3,
    "code": "es-ES",
    "active": false
  }
]
```

**Field Descriptions:**
- `code` (required) - Locale code (e.g., "en-US", "pt-BR")
- `default` (optional) - Set to `true` to use as default language (overrides `baseLocaleCode` setting)
- `active` (optional) - Set to `true` to generate JSON for this language when `onlyGenerateActiveLangs` is enabled
- `rank` (optional) - Sort order for language selection UI
- `englishName`, `nativeName`, `flag` (auto-generated) - Extension will fill these automatically

### 2. Configure Settings (Optional)

Open VS Code Settings (`Ctrl+,` or `Cmd+,`) and search for "Angular Translation Extractor" to customize:

- Source directory to scan
- Output directory for locale files
- Base locale code
- Minimum string length
- HTML attributes to extract

### 3. Run the Extraction

You can run the extraction from multiple places:

1. Command Palette: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
  - Type: **"Angular: Extract translations"**
2. Explorer context menu (right-click a folder)
3. Editor title menu (toolbar)

The extension will:
- Scan your source files
- Extract user-facing strings
- Generate locale JSON files
- Auto-fill language metadata
- Generate translation loader and language selector component
- Display progress in the "Angular Translation Extractor" output channel

### 4. Check the Results

**Source file:**
```
src/components/LoginForm.ts
```

**Generated translations:**
```
src/assets/I18n/components/LoginForm/
  ├── en-US.json
  ├── pt-BR.json
  └── es-ES.json
```

**Generated utilities:**
```
src/translate/
  ├── tg-translate-loader.ts              (Translation loader)
  ├── readme.md                            (Setup instructions)
  ├── language-selector.component.ts       (Language selector component)
  ├── language-selector.component.html     (Component template)
  └── language-selector.component.css      (Component styles)

src/assets/I18n/
  └── translate-manifest.json             (File manifest)
```

## Example Extraction

### JavaScript/TypeScript

**Input:**
```typescript
const message = "Welcome to our app";
const title = `User Profile`;
```

**Generated base locale (en-US.json):**
```json
{
  "COMPONENTS": {
    "LOGINFORM": {
      "WELCOME_TO_OUR_APP": "Welcome to our app",
      "USER_PROFILE": "User Profile"
    }
  }
}
```

### HTML

**Input:**
```html
<button title="Click to submit">Send</button>
<img alt="Company logo" src="logo.png">
```

**Generated keys:**
```json
{
  "COMPONENTS": {
    "FORM": {
      "CLICK_TO_SUBMIT": "Click to submit",
      "SEND": "Send",
      "COMPANY_LOGO": "Company logo"
    }
  }
}
```

## Output Structure

## Output Structure

The extension replicates your source folder structure for organized locale files:

**Source structure:**
```
src/
  ├── components/
  │   ├── LoginForm.ts
  │   └── Header.html
  └── pages/
      └── Home.js
```

**Generated output:**
```
src/assets/I18n/
  ├── components/
  │   ├── LoginForm/
  │   │   ├── en-US.json
  │   │   ├── pt-BR.json
  │   │   └── es-ES.json
  │   └── Header/
  │       ├── en-US.json
  │       ├── pt-BR.json
  │       └── es-ES.json
  └── pages/
      └── Home/
          ├── en-US.json
          ├── pt-BR.json
          └── es-ES.json
```

## Translation Loader

Every extraction run also generates a translation loader inside your source directory:

- `src/translate/tg-translate-loader.ts`
- `src/translate/readme.md`

It also generates a manifest file under the output root:

- `src/assets/I18n/translate-manifest.json`

The loader uses the manifest to load all `{locale}.json` files via Angular `HttpClient` and merges them into a single nested object.

### Automatic Language Fallback

The generated loader includes intelligent language fallback:

**When `onlyMainLanguages: false`** (specific locales like en-US, pt-BR):
- Loads files named exactly as requested (e.g., `en-US.json`, `pt-BR.json`)

**When `onlyMainLanguages: true`** (main languages like en, pt):
- Request for `en-US` automatically falls back to `en.json`
- Request for `pt-BR` automatically falls back to `pt.json`
- Request for `es-MX` automatically falls back to `es.json`

This allows you to generate fewer files while supporting multiple regional variants:

```typescript
// User selects "en-US" in the app
translateService.use('en-US');
// Loader tries "en-US.json" first
// Falls back to "en.json" if not found
```

**Quick usage:**
```typescript
import { HttpClient } from "@angular/common/http";
import { TranslateLoader } from "@ngx-translate/core";
import { TgTranslationLoader } from "./translate/tg-translate-loader";

export function HttpLoaderFactory(http: HttpClient): TranslateLoader {
  // The path is automatically configured based on your outputRoot setting
  return new TgTranslationLoader(http, "./assets/I18n/");
}
```

The loader path is automatically generated based on your `i18nExtractor.outputRoot` configuration setting. If you need a custom path, you can modify the prefix parameter. The auto-generated translate/readme.md file includes the full configuration details.

## Language Selector Component

Every extraction run also generates a ready-to-use **Language Selector Component** that provides a dropdown UI for switching languages:

**Generated files:**
- `src/translate/tg-language-selector.component.ts` - Anguar standalone component
- `src/translate/tg-language-selector.component.html` - Template with dropdown UI
- `src/translate/tg-language-selector.component.css` - Professional styles with dark mode support

### Features

- 🎨 **Professional UI** - Modern dropdown with flags, language names, and smooth animations
- 🌓 **Dark Mode Support** - Automatically adapts to user's color scheme preference
- 🔄 **Auto-Configuration** - Reads languages from your translate manifest and i18n-languages.json
- 💾 **Persistent Selection** - Saves user's language choice to localStorage
- 🌍 **Language Metadata** - Shows native names, English names, and flags (if configured)
- ✨ **Standalone Component** - No module imports needed, works with modern Angular

### Usage Example

The component is generated as a standalone component with the selector `tg-language-selector`. You can import and use it directly:

```typescript
// In your app component or any standalone component
import { Component } from '@angular/core';
import { LanguageSelectorComponent } from './translate/tg-language-selector.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LanguageSelectorComponent],
  template: `
    <header>
      <h1>My App</h1>
      <tg-language-selector></tg-language-selector>
    </header>
    <router-outlet></router-outlet>
  `
})
export class AppComponent {}
```

### Customization

The component uses CSS variables for easy customization:

```css
/* In your global styles.css or component styles */
.language-selector {
  --background: #ffffff;
  --hover-background: #f5f5f5;
  --border-color: #e0e0e0;
  --text-color: #333333;
  --selected-background: #e3f2fd;
  --selected-text-color: #1976d2;
}
```

### Language Metadata

For best results, ensure your `i18n-languages.json` includes display metadata:

```json
[
  {
    "code": "en-US",
    "englishName": "English (United States)",
    "nativeName": "English",
    "flag": "🇺🇸",
    "default": true,
    "active": true
  },
  {
    "code": "pt-BR",
    "englishName": "Portuguese (Brazil)",
    "nativeName": "Português",
    "flag": "🇧🇷",
    "active": true
  }
]
```

The component will auto-generate basic labels if metadata is missing, but providing full details creates a better user experience.

## Configuration Reference

Access settings via: **File → Preferences → Settings** (or `Ctrl+,`) → Search for "Angular Translation Extractor"

### Basic Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `i18nExtractor.srcDir` | `"src"` | Folder to scan for source files (relative to workspace root) |
| `i18nExtractor.outputRoot` | `"src/assets/I18n"` | Output root for generated locale JSONs |
| `i18nExtractor.languagesJsonPath` | `"src/app/core/json/language-code.json"` | Path to languages list JSON file |
| `i18nExtractor.baseLocaleCode` | `"en"` | Base locale code (e.g., `"en"`, `"en-US"`, `"en-GB"`) |
| `i18nExtractor.minStringLength` | `2` | Ignore strings shorter than this length |
| `i18nExtractor.updateMode` | `"merge"` | Controls JSON file updates: `"merge"` (preserve translations, add new keys), `"overwrite"` (recreate non-default languages), `"recreate"` (recreate all including default) |
| `i18nExtractor.mainTsPath` | `"{srcDir}/main.ts"` | Path to Angular main.ts (supports `{srcDir}` placeholder) |
| `i18nExtractor.angularBootstrapStyle` | `"standalone"` | How to wire TranslateModule in main.ts (`standalone` or `module`) |
| `i18nExtractor.updateMainTs` | `true` | If true, update main.ts to wire the translation loader |
| `i18nExtractor.enableTransalationCache` | `false` | Enable/disable sessionStorage caching in the generated loader. Also updates environment files. |

### Language Generation Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `i18nExtractor.onlyGenerateActiveLangs` | `false` | If true, generate JSON files only for languages marked with `"active": true` in the languages JSON file. If false, generate for all languages. |
| `i18nExtractor.onlyMainLanguages` | `false` | If true, generate JSON files using only main language codes (e.g., `"en"` instead of `"en-US"`, `"pt"` instead of `"pt-BR"`). The loader automatically maps region-specific codes to their main language. Perfect for reducing file count when regional differences are minimal. |

**Language Generation Examples:**

With `onlyGenerateActiveLangs: false` and `onlyMainLanguages: false`:
- Generates: `en-US.json`, `en-GB.json`, `pt-BR.json`, `es-ES.json`

With `onlyGenerateActiveLangs: true` and `onlyMainLanguages: false`:
- Generates: Only languages with `"active": true`
- Example: `en-US.json`, `pt-BR.json` (skips `es-ES.json` if `active: false`)

With `onlyGenerateActiveLangs: false` and `onlyMainLanguages: true`:
- Generates: `en.json`, `pt.json`, `es.json`
- Loader automatically maps `en-US` → `en`, `en-GB` → `en`, `pt-BR` → `pt`, etc.

### Filtering Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `i18nExtractor.ignoreGlobs` | `["**/*.test.*", "**/*.spec.*", ...]` | Glob patterns to exclude from scanning |
| `i18nExtractor.skipGlobs` | `[]` | Additional glob patterns to exclude from scanning (merged with ignoreGlobs) |
| `i18nExtractor.htmlAttributeNames` | `["title", "alt", "placeholder", ...]` | HTML attribute names to extract values from |

**Default ignored patterns:**
- `**/*.test.*` - Test files
- `**/*.spec.*` - Spec files  
- `**/node_modules/**` - Dependencies
- `**/dist/**`, `**/build/**` - Build outputs
- `**/.next/**` - Next.js build cache
- `**/main.ts` - Angular main bootstrap file (hardcoded exclusion from extraction)

**Default HTML attributes:**
- `title` - Element tooltips
- `alt` - Image alt text
- `placeholder` - Input placeholders
- `aria-label` - Accessibility labels
- `aria-placeholder` - Accessibility placeholders

### Update Mode Settings

The `updateMode` setting controls how JSON translation files and generated artifacts are updated:

| Mode | Default Language | Non-Default Languages | Generated Files (loader, readme, etc.) |
|------|------------------|----------------------|---------------------------------------|
| **merge** *(default)* | Merges with existing, preserves manual translations | Preserves translations, adds new keys as blank | Only writes if file doesn't exist |
| **overwrite** | Merges with existing, preserves manual translations | Recreates with all keys as blank | Overwrites existing files |
| **recreate** | Recreates, loses manual edits | Recreates with all keys as blank | Overwrites existing files |

**When to use each mode:**

- **merge** (Recommended for most workflows):
  - Preserves your manual translations
  - Only adds new extracted strings as blank entries
  - Safe for iterative development
  - Generated files (loader, readme) are only created if they don't exist

- **overwrite**:
  - Use when you want to reset all non-default language translations
  - Keeps your default language (source) translations
  - Forces regeneration of all generated files
  - Useful after major restructuring

- **recreate**:
  - Complete reset of everything
  - Use only when you want to start completely fresh
  - All translations including default language are reset
  - All generated files are recreated

**Configuration:**
```json
{
  "i18nExtractor.updateMode": "merge"  // or "overwrite" or "recreate"
}
```

### Automatic Translation Services

The extension supports **automatic translation** using free public translation APIs - **no API key required!**

#### Built-in Services

| Service | Quality | Speed | API Key | Rate Limit | Recommended |
|---------|---------|-------|---------|-----------|-------------|
| **Google Translate** (Default) | ⭐⭐⭐⭐⭐ Excellent | Fast | No | Yes (managed) | ✅ **Yes** |
| **LibreTranslate** | ⭐⭐ Poor | Fast | No | No | ❌ Use only if needed |

**Features:**
- Automatic translation runs after string extraction
- Translates to all configured target languages
- Preserves manually edited translations
- Can be disabled per run or globally in settings
- Works offline after initial translation

#### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `i18nExtractor.autoTranslate` | `true` | If true, automatically initiate translations after extracting base locale strings |
| `i18nExtractor.autoTranslateDefaultLanguage` | `false` | If false, skip translating the default language (marked with `"default": true`). The default language is the translation source. |
| `i18nExtractor.translationService` | `"google"` | Auto-translation service: `"google"` (recommended) or `"libretranslate"` (lower quality) |
| `i18nExtractor.googleTranslateDelay` | `500` | Delay between translation requests in ms (minimum 100) |

#### Disable Automatic Translation

Set `autoTranslate` to false:
```json
{
  "i18nExtractor.autoTranslate": false
}
```

### Custom Translation Commands

You can also use a custom translation command/service:

| Setting | Default | Description |
|---------|---------|-------------|
| `i18nExtractor.useTranslateCommand` | `false` | Enable automatic translation using a custom command |
| `i18nExtractor.translateCommand` | `"npx-translate"` | Command to run for translation |
| `i18nExtractor.translateArgsTemplate` | `[...]` | Arguments template with placeholders |

**Placeholder variables for translation command:**
- `{baseFile}` - Path to base locale JSON file
- `{outDir}` - Output directory for the file
- `{baseLocale}` - Base locale code (e.g., `"en-US"`)
- `{targetLocale}` - Target locale code (e.g., `"pt-BR"`)

**Example configuration:**
```json
{
  "i18nExtractor.useTranslateCommand": true,
  "i18nExtractor.translateCommand": "npx",
  "i18nExtractor.translateArgsTemplate": [
    "translate-json",
    "--input",
    "{baseFile}",
    "--from",
    "{baseLocale}",
    "--to",
    "{targetLocale}",

    "--output-dir",
    "{outDir}"
  ]
}
```

**Create `scripts/translate-google.js`:**
```javascript
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const OUTPUT_ROOT = 'src/assets/I18n';
const BASE_LANG = 'en';

async function translateText(text, targetLang) {
  try {
    const url = `https://translate.google.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    return response.data[0]?.map(item => item[0]).join('') || text;
  } catch (err) {
    console.error(`Translation failed for "${text}": ${err.message}`);
    return text;
  }
}

async function translateFile(inputFile, outputDir, targetLang) {
  console.log(`Translating to ${targetLang}...`);
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  
  async function translateObj(obj) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        obj[key] = await translateText(value, targetLang);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        await translateObj(value);
      }
    }
  }
  
  await translateObj(data);
  const outputFile = path.join(outputDir, `${targetLang}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2) + '\n');
  console.log(`  ✓ Saved: ${outputFile}`);
}

(async () => {
  try {
    const glob = require('glob');
    const baseFiles = glob.sync(path.join(OUTPUT_ROOT, `**/${BASE_LANG}.json`));
    console.log(`Found ${baseFiles.length} base files\n`);
    
    for (const baseFile of baseFiles) {
      const outDir = path.dirname(baseFile);
      const targetLangs = ['pt', 'es', 'fr']; // Customize as needed
      
      for (const lang of targetLangs) {
        await translateFile(baseFile, outDir, lang);
        await new Promise(r => setTimeout(r, 500)); // Rate limiting
      }
    }
    console.log('\n✓ Translation completed!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
```

### Languages JSON Format

The languages JSON file should contain an array of locale entries. Only `code` is required; other fields will be auto-generated:

```json
[
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
    "nativeName": "português (Brasil)",
    "flag": "https://flagcdn.com/w40/br.png",
    "active": true
  },
  {
    "rank": 3,
    "code": "es-ES",
    "englishName": "Spanish (Spain)",
    "nativeName": "Español",
    "flag": "https://flagcdn.com/w40/es.png",
    "active": false
  }
]
```

**Field Descriptions:**

| Field | Required | Type | Auto-generated | Description |
|-------|----------|------|----------------|-------------|
| `code` | ✅ Yes | string | ❌ No | Locale code (e.g., `"en-US"`, `"pt-BR"`) |
| `rank` | ❌ No | number | ❌ No | Sort order (lower ranks first) |
| `englishName` | ❌ No | string | ✅ Yes | English display name |
| `nativeName` | ❌ No | string | ✅ Yes | Native display name |
| `flag` | ❌ No | string | ✅ Yes | Flag emoji or icon URL |
| `default` | ❌ No | boolean | ❌ No | If true, use as default language (overrides `baseLocaleCode` config) |
| `active` | ❌ No | boolean | ❌ No | If true (and `onlyGenerateActiveLangs: true`), generate JSON files for this language. Always generates base locale and languages with `active: true`. |

## Features

### Automatic Source Code Transformation

After extraction, the extension **automatically replaces** extracted strings in your source files with translation keys:

**HTML Files**: Strings are replaced with Angular translate pipe syntax
```html
<!-- Before -->
<button>Submit</button>
<p>Welcome to our app</p>

<!-- After -->
<button>{{ 'COMPONENTS.FORM.SUBMIT' | translate }}</button>
<p>{{ 'COMPONENTS.FORM.WELCOME_TO_OUR_APP' | translate }}</p>
```

**TypeScript/JavaScript Files**: Strings are replaced with TranslateService calls
```typescript
// Before
const message = "Welcome to our app";
const title = `User Profile`;

// After
const message = this.translateService.translate('COMPONENTS.PROFILE.WELCOME_TO_OUR_APP');
const title = this.translateService.translate('COMPONENTS.PROFILE.USER_PROFILE');
```

**Automatic TranslateModule Import**: For components with HTML templates, the extension automatically:
- Adds `import { TranslateModule } from '@ngx-translate/core';`
- Adds `TranslateModule` to the component's `imports` array (for standalone components)

**Automatic TranslateService Injection**: For TypeScript files with inline string replacements:
- Adds `import { TranslateService } from '@ngx-translate/core';`
- Injects `TranslateService` into the component constructor
- Example: `constructor(private translateService: TranslateService) {}`

### Smart Key Generation
- Keys are automatically namespaced by file path in nested object structure
- Example: `COMPONENTS.LOGINFORM.WELCOME_MESSAGE`
- Keys use UPPERCASE with underscores for word separation
- Keys are stable across multiple runs
- Collision handling with automatic numeric suffixes

### Intelligent String Detection
The extension uses advanced AST analysis to **extract**:
- ✅ String literals in explicit display context: `"Hello World"`
- ✅ Template literals (no expressions): `` `Welcome` ``
- ✅ HTML text content: `<p>Content</p>`
- ✅ HTML attribute values (configurable)
- ✅ Explicit alerts/messages: `alert("Message")`, `confirm("Sure?")`

The extension **ignores** (Strict Filtering):
- ❌ **Console logs**: `console.log(...)`, `console.error(...)`, `console.warn(...)`
- ❌ **Decorators**: `@Component` selectors, `@Injectable`, `@Pipe`, `@Directive` metadata
- ❌ **Logic**: Strings in `if`, `for`, `while`, `switch` statements
- ❌ Import/export paths: `import x from "./file"`
- ❌ Object keys: `{ name: "value" }`
- ❌ State object literals: Values in objects named `*State` or assigned to `*state` variables
- ❌ URLs and paths: `"https://..."`, `"/path/to/file"`
- ❌ Tokens/IDs: `"ABC123XYZ"`
- ❌ Template expressions: `"Hello ${name}"`
- ❌ Placeholder syntax: `"{{variable}}"`, `"${variable}"`
- ❌ Pure numbers or punctuation
- ❌ Hex codes: `"3f4a5b"`

**State Object Filtering Example:**
```typescript
// ❌ These strings are NOT extracted (state configuration data)
const initialState: WizardState = {
  currentStep: 0,
  templateExtension: 'pdf',  // ← Not extracted
  status: 'pending'          // ← Not extracted
};

// ✅ These strings ARE extracted (user-facing text)
const message = "Welcome to the wizard";
const label = "Template Extension";
```

### Deduplication
Identical strings within the same source file share the same key:

**Input:**
```typescript
const btn1 = "Submit";
const btn2 = "Submit";
const btn3 = "Cancel";
```

**Output:**
```json
{
  "COMPONENTS": {
    "FORM": {
      "SUBMIT": "Submit",
      "CANCEL": "Cancel"
    }
  }
}
```

### Translation Preservation
Existing translations are never overwritten:

**Existing pt-BR.json:**
```json
{
  "COMPONENTS": {
    "FORM": {
      "SUBMIT": "Enviar"
    }
  }
}
```

**After re-running with new strings:**
```json
{
  "COMPONENTS": {
    "FORM": {
      "SUBMIT": "Enviar",
      "CANCEL": ""
    }
  }
}
```

New keys get empty values, existing translations are preserved.

### Auto-fill Language Metadata
The extension automatically completes language information using Node.js `Intl` API:

**Your input:**
```json
[
  { "rank": 1, "code": "pt-BR" }
]
```

**Auto-generated output:**
```json
[
  {
    "rank": 1,
    "code": "pt-BR",
    "englishName": "Portuguese (Brazil)",
    "nativeName": "português (Brasil)",
    "flag": "https://flagcdn.com/w40/br.png"
  }
]
```

## Usage Tips

### 1. Run Regularly
Run the extraction after adding new UI text to keep your locale files up to date.

### 2. Review Generated Keys
Check the base locale JSON files to ensure extracted strings are appropriate for translation.

### 3. Version Control
Commit both base and target locale files. Translators can work with the target locale files directly.

### 4. Start Small
Test on a single directory first by adjusting `srcDir` setting, then expand to your full source tree.

### 5. Customize Filtering
Add patterns to `ignoreGlobs` for any folders or files you don't want scanned.

## Troubleshooting

### No strings extracted
- Check the **Output** panel (View → Output) and select "Angular Translation Extractor"
- Verify `srcDir` points to the correct folder
- Check if files are excluded by `ignoreGlobs` patterns
- Increase `minStringLength` if needed

### Wrong strings extracted
- Adjust `minStringLength` to filter out short strings
- Review `htmlAttributeNames` if HTML extraction is too broad
- The heuristics aim to skip technical strings, but may not be perfect

### Language metadata not generated
- Ensure the languages JSON file exists at the configured path
- Check that `code` field is present for each entry
- Verify the locale code format (e.g., `"en-US"`, `"pt-BR"`)

### Validating Replacements
If replacements occur in the wrong location or fail silently:
- The extension validates that the text at the calculated position matches exactly before replacing.
- Check the "Angular Translation Extractor" output channel for warnings about mismatches.
- Ensure your files are saved with UTF-8 encoding.

## How Locale Files Work

Each source file gets its own folder with separate JSON files per locale:

**Base locale (en-US.json)** - Contains extracted English strings:
```json
{
  "COMPONENTS": {
    "HEADER": {
      "WELCOME": "Welcome",
      "LOGOUT": "Logout"
    }
  }
}
```

**Target locales (pt-BR.json, es-ES.json)** - Start with empty values:
```json
{
  "COMPONENTS": {
    "HEADER": {
      "WELCOME": "",
      "LOGOUT": ""
    }
  }
}
```

Translators fill in the empty values, or use the optional translation command integration.

## Key Format

The extension uses a hierarchical nested object structure for better organization:

### Structure
- **Namespace**: Based on the file path (e.g., `COMPONENTS`, `PAGES`, `SERVICES`)
- **Component**: Based on the filename (e.g., `LOGINFORM`, `HEADER`, `SIDEBAR`)
- **Key**: Based on the string content (e.g., `WELCOME_MESSAGE`, `SUBMIT_BUTTON`)

### Naming Convention
- All keys are **UPPERCASE**
- Words are separated by **underscores** (`_`)
- Special characters are removed or converted to underscores
- Keys are limited to 60 characters for readability

### Example Key Path
```
File: src/components/LoginForm.ts
String: "Welcome to our app"
Generated Key Path: COMPONENTS.LOGINFORM.WELCOME_TO_OUR_APP
```

### Collision Handling
If two different strings would generate the same key, the extension automatically appends a numeric suffix:
```json
{
  "COMPONENTS": {
    "FORM": {
      "TEXT": "First text",
      "TEXT_2": "Another text"
    }
  }
}
```

## Commands

| Command | ID | Description |
|---------|-----|-------------|
| **Angular: Extract translations** | `angularTranslation.extract` | Scans source files and generates locale JSON files |

## Requirements

- VS Code 1.85.0 or higher
- Node.js (for language metadata generation)


## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

**Author**: Adilson de Almeida Pedro  
**Website**: [https://adilson.almeidapedro.com.br](https://adilson.almeidapedro.com.br)  
**GitHub**: [@devremoto](https://github.com/devremoto)  
**Twitter**: [@devremoto](https://twitter.com/devremoto)  
**LinkedIn**: [Adilson Pedro](https://www.linkedin.com/in/adilsonpedro/)

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.txt) file for details.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Known Limitations](#-known-limitations) section
2. Search existing [issues](https://github.com/devremoto/angular-template-mover/issues)
3. Create a new issue with detailed reproduction steps

## ⭐ Acknowledgments

- Thanks to the Angular team for creating an amazing framework
- Inspired by the need for better developer experience in Angular projects
- Built with love for the Angular community by [Adilson de Almeida Pedro](https://github.com/devremoto)

---

**Enjoy coding with Angular Template Mover! 🎉**

*Created by [Adilson de Almeida Pedro](https://adilson.almeidapedro.com.br) - Full Stack Developer*

---

**Happy internationalizing! 🌍**
