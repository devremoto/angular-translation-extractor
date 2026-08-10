# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Angular Translation Extractor** — a VS Code extension (TypeScript) that scans an Angular project for hard-coded user-facing strings, replaces them with `| translate` keys, generates per-file locale JSON files, wires up `@ngx-translate`, and can auto-translate to other languages. It also generates a reusable `tg-language-selector` component.

- Entry point: `src/extension.ts` (activates, registers 11 commands).
- Bundled with esbuild to `dist/extension.js` (`main` in `package.json`).

## Existing AI instructions — rely on these first

This repo already carries agent/Copilot setup. Prefer them over re-deriving anything:

- **`.agent/skills/i18n-extension-dev/SKILL.md`** — the authoritative dev/debug/maintenance procedures (environment, F5 debugging, per-module responsibilities, common issues & fixes). Read this before non-trivial changes.
- **`docs/COPILOT_PROMPT.md`** — the product spec (extraction rules, aggressiveness modes, output layout, languages-list normalization).
- **`.github/prompts/`** — task prompts (e.g. reduce-repetitive-code).
- `docs/PUBLISHING.md`, `docs/PUBLISHING_CHECKLIST.md` — release process.

## Build / verify

```bash
npm install
npm run check-types   # tsc --noEmit — the fast correctness gate; run after every change
npm run lint          # eslint src
npm run compile       # clean + check-types + esbuild (dev build)
npm run package       # production build (vscode:prepublish)
npm test              # vscode-test (integration; launches an Extension Host)
```

Debug: open in VS Code, press **F5** (Extension Development Host), open an Angular workspace, run **“Angular: Extract translations (All app)”**.

## Architecture (source map)

- `extension.ts` — command handlers + the extraction pipeline (`runExtractionPipeline` → scan → generate locales → replace source → wire `main.ts`/`angular.json` → optional auto-translate).
- `config.ts` — `getConfig()` reads `i18nExtractor.*` settings into `ExtConfig`. **`resolveProject(triggerPath)` is the single source of truth for the project root, the source folder, and every path setting** (see below).
- `scan.ts`, `extractJsTs.ts` (Babel; only `@Component` inline `template`), `extractHtml.ts` (regex; skips pipe args & existing `| translate`).
- `replaceSource.ts`, `keygen.ts` — string → key replacement.
- `generate.ts` — writes per-file locale JSONs under `outputRoot`, mirroring the source tree.
- `loader-generator.ts` — emits `tg-translate-loader.ts`, the `tg-language-selector` component (**version-aware**, see below), and the readme.
- `translate.ts` / `google-translate.ts`, `reverse.ts`, `updateMainTs.ts`, `updateAngularJson.ts`, `langMeta.ts`, `utils.ts`, `types.ts`.

## Critical conventions

### Project resolution — **there are no path settings**
Every path is detected from the Angular project. Never derive paths from `folder.uri.fsPath`, and never read a path out of a raw `getConfig()` (its `srcDir`/`outputRoot`/`languagesJsonPath`/`mainTsPath` are meaningless placeholders). Always go through **`resolveProject(triggerPath)`** in `config.ts` — pass the path the command was triggered from (right-clicked URI, active editor, else the workspace folder). It returns `{ root, srcAbs, cfg }` with those four fields computed:

1. **root** — the nearest `angular.json`, searched **up** from the trigger (bounded by the workspace folder), then **down** (shallow BFS) from the trigger and from the opened folder. So the extension binds to the app you are actually working in, whether you opened above, beside, or inside it. **No angular.json anywhere → `resolveProject` throws**; commands surface that via `tryResolveProject` in `extension.ts` and abort.
2. **srcDir** — the `sourceRoot` that angular.json declares for the project owning the trigger path, so monorepo `projects/app/src` works untouched.
3. **outputRoot** = `<srcDir>/assets/i18n`, **languagesJsonPath** = `<srcDir>/app/core/json/language-code.json`, **mainTsPath** = the build target's `main` (or `browser`), else `<srcDir>/main.ts`.

`resolveProject` is memoized per trigger folder (`clearProjectCache()` on `i18nExtractor` config change) because it walks the disk synchronously and runs on every editor change/save.

Runtime asset URLs (loader prefix, `main.ts` factory) come from `toServedPath(srcDir, outputRoot)` in `utils.ts` — never strip a literal `src/` prefix.

### Generated language-selector is version-aware
`loader-generator.ts` emits the selector in the syntax the **target** project supports (`detectAngularMajor()` reads its `@angular/core`):
- Angular **≥ 17** → signal APIs (`input()`, `signal()`, `viewChild()`) + `@if`/`@for`.
- Older / undetectable → legacy `@Input()` + `*ngIf`/`*ngFor` + `@ViewChild`.

Both variants must stay feature-equal (direction up/down + horizontal align auto-detect, `zIndex`, customizable `whiteModeClass`/`darkModeClass`). The emitted CSS is shared. When changing the selector, update **both** `get…()` (modern) and `get…Legacy()` functions.

## When editing

- Run `npm run check-types` after changes; it's the quick gate (the exe/host build is heavier).
- The three selector emit functions return TypeScript **as template-literal strings** — keep them free of backticks; the only allowed `${…}` is `${languagesJsonUrl}`.
- Follow the module boundaries and gotchas documented in the `i18n-extension-dev` skill.
