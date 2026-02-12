export type LanguageEntry = {
  rank?: number;
  code: string;
  englishName?: string;
  nativeName?: string;
  flag?: string;
  default?: boolean;
  active?: boolean;
};

export type AggressiveMode = "low" | "moderate" | "high";

export type FoundString = {
  fileAbs: string;
  fileRelFromSrc: string; // like components/component1.html
  line: number;
  column: number;
  text: string;
  rawText?: string; // The exact raw text in the file (including whitespace if relevant for replacement matching)
  isAlreadyTranslated?: boolean;
  kind: "js-string" | "js-template" | "html-text" | "html-attr" | "html-interpolation";
};

export type RestrictedString = {
  fileAbs: string;
  fileRelFromSrc: string;
  line: number;
  column: number;
  text: string;
  kind: "js-string" | "js-template";
  reason: string;
  context?: string;
};

