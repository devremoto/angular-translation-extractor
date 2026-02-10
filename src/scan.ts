import fg from "fast-glob";
import * as path from "node:path";
import { ExtConfig } from "./config";
import { FoundString } from "./types";
import { extractFromJsTs } from "./extractJsTs";
import { extractFromHtml } from "./extractHtml";
import { normalizeGlobRoot, posixRel } from "./utils";

const EXTS = ["js", "ts", "html"];

export async function scanForStrings(opts: {
  workspaceRoot: string;
  cfg: ExtConfig;
}): Promise<FoundString[]> {
  const { workspaceRoot, cfg } = opts;

  const srcAbs = path.join(workspaceRoot, cfg.srcDir);
  const srcAbsPosix = normalizeGlobRoot(srcAbs);

  const patterns = EXTS.map(ext => `${srcAbsPosix}/**/*.${ext}`);
  const mergedIgnoreGlobs = [...cfg.ignoreGlobs, ...cfg.skipGlobs, "**/main.ts", "**/index.html", "**/translate/**"];
  const files = await fg(patterns, { ignore: mergedIgnoreGlobs, dot: false });

  const out: FoundString[] = [];

  for (const fileAbsPosix of files) {
    const fileAbs = path.resolve(fileAbsPosix);
    const relFromSrc = posixRel(srcAbs, fileAbs);

    const ext = (path.extname(fileAbs).slice(1) || "").toLowerCase();

    if (ext === "html") {
      const strings = await extractFromHtml(fileAbs, relFromSrc, cfg.minStringLength, cfg.htmlAttributeNames);
      out.push(...strings);
    } else {
      const strings = await extractFromJsTs(fileAbs, relFromSrc, cfg.minStringLength, cfg.htmlAttributeNames);
      out.push(...strings);
    }
  }

  return out;
}
