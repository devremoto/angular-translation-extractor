import * as vscode from "vscode";
import { AggressiveMode } from "./types";

export type ExtConfig = {
  srcDir: string;
  outputRoot: string;
  languagesJsonPath: string;
  minStringLength: number;
  ignoreGlobs: string[];
  skipGlobs: string[];
  htmlAttributeNames: string[];
  mainTsPath: string;
  angularBootstrapStyle: "standalone" | "module";
  useTranslateCommand: boolean;
  translateCommand: string;
  translateArgsTemplate: string[];
  updateMode: "merge" | "overwrite" | "recreate";
  autoTranslate: boolean;
  autoTranslateDefaultLanguage: boolean;
  aggressiveMode: AggressiveMode;
  aggressiveModeAllowCallRegex: string[];
  aggressiveModeAllowContextRegex: string[];
  googleTranslateDelay: number;
};

export function getConfig(): ExtConfig {
  const cfg = vscode.workspace.getConfiguration("i18nExtractor");
  const aggressiveMode = cfg.get<AggressiveMode>("aggressiveMode")
    ?? cfg.get<AggressiveMode>("agressiveMode", "moderate");
  return {
    srcDir: cfg.get<string>("srcDir", "src"),
    outputRoot: cfg.get<string>("outputRoot", "src/assets/i18n"),
    languagesJsonPath: cfg.get<string>("languagesJsonPath", "src/assets/i18n-languages.json"),
    minStringLength: cfg.get<number>("minStringLength", 2),
    ignoreGlobs: cfg.get<string[]>("ignoreGlobs", [
      "**/*.test.*",
      "**/*.spec.*",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**"
    ]),
    skipGlobs: cfg.get<string[]>("skipGlobs", []),
    htmlAttributeNames: cfg.get<string[]>("htmlAttributeNames", [
      "title",
      "alt",
      "placeholder",
      "aria-label",
      "aria-placeholder"
    ]),
    mainTsPath: cfg.get<string>("mainTsPath", "{srcDir}/main.ts"),
    angularBootstrapStyle: cfg.get<"standalone" | "module">("angularBootstrapStyle", "standalone"),
    useTranslateCommand: cfg.get<boolean>("useTranslateCommand", false),
    translateCommand: cfg.get<string>("translateCommand", "npx-translate"),
    translateArgsTemplate: cfg.get<string[]>("translateArgsTemplate", [
      "--input",
      "{baseFile}",
      "--outDir",
      "{outDir}",
      "--from",
      "{baseLocale}",
      "--to",
      "{targetLocale}"
    ]),
    updateMode: cfg.get<"merge" | "overwrite" | "recreate">("updateMode", "merge"),
    autoTranslate: cfg.get<boolean>("autoTranslate", true),
    autoTranslateDefaultLanguage: cfg.get<boolean>("autoTranslateDefaultLanguage", false),
    aggressiveMode,
    aggressiveModeAllowCallRegex: cfg.get<string[]>("aggressiveModeAllowCallRegex", [
      "^alert\\s*\\(",
      "^confirm\\s*\\(",
      "^prompt\\s*\\("
    ]),
    aggressiveModeAllowContextRegex: cfg.get<string[]>("aggressiveModeAllowContextRegex", [
      "^window\\.alert\\(arg#1\\)$",
      "^window\\.confirm\\(arg#1\\)$",
      "^window\\.prompt\\(arg#1\\)$"
    ]),
    googleTranslateDelay: cfg.get<number>("googleTranslateDelay", 500),
  };
}
