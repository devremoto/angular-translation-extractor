# Single File Per Language Translation Feature

## Overview
The extension now supports two modes for organizing translation files:

1. **Per-File Mode** (default) - Each source file gets its own translation folder
2. **Single File Mode** - All translations consolidated into single files per language

## Configuration

Add to your `.vscode/settings.json`:

```json
{
  "i18nExtractor.singleFilePerLanguage": true
}
```

## Behavior

### Per-File Mode (default: `false`)
```
src/assets/i18n/
├── components/header/
│   ├── en.json
│   ├── it.json
│   └── pt.json
├── components/footer/
│   ├── en.json
│   ├── it.json
│   └── pt.json
```
- One folder per source file
- Organized by file structure
- Useful for large projects with many components

### Single File Mode (`true`)
```
src/assets/i18n/
├── en.json          (all English strings)
├── it.json          (all Italian translations)
└── pt.json          (all Portuguese translations)
```
- All translations in root i18n directory
- Flat structure
- Easier to manage for smaller projects
- Single file per language

## How It Works

When `singleFilePerLanguage` is enabled:

1. **Extraction**: All translatable strings are collected from all source files
2. **Consolidation**: Keys are generated with file path prefixes to avoid conflicts
3. **Generation**: Single base language file contains all strings, one translation file per language
4. **Mapping**: Each source file still has a mapping of text→key for the replacement process

## Example

If you have:
- `src/components/header.ts` with "Welcome"
- `src/components/footer.ts` with "Goodbye"

Generated files will be:
```json
// en.json
{
  "COMPONENTS.HEADER.WELCOME": "Welcome",
  "COMPONENTS.FOOTER.GOODBYE": "Goodbye"
}

// it.json
{
  "COMPONENTS.HEADER.WELCOME": "",
  "COMPONENTS.FOOTER.GOODBYE": ""
}
```

## Switching Modes

You can switch between modes at any time:
- The extension will regenerate files in the new structure
- Existing translations won't be lost if using `allowOverwriteGenerated: false`
- Clear the output directory if you want a clean start

## Auto-Translation

Both modes work with auto-translation services (Google Translate):
- With single-file mode, all strings are translated in one pass
- Potentially faster for large translation batches
- Same translation quality and configuration options apply
