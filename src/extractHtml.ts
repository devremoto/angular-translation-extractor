import * as fs from "node:fs/promises";
import { FoundString } from "./types";

export async function extractFromHtml(
  fileAbs: string,
  fileRelFromSrc: string,
  minLen: number,
  attributeNames: string[]
): Promise<FoundString[]> {
  const html = await fs.readFile(fileAbs, "utf8");
  return extractFromHtmlContent(html, fileAbs, fileRelFromSrc, minLen, attributeNames, 1, 0);
}

export function extractFromHtmlContent(
  html: string,
  fileAbs: string,
  fileRelFromSrc: string,
  minLen: number,
  attributeNames: string[],
  baseLine: number,
  baseCol: number
): FoundString[] {
  const found: FoundString[] = [];
  const attrsSet = new Set(attributeNames.map(a => a.toLowerCase()));

  // Mask <style> and <script> content to avoid false positives in regexes
  let maskedHtml = html.replace(/(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (match, open, tag, content, closeTag) => {
    // Replace content with spaces, but preserve newlines to keep line numbers accurate
    return open + content.replace(/[^\n]/g, " ") + closeTag;
  });

  // Mask HTML comments entirely. The tag regex below cannot parse `<!-- ... -->` (comments span
  // lines and may contain `<style>`, quotes, `>`), so without this a comment's text is mistaken
  // for a text node, extracted, and the replacement destroys the comment — unbalancing every
  // tag after it (NG5002 far from the real damage).
  maskedHtml = maskedHtml.replace(/<!--[\s\S]*?(?:-->|$)/g, match => match.replace(/[^\n]/g, " "));

  const tagRe = /<(?:\/|[a-zA-Z]|!)(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
  let lastIndex = 0;
  const textMatches: { content: string; offset: number }[] = [];

  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(maskedHtml))) {
    const rawContent = maskedHtml.substring(lastIndex, tagMatch.index);
    if (rawContent.trim().length > 0) {
      textMatches.push({ content: rawContent, offset: lastIndex });
    }
    lastIndex = tagRe.lastIndex;
  }
  const remainingContent = maskedHtml.substring(lastIndex);
  if (remainingContent.trim().length > 0) {
    textMatches.push({ content: remainingContent, offset: lastIndex });
  }

  for (const textMatch of textMatches) {
    const rawContent = textMatch.content;

    // Split by interpolation {{...}} to extract mix of static text and dynamic content separately
    // e.g. "Hello, {{ name }}" -> parts: ["Hello, ", (gap), ""]
    const parts: { content: string; offset: number }[] = [];

    // Only split if we actually see start of interpolation
    if (rawContent.includes('{{')) {
      let partLastIndex = 0;
      const interpolationRe = /\{\{[\s\S]*?\}\}/g;
      let interpMatch;

      while ((interpMatch = interpolationRe.exec(rawContent)) !== null) {
        // Text before interpolation
        if (interpMatch.index > partLastIndex) {
          parts.push({
            content: rawContent.substring(partLastIndex, interpMatch.index),
            offset: partLastIndex
          });
        }
        partLastIndex = interpMatch.index + interpMatch[0].length;
      }
      // Text after last interpolation
      if (partLastIndex < rawContent.length) {
        parts.push({
          content: rawContent.substring(partLastIndex),
          offset: partLastIndex
        });
      }
    } else {
      // No interpolation, check whole string
      parts.push({ content: rawContent, offset: 0 });
    }

    // Split each part further on Angular control-flow syntax (braces and @block headers).
    // Text nodes routinely carry `}`, `} @else {`, `@if (cond) {` — replacing across those
    // tokens deletes block delimiters and corrupts the template (NG5002).
    const segments = parts.flatMap(part =>
      splitOutControlFlow(part.content).map(seg => ({
        content: seg.content,
        offset: part.offset + seg.offset
      }))
    );

    for (const part of segments) {
      const text = decodeEntities(part.content).trim();
      if (!isProbablyUserFacing(text, minLen)) continue;

      const leadingWsMatch = part.content.match(/^\s*/);
      const leadingWsLen = leadingWsMatch ? leadingWsMatch[0].length : 0;
      const rawText = part.content.trim();

      // Calculate offset
      const startOffset = textMatch.offset + part.offset + leadingWsLen;

      // Use original HTML for location to be safe
      const { line, col } = locate(html, startOffset);
      const adjusted = adjustLocation(line, col, baseLine, baseCol);
      found.push({
        fileAbs,
        fileRelFromSrc,
        line: adjusted.line,
        column: adjusted.col,
        text,
        rawText,
        kind: "html-text"
      });
    }
  }

  let m: RegExpExecArray | null;
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/gms;
  while ((m = attrRe.exec(maskedHtml))) {
    const attrName = (m[1] || "").toLowerCase();
    if (!attrsSet.has(attrName)) continue;

    const rawVal = m[3] ?? m[4] ?? "";
    const val = decodeEntities(rawVal).trim();
    if (!isProbablyUserFacing(val, minLen)) continue;

    const fullMatch = m[0];
    const quoteChar = m[2][0];
    const quoteIndexInMatch = fullMatch.indexOf(quoteChar);

    const leadingWsMatch = rawVal.match(/^\s*/);
    const leadingWsLen = leadingWsMatch ? leadingWsMatch[0].length : 0;
    const rawText = rawVal.trim();

    const startOffset = m.index + quoteIndexInMatch + 1 + leadingWsLen;

    const { line, col } = locate(html, startOffset);
    const adjusted = adjustLocation(line, col, baseLine, baseCol);
    found.push({
      fileAbs,
      fileRelFromSrc,
      line: adjusted.line,
      column: adjusted.col,
      text: val,
      rawText,
      kind: "html-attr"
    });
  }

  // Removed extraction of existing [translate] and translate attributes per user request.

  // Extract strings from {{ }} interpolations (ternary and plain strings without | translate)
  const interpolationRe = /\{\{([^}]+)\}\}/gms;
  while ((m = interpolationRe.exec(maskedHtml))) {
    const expr = m[1];
    const exprIndex = m.index + 2; // Account for {{

    // Skip if this expression already has | translate completely
    if (/\|\s*translate/.test(expr)) {
      continue;
    }

    // Extract all string literals from the expression
    const stringRe = /(['"])(?:(?=(\\?))\2.)*?\1/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = stringRe.exec(expr))) {
      const rawStrWithQuotes = strMatch[0];
      const rawContent = rawStrWithQuotes.slice(1, -1);
      const text = rawContent.replace(/\\(['"])/g, '$1');

      if (text.length < minLen) continue;
      if (/^[\d\s]+$/.test(text)) continue;

      // SKIP pipe format arguments (date/currency/number/time pipes)
      // Check if this string comes after a pipe operator
      const beforeString = expr.substring(0, strMatch.index);
      if (/\|\s*\w+\s*:\s*$/.test(beforeString)) {
        // This string is a pipe argument (e.g., date:'short', currency:'USD')
        continue;
      }

      // SKIP pipe names themselves (after single pipe, before colon)
      // e.g., skip 'translate' in {{ x | translate }}
      if (/\|\s*$/.test(beforeString)) {
        continue;
      }

      const startOffset = exprIndex + strMatch.index;

      const { line, col } = locate(html, startOffset);
      const adjusted = adjustLocation(line, col, baseLine, baseCol);
      found.push({
        fileAbs,
        fileRelFromSrc,
        line: adjusted.line,
        column: adjusted.col,
        text,
        rawText: rawStrWithQuotes,
        kind: "html-interpolation"
      });
    }
  }

  return found;
}

/**
 * Angular block syntax that may appear inside a text node: `{`, `}`, and block headers like
 * `@if (cond)`, `@else if (x)`, `@for (item of list; track item.id)`, `@switch`, `@defer` etc.
 * Restricted to the known keywords so text like "user@example.com" is untouched.
 */
const CONTROL_FLOW_TOKEN_RE =
  /@else\s+if\b(?:\s*\((?:[^()]|\([^()]*\))*\))?|@(?:if|for|switch|case|default|empty|defer|placeholder|loading|error|let)\b(?:\s*\((?:[^()]|\([^()]*\))*\))?|@else\b|[{}]/g;

/**
 * Splits a text-node chunk into segments that lie BETWEEN control-flow tokens.
 * The tokens themselves (braces, @block headers) are dropped — they are template
 * structure, never user-facing text, and must never be replaced.
 */
export function splitOutControlFlow(content: string): Array<{ content: string; offset: number }> {
  if (!/[{}]|@[a-z]/i.test(content)) {
    return [{ content, offset: 0 }];
  }
  const segments: Array<{ content: string; offset: number }> = [];
  let last = 0;
  CONTROL_FLOW_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONTROL_FLOW_TOKEN_RE.exec(content))) {
    if (m.index > last) {
      segments.push({ content: content.slice(last, m.index), offset: last });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    segments.push({ content: content.slice(last), offset: last });
  }
  return segments;
}

function isProbablyUserFacing(s: string, minLen: number): boolean {
  const t = (s ?? "").trim();
  if (t.length < minLen) return false;

  if (/^[\d\s]+$/.test(t)) return false;
  if (/^[\p{P}\p{S}\s]+$/u.test(t)) return false;
  if (/^(https?:\/\/|\/|#)/.test(t)) return false;

  if (/\{\{[\s\S]*?\}\}|\$\{[\s\S]*?\}/.test(t)) return false;

  // Skip Angular control flow syntax: @if, @for, @switch, @case, @else, @empty
  if (/@(if|for|switch|case|else|empty|defer|loading|error|placeholder)\s*\(/i.test(t)) return false;

  // Skip content that looks like closing braces and control flow: }@if(...){ or }{...}
  if (/^\s*\}\s*@/i.test(t) || /^\s*\}\s*\{/i.test(t)) return false;

  // Skip content that's just brackets and symbols
  if (/^[{}()[\]\s@]+$/.test(t)) return false;

  // Skip strings with escaped quotes (likely HTML fragments)
  if (/\\"/.test(t)) return false;

  // Skip strings that look like HTML attribute fragments (contain = and quotes)
  if (/=["']|["']\s*(class|id|type|name|placeholder|title|alt|aria|data)\s*=/i.test(t)) return false;

  // Skip strings that look like HTML class values (space-separated words with hyphens)
  if (/^[a-z0-9-]+(\s+[a-z0-9-]+)*$/i.test(t) && t.includes('-')) return false;

  // Skip strings that are clearly escaped HTML or contain control flow patterns
  if (/\\[nt"'`<>\\]/.test(t)) return false;

  // Skip if it contains TypeScript/JavaScript property access or method calls
  if (/\?\.|\)\s*\?\.|\(\s*\)|store\.|\w+\(\./.test(t)) return false;

  return true;
}

function decodeEntities(s: string): string {
  return s
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function locate(content: string, index: number): { line: number; col: number } {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, col: index - lastNl - 1 };
}

function adjustLocation(line: number, col: number, baseLine: number, baseCol: number): { line: number; col: number } {
  if (line === 1) {
    return { line: baseLine, col: baseCol + col };
  }
  return { line: baseLine + line - 1, col };
}
