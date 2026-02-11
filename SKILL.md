# Angular Translation Extractor - Architecture & Configuration

## Overview
VS Code extension that extracts translatable strings from Angular applications (JS/TS/HTML), generates i18n JSON files, and can reverse translations back to original strings.

## Core Concepts

### Language Configuration
The extension uses a **languages JSON file** (`languagesJsonPath`) that defines all supported languages with their properties:

```typescript
type LanguageEntry = {
  rank?: number;           // Sort order
  code: string;            // Language code: "en-US", "pt-BR", etc.
  englishName?: string;    // Auto-filled if missing
  nativeName?: string;     // Auto-filled if missing  
  flag?: string;           // Auto-filled if missing
  default?: boolean;       // THE DEFAULT/BASE LANGUAGE SOURCE
  active?: boolean;        // Whether to generate files for this language
};
```

**IMPORTANT**: The `default: true` property marks which language is the translation source, NOT the `baseLocaleCode` config!

### File Naming Strategy

Controlled by `onlyMainLanguages` setting:

- **`onlyMainLanguages: false`** (default): Full locale codes
  - Files: `en-US.json`, `pt-BR.json`, `es-ES.json`
  - The loader maps full codes to main codes automatically
  
- **`onlyMainLanguages: true`**: Main language codes only
  - Files: `en.json`, `pt.json`, `es.json`
  - Extracts main language from full code (`en` from `en-US`)

### Translation Modes

Two file generation strategies controlled by `singleFilePerLanguage`:

1. **Single File Per Language** (`singleFilePerLanguage: true`, default since v0.0.1)
   - One consolidated file per language in `outputRoot`: `en-US.json`, `pt-BR.json`
   - Keys are prefixed with file path: `APP.COMPONENTS.USER_PROFILE.TITLE`
   - Better for large applications, easier to manage

2. **Per-File Locales** (`singleFilePerLanguage: false`, legacy)
   - Mirrors source structure: `src/app/user/user.component.html` → `i18n/app/user/user.component/en-US.json`
   - Localized files next to each component
   - Can become complex for large projects

### Translation Key Structure

**IMPORTANT**: Understanding how translation keys are built is critical for finding the relationship between source files and JSON translation files.

Translation keys follow a **three-part structure**:

```
[FOLDER_PATH].[FILE_NAME].[TRANSLATION_TEXT]
```

#### Example Breakdown

Given the key: `APP.SHARED.COMPONENTS.STATUS_MODAL.STATUS_MODAL_COMPONENT.CLOSE`

1. **Folder Path**: `APP.SHARED.COMPONENTS.STATUS_MODAL`
   - Represents the directory structure from `srcDir` to the file
   - Each folder is converted to uppercase with underscores
   - Segments are joined with dots (`.`)

2. **File Name**: `STATUS_MODAL_COMPONENT`
   - The filename (without extension) converted to uppercase with underscores
   - For `status-modal.component.ts` or `status-modal.component.html`

3. **Translation Text**: `CLOSE`
   - The actual text being translated, normalized to uppercase with underscores
   - Original text like "Close" becomes "CLOSE"

#### Key Generation Rules

From the file path (e.g., `src/app/shared/components/status-modal/status-modal.component.ts`):

1. **Extract relative path**: `app/shared/components/status-modal/status-modal.component.ts`
2. **Remove extension**: `app/shared/components/status-modal/status-modal.component`
3. **Convert to uppercase**: `APP/SHARED/COMPONENTS/STATUS_MODAL/STATUS_MODAL.COMPONENT`
4. **Replace non-alphanumeric with underscores**: `APP_SHARED_COMPONENTS_STATUS_MODAL_STATUS_MODAL_COMPONENT`
5. **Join path segments with dots**: `APP.SHARED.COMPONENTS.STATUS_MODAL.STATUS_MODAL_COMPONENT`
6. **Append normalized text**: `APP.SHARED.COMPONENTS.STATUS_MODAL.STATUS_MODAL_COMPONENT.CLOSE`

This hierarchical structure makes it easy to:
- Locate which file a translation key belongs to
- Organize translations logically in the JSON structure
- Reverse translate keys back to original strings

### Update Modes

Controlled by `updateMode` setting:

- **`merge`** (default): Preserves existing translations, only adds blank entries for new keys
- **`overwrite`**: Recreates all JSON files except the default language
- **`recreate`**: Recreates all files including default language (careful!)

## Key Configuration Properties

```json
{
  "i18nExtractor.languagesJsonPath": "src/app/core/json/language-code.json",
  "i18nExtractor.baseLocaleCode": "en",  // Used for file naming convention
  "i18nExtractor.onlyMainLanguages": false,  // false = full codes (en-US), true = main codes (en)
  "i18nExtractor.onlyGenerateActiveLangs": true,  // Generate only for active: true languages
  "i18nExtractor.singleFilePerLanguage": true,  // Single consolidated file vs per-file structure
  "i18nExtractor.srcDir": "src",
  "i18nExtractor.outputRoot": "src/assets/i18n",
  "i18nExtractor.updateMode": "merge",  // merge | overwrite | recreate
  "i18nExtractor.enableTransalationCache": false // Enable sessionStorage caching in loader
}
```

## Reverse Translation Feature

**Purpose**: Convert translation keys back to original strings (useful for debugging, demos, or reverting changes)

**How it works**:
1. Loads translations from the **default language** JSON files (marked with `default: true`)
2. Scans source files for i18n patterns: `{{ 'KEY' | translate }}`, `i18n('KEY')`, etc.
3. Replaces translation keys with original string values
4. Writes changes back to source files

**Critical**: Must handle both file naming strategies:
- If `onlyMainLanguages: false` → look for `en-US.json`
- If `onlyMainLanguages: true` → look for `en.json`
- Must read languages JSON to find the actual default language code

**Understanding Key Structure for Reverse Translation**:
The reverse translation feature relies on the translation key structure (`[FOLDER_PATH].[FILE_NAME].[TRANSLATION_TEXT]`) to map keys back to their original values. When reversing:
- The key `APP.SHARED.COMPONENTS.STATUS_MODAL.STATUS_MODAL_COMPONENT.CLOSE` maps back to the original string "Close"
- The folder path and file name components help locate which source files contain the translation keys
- The translation text component is looked up in the default language JSON to retrieve the original string value

## Code Structure

### Main Files

- **extension.ts**: Entry point, command registration
- **scan.ts**: Extracts strings from TS/JS/HTML files
- **generate.ts**: Creates translation JSON files
- **reverse.ts**: Reverse translation (keys → original strings)
- **langMeta.ts**: Language metadata utilities, `getDefaultLanguageCode()`
- **config.ts**: Configuration management via `getConfig()`
- **types.ts**: TypeScript type definitions

### Helper Utilities

- **utils.ts**: File system utilities
- **keygen.ts**: Translation key generation
- **translate.ts**: Auto-translation orchestration
- **google-translate.ts** / **libretranslate.ts**: Translation services
- **loader-generator.ts**: Generates Angular translation loader code
- **updateMainTs.ts** / **updateAngularJson.ts**: Angular project integration

## Important Functions

### Language Handling
```typescript
// Get the default language from languages array
getDefaultLanguageCode(langs: LanguageEntry[]): string | undefined

// Extract main language code: "en-US" → "en"
getMainLanguageCode(code: string): string

// Normalize and auto-fill language metadata
normalizeLanguages(entries: LanguageEntry[]): LanguageEntry[]
```

### Translation Generation
```typescript
generatePerFileLocales(opts): Promise<{ baseFiles, filesProcessed, stringsAdded, keyMapByFile }>
// Handles both single-file and per-file strategies based on singleFilePerLanguage flag
```

### Reverse Translation
```typescript
loadTranslationKeyMap(outputRoot: string, baseLocaleCode: string): Promise<Map<string, string>>
findI18nMatches(srcDir: string, keyMap: Map<string, string>, ignoreGlobs: string[]): Promise<ReversalMatch[]>  
applyReverseTranslations(matches: ReversalMatch[], outputChannel?): Promise<{ success, failed, errors }>
```

## Common Patterns

### Translation Key Patterns Detected
```typescript
// Angular templates
{{ 'KEY' | translate }}
{{ 'KEY' | i18n }}
{{ 'KEY' | i18nPipe }}

// Parenthesized versions
('KEY' | translate)

// TypeScript/JavaScript  
i18n('KEY')
this.translate.get('KEY')
this.translate.instant('KEY')
this.[service].get('KEY')
translate.get('KEY')
```

## Extraction Rules

### Template Extraction
- **Files**: `.html` files and inline templates in `.ts` files
- **Rule**: For `.ts` files, only extract strings from inline templates defined in `@Component({ template: "..." })`
- **Pattern**: Handles `template:` property in `Component` decorator

### Class Code Extraction
- **Scope**: Extracts strings from TypeScript classes (components, services, etc.) using strict AST analysis.
- **Strict Exclusions**:
  - **Decorators**: Completely ignores strings inside `@Injectable`, `@NgModule`, `@Pipe`, `@Directive`.
  - **Component Metadata**: Ignores `selector`, `styleUrls`, `templateUrl`, `providers`, `host`, `queries`, `inputs`, `outputs`.
  - **Logging**: Ignores `console.log`, `console.error`, `console.warn`, `console.debug`, `console.trace`.
  - **Logic**: Ignores logic flow conditions (`if`, `switch`, `for`, `while`), imports, exports.
  - **Technical**: Ignores object keys, state/config objects, URLs, paths.
- **Inclusions (Strict)**:
  - **Explicit Message Context**: Arguments to `alert()`, `confirm()`, `prompt()`, `toast()`, `snackBar.open()`.
  - **Display Properties**: Assignments to keys known to be user-facing (e.g., `title`, `label`, `message`, `placeholder`, `tooltip`, `header`, `errorMessage`, `buttonText`, `altText`, `ariaLabel`, `description`, `caption`, `hint`).
  - **Template Assignments**: Properties assigned strings that appear to be sentences (Capitalized, spaces).
- **Transformation**:
  - Replaces string literal with `this.translate.instant('GENERATED.KEY')`
  - Automatically injects `TranslateService` into the class if missing

## Auto-Translation

Controlled by:
- `autoTranslate: true` - Enable automatic translation after extraction
- `autoTranslateDefaultLanguage: false` - Skip translating the default language (it's the source!)
- `translationService: "google" | "libretranslate"` - Which service to use
- `googleTranslateDelay: 500` - Rate limiting delay in ms

## Workspace vs User Settings

Settings can be configured at:
- **Workspace level**: `.vscode/settings.json` in project root (preferred for team consistency)
- **User level**: Global VS Code settings (personal defaults)

## Development Notes

### Building
- **esbuild**: Bundles to `dist/extension.js`
- **TypeScript**: Compiler checks with `tsc --noEmit`
- **ESLint**: Code quality checks

### Debugging
- Extension loads from `package.json` `"main"` field → must match build output!
- Launch config `outFiles` must match for breakpoints to work
- Use "Extension Development Host" (F5) for testing

### Testing with Another Project
1. Open this extension's folder in VS Code
2. Press F5 to launch Extension Development Host
3. In the new window, open the target Angular project
4. Configure settings in target project's `.vscode/settings.json`
5. Run commands from Command Palette or Explorer context menu

## Future AI Assistant Instructions

**When working on this extension**:
1. Always read `config.ts` to understand available configuration options
2. Check `langMeta.ts` for language handling utilities
3. Remember: `default: true` in languages JSON is the source of truth for base language
4. Consider both `onlyMainLanguages` and `singleFilePerLanguage` settings in any file I/O
5. Read the languages JSON file when you need to know the default language code
6. Don't assume file names - they depend on configuration!
