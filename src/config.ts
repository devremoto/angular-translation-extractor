import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { AggressiveMode } from "./types";

export type ExtConfig = {
  /**
   * Source folder to scan, relative to the project root. NOT a setting — the placeholder from
   * `getConfig()` is meaningless; `resolveProject()` fills it from the Angular project. Same for
   * `outputRoot` and `languagesJsonPath` below.
   */
  srcDir: string;
  /** Locale output folder — always `<srcDir>/assets/i18n`. Computed by `resolveProject()`. */
  outputRoot: string;
  /** Locales list — always `<srcDir>/app/core/json/language-code.json`. Computed by `resolveProject()`. */
  languagesJsonPath: string;
  /** Bootstrap file — angular.json's build `main`/`browser`, else `<srcDir>/main.ts`. Computed by `resolveProject()`. */
  mainTsPath: string;
  minStringLength: number;
  ignoreGlobs: string[];
  skipGlobs: string[];
  htmlAttributeNames: string[];
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
    // Placeholders — every consumer goes through resolveProject(), which computes these.
    srcDir: DEFAULT_SRC_DIR,
    outputRoot: path.posix.join(DEFAULT_SRC_DIR, ...LOCALES_TAIL),
    languagesJsonPath: path.posix.join(DEFAULT_SRC_DIR, ...LANGUAGES_TAIL),
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
    mainTsPath: path.posix.join(DEFAULT_SRC_DIR, "main.ts"),
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

export const DEFAULT_SRC_DIR = "src";
/** Locales folder, relative to the Angular project's source root. */
export const LOCALES_TAIL = ["assets", "i18n"];
/** Locales list file, relative to the Angular project's source root. */
export const LANGUAGES_TAIL = ["app", "core", "json", "language-code.json"];

export type ResolvedProject = {
  /** Absolute Angular project root — the folder holding angular.json (else package.json). */
  root: string;
  /** Absolute source folder — the Angular project's own `sourceRoot`. */
  srcAbs: string;
  /** The config with `srcDir`, `outputRoot` and `languagesJsonPath` computed for this project. */
  cfg: ExtConfig;
};

/**
 * Resolves the Angular project the extension operates on, **entirely by detection** from where the
 * command was triggered (the right-clicked file/folder, the active editor, or the opened workspace
 * folder). There are no path settings — nothing to configure and nothing to get out of sync.
 *
 *   1. `root` — the nearest `angular.json`, searched UP from the trigger (trigger is *inside* an
 *      Angular app), then DOWN from the trigger and from the opened folder (trigger is *above* it).
 *   2. `srcAbs` — the `sourceRoot` that same angular.json declares for the project owning the
 *      trigger path, so `projects/foo/src` monorepos work untouched.
 *   3. `outputRoot` = `<srcDir>/assets/i18n`, `languagesJsonPath` = `<srcDir>/app/core/json/language-code.json`.
 */
export function resolveProject(triggerPath: string, cfg: ExtConfig = getConfig()): ResolvedProject {
  const base = toDirectory(triggerPath);

  // Resolution walks the disk synchronously and callers hit it on every editor change /
  // document save — memoize per folder so that stays free.
  const cached = resolveCache.get(base);
  if (cached) {
    return { ...cached, cfg: { ...cfg, ...cached.cfg } };
  }

  const resolved = resolveProjectUncached(base, cfg);
  if (resolveCache.size > 200) {
    resolveCache.clear();
  }
  resolveCache.set(base, resolved);
  return resolved;
}

const resolveCache = new Map<string, ResolvedProject>();

/** Drops memoized resolutions — call when settings or the folder layout may have changed. */
export function clearProjectCache(): void {
  resolveCache.clear();
}

function resolveProjectUncached(base: string, cfg: ExtConfig): ResolvedProject {
  const workspaceRoot = workspaceFolderFor(base) ?? base;

  // 1. The Angular project that owns the trigger location. The upward walk is bounded by the
  //    workspace folder only when the trigger sits strictly inside it — otherwise (no workspace
  //    info) an unbounded walk is what finds the app above the trigger.
  const boundary = isStrictlyInside(workspaceRoot, base) ? workspaceRoot : undefined;
  const detectedRoot = findAngularRoot(base, boundary)
    ?? (path.relative(workspaceRoot, base) === "" ? null : findAngularRoot(workspaceRoot));

  if (!detectedRoot) {
    throw new Error(
      `No Angular project found: there is no angular.json above or below "${base}". `
      + `Run the command from a file or folder inside an Angular project.`
    );
  }

  // 2. The source folder and the bootstrap file come from the Angular project itself.
  const project = readAngularProject(detectedRoot, base);
  const root = detectedRoot;
  const srcAbs = path.join(root, project?.sourceRoot ?? DEFAULT_SRC_DIR);

  const relSrc = path.relative(root, srcAbs);
  const srcInsideRoot = relSrc.length > 0 && !relSrc.startsWith("..") && !path.isAbsolute(relSrc);
  const srcDir = srcInsideRoot ? toSegments(relSrc).join("/") : DEFAULT_SRC_DIR;

  return {
    root,
    srcAbs,
    cfg: {
      ...cfg,
      srcDir,
      outputRoot: path.posix.join(srcDir, ...LOCALES_TAIL),
      languagesJsonPath: path.posix.join(srcDir, ...LANGUAGES_TAIL),
      mainTsPath: project?.main ?? path.posix.join(srcDir, "main.ts"),
    },
  };
}

export type AngularProjectInfo = {
  /** Posix, relative to the Angular root. */
  sourceRoot: string;
  /** The build target's entry file (`main`, or `browser` on the application builder), if declared. */
  main: string | null;
};

/**
 * The angular.json project that owns `triggerPath` — the longest `root`/`sourceRoot` prefix match,
 * else the default project, else the only/first project with a build target.
 */
export function readAngularProject(angularRoot: string, triggerPath: string): AngularProjectInfo | null {
  let json: Record<string, any>;
  try {
    json = JSON.parse(fs.readFileSync(path.join(angularRoot, "angular.json"), "utf8"));
  } catch {
    return null;
  }

  const projects = json?.projects && typeof json.projects === "object" ? json.projects : {};
  const entries = Object.keys(projects).map(name => {
    const project = projects[name] ?? {};
    const projectRoot = typeof project.root === "string" ? project.root : "";
    const sourceRoot = typeof project.sourceRoot === "string"
      ? project.sourceRoot
      : path.posix.join(toPosix(projectRoot), "src");
    const buildOptions = project?.architect?.build?.options ?? project?.targets?.build?.options ?? {};
    const main = typeof buildOptions.main === "string"
      ? buildOptions.main
      : (typeof buildOptions.browser === "string" ? buildOptions.browser : null);
    return {
      name,
      projectRoot: toPosix(projectRoot),
      info: { sourceRoot: toPosix(sourceRoot), main: main ? toPosix(main) : null } as AngularProjectInfo,
      hasBuild: !!(project?.architect?.build ?? project?.targets?.build),
    };
  }).filter(e => e.info.sourceRoot.length > 0);

  if (entries.length === 0) {
    return null;
  }

  const relTrigger = toSegments(path.relative(angularRoot, triggerPath));
  let best: { info: AngularProjectInfo; score: number } | null = null;
  for (const entry of entries) {
    for (const prefix of [entry.info.sourceRoot, entry.projectRoot]) {
      const segs = toSegments(prefix);
      if (segs.length > 0 && startsWithSegments(relTrigger, segs) && (!best || segs.length > best.score)) {
        best = { info: entry.info, score: segs.length };
      }
    }
  }
  if (best) {
    return best.info;
  }

  const defaultProject = typeof json.defaultProject === "string" ? json.defaultProject : null;
  const chosen = (defaultProject && entries.find(e => e.name === defaultProject))
    ?? entries.find(e => e.hasBuild)
    ?? entries[0];
  return chosen ? chosen.info : null;
}

/** The workspace folder containing `p`, when the VS Code API is available. */
function workspaceFolderFor(p: string): string | null {
  try {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(p));
    if (folder) {
      return folder.uri.fsPath;
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  } catch {
    return null;
  }
}

/** The trigger may be a file (right-clicked file / active editor) — operate on its folder. */
function toDirectory(p: string): string {
  const normalized = path.normalize(p);
  try {
    return fs.statSync(normalized).isDirectory() ? normalized : path.dirname(normalized);
  } catch {
    return normalized;
  }
}

function isStrictlyInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function toPosix(p: string): string {
  return (p || "").replace(/\\/g, "/");
}

function toSegments(p: string): string[] {
  return toPosix(p).split("/").filter(s => s.length > 0 && s !== ".");
}

function segmentsEqual(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function startsWithSegments(parts: string[], prefix: string[]): boolean {
  return prefix.length > 0 && prefix.length <= parts.length && prefix.every((s, i) => segmentsEqual(s, parts[i]));
}

/** Folders never worth walking when hunting for angular.json / the source folder. */
const UNSEARCHABLE_DIRS = new Set([
  "node_modules", "dist", "build", "out", "out-tsc", "coverage",
  "bin", "obj", "tmp", "temp", "vendor", "target", "venv", "__pycache__",
]);

function isSearchableDir(name: string): boolean {
  return !name.startsWith(".") && !UNSEARCHABLE_DIRS.has(name.toLowerCase());
}

/**
 * Nearest folder containing angular.json — searched up the ancestry, then down.
 * `stopAt` bounds the upward walk (pass the workspace folder so a command triggered
 * inside the workspace never binds to an unrelated Angular app above it).
 */
export function findAngularRoot(start: string, stopAt?: string): string | null {
  const boundary = stopAt ? path.normalize(stopAt) : null;

  // Up: the trigger folder itself or any ancestor (bounded by `stopAt`).
  let dir = path.normalize(start);
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(path.join(dir, "angular.json"))) {
      return dir;
    }
    if (boundary && path.relative(boundary, dir) === "") {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  // Down: shallow BFS (monorepo root with the app nested), skipping heavy folders.
  const queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];
  const maxDepth = 4;
  while (queue.length) {
    const { dir: current, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some(e => e.isFile() && e.name === "angular.json")) {
      return current;
    }
    if (depth >= maxDepth) {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && isSearchableDir(e.name)) {
        queue.push({ dir: path.join(current, e.name), depth: depth + 1 });
      }
    }
  }

  return null;
}
