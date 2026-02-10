## VS Code Copilot Prompt (refined)

Build a VS Code extension (TypeScript) that extracts hard-coded user-facing strings and generates i18n JSON files.

### Core requirements

1) Scan a configurable source folder (default `src`) and read: `.js`, `.ts`, `.html`.

2) Extract strings:
- JS/TS: string literals `"..."`, static template literals `` `...` `` (no expressions).
- HTML: visible text between tags and values of selected attributes.
  - Attribute allow-list is configurable (default: `title`, `alt`, `placeholder`, `aria-label`, `aria-placeholder`).
- Avoid obvious non-UI strings: import/export module specifiers, object keys, URLs/paths, tokens/ids, pure numbers/punctuation, and template placeholders like `{{...}}` or `${...}`.

3) Read a configurable “languages list” JSON file (default `src/assets/i18n-languages.json`) containing:
```json
[
  { "rank": 1, "code": "en-US", "englishName": "…", "nativeName": "…", "flag": "…" }
]
```
- Only `code` is required.
- Auto-generate missing fields:
  - `englishName`: language/region display name in English
  - `nativeName`: language/region display name in that locale
  - `flag`: `https://flagcdn.com/w40/{countryCodeLower}.png` (only when a 2-letter region exists)
- Write normalized entries back to the same JSON file.

4) Output path is configurable (default `src/assets/I18n`). Replicate folder structure relative to `srcDir` and create a folder per source file:
- Source: `src/components/component1.html`
- Output folder: `src/assets/I18n/components/component1/`
Generate locale files inside:
- `{baseLocaleCode}.json` where `baseLocaleCode` is configurable (e.g. `en`, `en-US`, `en-GB`)
- `{targetLocale}.json` for each locale code from the languages list excluding base

5) Keys:
- Generate stable keys, namespaced by file path (e.g. `components.component1.some.text`).
- De-duplicate identical string values within the same base file.

6) Non-base locale files:
- Preserve existing translations.
- Add new keys with empty string values.

7) Optional translation:
- If configured, run a user-provided translate command (`npx-translate` or similar) per file and per target locale.
- Args are configured via a template list with placeholders: `{baseFile}`, `{outDir}`, `{baseLocale}`, `{targetLocale}`.

### Deliverables

- Full extension code: `package.json` (with settings), `tsconfig.json`, and TypeScript source.
- One command: `i18n: Extract strings and generate locale JSONs` (`i18n.extractGenerate`).
- Keep dependencies lightweight; use `@babel/parser` + `@babel/traverse` for JS/TS; avoid heavy HTML DOM libraries (best-effort regex is ok).
