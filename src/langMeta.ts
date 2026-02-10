import { LanguageEntry } from "./types";

/**
 * Fill englishName/nativeName/flag for any entries missing them.
 * Uses built-in Intl.DisplayNames (Node) for language/region names.
 * Flag uses flagcdn with region code when present: https://flagcdn.com/w40/{cc}.png
 */
export function normalizeLanguages(entries: LanguageEntry[]): LanguageEntry[] {
  const out: LanguageEntry[] = [];

  for (const e of entries) {
    if (!e?.code || typeof e.code !== "string") continue;

    const code = e.code;
    const { language, region } = splitLocale(code);

    const englishName = e.englishName ?? computeEnglishName(code, language, region);
    const nativeName = e.nativeName ?? computeNativeName(code, language, region);
    const flag = e.flag ?? computeFlag(region);

    out.push({
      ...e,
      code,
      englishName,
      nativeName,
      flag
    });
  }

  out.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  return out;
}

export function getDefaultLanguageCode(langs: LanguageEntry[]): string | undefined {
  return langs.find(l => l.default === true)?.code;
}

function splitLocale(code: string): { language: string; region?: string } {
  const parts = code.replace("_", "-").split("-");
  const language = (parts[0] || "").toLowerCase();
  let region: string | undefined;

  const maybe = parts.find((p: string) => p.length === 2 || p.length === 3);
  if (maybe) region = maybe.toUpperCase();

  return { language, region };
}

function computeEnglishName(code: string, language: string, region?: string): string {
  try {
    const dnLang = new Intl.DisplayNames(["en"], { type: "language" });
    const dnRegion = new Intl.DisplayNames(["en"], { type: "region" });

    const langName = dnLang.of(language) ?? language;
    if (region) {
      const regionName = dnRegion.of(region) ?? region;
      return `${langName} (${regionName})`;
    }
    return langName;
  } catch {
    return code;
  }
}

function computeNativeName(code: string, language: string, region?: string): string {
  try {
    const dnLang = new Intl.DisplayNames([code], { type: "language" });
    const dnRegion = new Intl.DisplayNames([code], { type: "region" });

    const langName = dnLang.of(language) ?? language;
    if (region) {
      const regionName = dnRegion.of(region) ?? region;
      return `${langName} (${regionName})`;
    }
    return langName;
  } catch {
    return code;
  }
}

function computeFlag(region?: string): string | undefined {
  if (!region) return undefined;
  if (!/^[A-Z]{2}$/.test(region)) return undefined;
  const cc = region.toLowerCase();
  return `https://flagcdn.com/w40/${cc}.png`;
}
