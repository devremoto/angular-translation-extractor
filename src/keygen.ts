export function makeKey(value: string, usedKeys: Set<string>, prefix?: string): string {
  const base = value
    .toUpperCase()
    .replace(/['"]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "TEXT";

  const baseWithPrefix = prefix ? `${prefix}.${base}` : base;

  let key = baseWithPrefix;
  let i = 2;
  while (usedKeys.has(key)) {
    key = `${baseWithPrefix}_${i++}`;
  }
  usedKeys.add(key);
  return key;
}
