import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function readJsonIfExists<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function posixRel(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

export function withoutExt(relPath: string): string {
  const idx = relPath.lastIndexOf(".");
  return idx >= 0 ? relPath.slice(0, idx) : relPath;
}

export function normalizeGlobRoot(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/g, "");
}
