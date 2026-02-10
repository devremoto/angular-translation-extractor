---
description: Procedures for developing, debugging, and maintaining the Angular i18n Extractor extension
---

# Angular i18n Extractor Development

This skill provides guidelines and commands for working with the `angular-tanslation-extractor` VS Code extension.

## Environment Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Compile the Extension**:
    ```bash
    npm run compile
    ```
    or watch mode:
    ```bash
    npm run watch
    ```

## debugging

To debug the extension:
1.  Open the project in VS Code.
2.  Press `F5` to launch the "Extension Development Host".
3.  In the host window, open an Angular project (or the `sample` folder).
4.  Run the command `Angular: Extract translations`.

## Key Components

-   `src/extractJsTs.ts`: Handles parsing of JS/TS files using Babel. **Only extracts inline HTML templates from `@Component` decorators** (the `template` property). Does NOT extract from component methods or properties, and does NOT extract from other classes. Skips all decorator properties except `template`.
-   `src/extractHtml.ts`: Handles parsing of HTML files and inline templates using Regex. Extracts text content, attributes, and interpolations. **Skips pipe format arguments** (e.g., `date:'short'`, `currency:'USD'`) to preserve Angular pipe configurations.
-   `src/replaceSource.ts`: Handles the replacement of extracted strings with translation keys in the source files.
-   `src/generate.ts`: Generates the JSON translation files.

## Common Issues & Fixes

### 1. Strings not being extracted
-   Check `minStringLength` setting.
-   Verify `ignoreGlobs` to ensure file is not excluded.
-   **Verify the class has `@Component` decorator**: Only strings in `@Component` classes are extracted from inline templates.
-   **Check template property**: Only the `template` property of `@Component` is scanned. Other properties like `selector`, `providers`, `styles` are ignored (framework-critical).
-   Check `isProbablyUserFacing` regex in `extractHtml.ts` for false negatives.

### 2. Pipe format strings being extracted
-   The extension **automatically skips** pipe format arguments like `'short'` in `date:'short'`.
-   This prevents breaking Angular pipes (date, currency, number, time, etc.).
-   Pipes already with `| translate` are skipped entirely.

### 3. @Component decorator properties being extracted
-   The extension **does NOT extract** from decorator properties like `selector: 'app-root'`.
-   Only the `template` property content is scanned.
-   This preserves Angular framework functionality.

### 4. Replacements are incorrect or missing
-   **Validation**: The extension now uses `rawText` (exact string from file) to validate that the content at the calculated position matches exactly before replacing.
-   **HTML/Templates**: Ensure `extractHtml.ts` calculates precise source locations and includes `rawText`.
-   **Troubleshooting**: Check the "Angular Translation Extractor" output channel for "Mismatch" warnings. This indicates the calculated file position does not match the expected content.

## Testing
-   Use `src/sample` folder for manual testing.
-   Create a reproduction script (e.g., `src/reproduce_issue.ts`) to isolate extraction/replacement logic without launching the full VS Code host.

## Translation generation modes

The translation process uses three update modes to generate language-specific JSON files. These modes control how translated content is merged with existing translations.

### Update Modes (`updateMode` configuration)

**1. Merge Mode (default)**
- Only translates **new properties** that don't exist in the target language file yet
- Only translates **blank properties** (properties with empty or whitespace-only values)
- **Preserves** all existing translations (non-empty values)
- Safe mode for incremental updates without losing manually fixed translations
- **Filter logic**: `isForce || !translations[key] || (typeof translations[key] === 'string' && translations[key].trim() === '')`

**2. Overwrite Mode**
- Translates all **non-default** language files (any language except the base language)
- Preserves the base language file as-is
- Useful when you need to regenerate translations while keeping the base language intact
- Does not overwrite completely new base language entries

**3. Recreate Mode**
- Completely regenerates all language files from the base language
- Erases all existing translations
- Starts fresh with AI-generated translations for all properties
- Use with caution as it will lose all manual translation corrections

### Translation Script Behavior

The generated translation scripts (`translate-google.cjs`, `translate-libretranslate.cjs`) now correctly implement these modes:

- **CLI Flags Available**:
  - `--fast`: Removes delays between API requests (speeds up translation)
  - `--parallel`: Enables parallel translation (up to 5 languages at once)
  - `--diff`: Shows preview of what would be translated without writing files
  - `--force`: Forces translation of all properties regardless of mode

- **Keys to Translate Filter**:
  ```javascript
  // Only translate keys that match these conditions:
  const keysToTranslate = Object.entries(content).filter(
    ([key, value]) => 
      isForce ||                                    // Force mode translates everything
      !translations[key] ||                         // New properties (don't exist yet)
      (typeof translations[key] === 'string' &&    // OR blank existing properties
       translations[key].trim() === '')
  );
  ```

- **Translation Preservation**: In merge mode, the script only modifies keys that meet the filter criteria, leaving all other existing translations untouched

### Best Practices

1. **For incremental updates**: Use merge mode (default) to add translations for new properties while preserving manual corrections
2. **For fixing broken base language**: Update the base language JSON file, then use merge mode to translate new/blank properties only
3. **For complete regeneration**: Use recreate mode, but backup existing translations first
4. **For testing**: Use `--diff` flag to preview what would be translated before applying changes
5. **For large translation batches**: Use `--parallel` and `--fast` flags for better performance
