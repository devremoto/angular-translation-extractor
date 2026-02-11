import * as fs from "node:fs/promises";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { FoundString } from "./types";
import { extractFromHtmlContent } from "./extractHtml";

export async function extractFromJsTs(
  fileAbs: string,
  fileRelFromSrc: string,
  minLen: number,
  attributeNames: string[]
): Promise<FoundString[]> {
  const code = await fs.readFile(fileAbs, "utf8");
  return extractFromJsTsContent(code, fileAbs, fileRelFromSrc, minLen, attributeNames);
}

export function extractFromJsTsContent(
  code: string,
  fileAbs: string,
  fileRelFromSrc: string,
  minLen: number,
  attributeNames: string[]
): FoundString[] {
  let ast: any;

  try {
    ast = parse(code, {
      sourceType: "unambiguous",
      plugins: ["typescript", "decorators-legacy"]
    });
  } catch {
    return [];
  }

  const found: FoundString[] = [];
  const processedTemplateNodes = new WeakSet();

  function add(kind: FoundString["kind"], text: string, loc: any) {
    if (!isProbablyUserFacing(text, minLen)) return;
    if ((kind === "js-string" || kind === "js-template") && looksLikeModuleSpecifier(text)) return;
    if (!loc) return;

    let rawText: string | undefined;
    if (loc.start && loc.end) {
      const startIdx = indexFromLineCol(code, loc.start.line, loc.start.column);
      const endIdx = indexFromLineCol(code, loc.end.line, loc.end.column);
      if (startIdx >= 0 && endIdx >= startIdx) {
        rawText = code.slice(startIdx, endIdx);
      }
    }

    found.push({
      fileAbs,
      fileRelFromSrc,
      line: loc.start?.line ?? 1,
      column: loc.start?.column ?? 0,
      text,
      rawText,
      kind
    });
  }

  // First pass: find all @Component decorators and extract ONLY from inline templates
  traverse(ast, {
    Decorator(decoratorPath: any) {
      const expr = decoratorPath.node.expression;
      if (expr?.type !== "CallExpression" || expr.callee?.name !== "Component") return;
      if (!expr.arguments?.length) return;

      const componentArg = expr.arguments[0];
      if (componentArg?.type !== "ObjectExpression") return;

      // Find template property
      const templateProp = componentArg.properties.find((prop: any) => {
        if (prop.type !== "ObjectProperty") return false;
        const key = prop.key;
        const keyName = key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? key.value : "";
        return keyName === "template";
      });

      if (!templateProp) return;

      // Mark this node as processed so StringLiteral/TemplateLiteral don't process it again
      processedTemplateNodes.add(templateProp.value);

      // Use raw source code for template content to ensure CRLF/exact characters validation passes
      let templateText: string | null = null;
      if (typeof templateProp.value.start === "number" && typeof templateProp.value.end === "number") {
        // Slice from code (removing quotes/backticks)
        templateText = code.slice(templateProp.value.start + 1, templateProp.value.end - 1);
      } else {
        templateText = getTemplateString(templateProp.value);
      }

      if (templateText === null) return;

      const loc = templateProp.value.loc?.start;
      const baseLine = loc?.line ?? 1;
      const baseCol = (loc?.column ?? 0) + 1;

      const inlineFound = extractFromHtmlContent(
        templateText,
        fileAbs,
        fileRelFromSrc,
        minLen,
        attributeNames,
        baseLine,
        baseCol
      );
      found.push(...inlineFound);
    },

    // Extract strings from Class code
    StringLiteral(path: any) {
      if (processedTemplateNodes.has(path.node)) return;
      if (inIgnoredContext(path)) return;
      if (inControlFlowCondition(path)) return;

      // Strict checking: Only extract if specifically in a message/display context
      // or if it looks very much like a sentence (has spaces, starts with capital)
      const text = path.node.value;
      if (!isProbablyUserFacing(text, minLen)) return;

      if (inMessageContext(path) || isHighConfidenceString(text)) {
        add("js-string", text, path.node.loc);
      }
    },

    TemplateLiteral(path: any) {
      if (processedTemplateNodes.has(path.node)) return;
      if (path.node.expressions.length > 0) return; // Skip complex template literals for now
      if (inIgnoredContext(path)) return;
      if (inControlFlowCondition(path)) return;

      const text = path.node.quasis.map((q: any) => q.value.cooked).join("");
      if (!isProbablyUserFacing(text, minLen)) return;

      if (inMessageContext(path) || isHighConfidenceString(text)) {
        add("js-template", text, path.node.loc);
      }
    }
  });

  return found;
}

function isHighConfidenceString(t: string): boolean {
  // Contains spaces and starts with capital letter = likely a sentence/label
  if (/\s/.test(t) && /^[A-Z]/.test(t)) return true;
  // Contains specific punctuation used in text
  if (/[.!?]$/.test(t)) return true;
  return false;
}

function getTemplateString(valueNode: any): string | null {
  if (!valueNode) return null;

  if (valueNode.type === "StringLiteral") {
    return valueNode.value ?? "";
  }

  if (valueNode.type === "TemplateLiteral") {
    if (valueNode.expressions?.length) return null;
    return valueNode.quasis.map((q: any) => q.value.cooked ?? "").join("");
  }

  return null;
}

function isProbablyUserFacing(s: string, minLen: number): boolean {
  const t = (s ?? "").trim();
  if (t.length < minLen) return false;

  if (/^[\d\s]+$/.test(t)) return false;
  if (/^[\p{P}\p{S}\s]+$/u.test(t)) return false;
  if (/^(https?:\/\/|\/|#)/.test(t)) return false;

  if (/^[A-Z0-9_.-]{8,}$/.test(t)) return false;
  if (/^[a-f0-9]{8,}$/i.test(t)) return false;
  if (/\{\{[\s\S]*?\}\}|\$\{[\s\S]*?\}/.test(t)) return false;

  return true;
}

function looksLikeModuleSpecifier(s: string): boolean {
  const t = (s ?? "").trim();
  if (!t) return false;
  if (/^(@|\.{1,2}\/)/.test(t)) return true;
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(t)) return true;
  return false;
}

function inIgnoredContext(p: any): boolean {
  const parent = p.parent;
  const grand = p.parentPath?.parent?.node;

  // STRICT RULE: Ignore ALL strings inside @Component decorator except for 'template' property
  // We already handle 'template' property in the separate traversal pass, so we can ignore ALL of them here
  const decorator = p.findParent?.((pp: any) => pp.isDecorator?.());
  if (decorator) {
    const expr = decorator.node.expression;
    if (expr?.type === "CallExpression" && expr.callee?.type === "Identifier") {
      const name = expr.callee.name;
      // Block known Angular decorators that use metadata strings, not user content
      if ([
        "Component", "Directive", "Pipe", "NgModule", "Injectable",
        "Input", "Output", "HostBinding", "HostListener",
        "ViewChild", "ViewChildren", "ContentChild", "ContentChildren"
      ].includes(name)) {
        return true;
      }
    }
  }

  if (p.parentPath?.isImportDeclaration?.() || p.parentPath?.isExportNamedDeclaration?.() || p.parentPath?.isExportAllDeclaration?.()) return true;
  if (p.parentPath?.isImportExpression?.() || p.parentPath?.isTSImportType?.()) return true;
  if (p.key === "source" && (parent?.type === "ImportDeclaration" || parent?.type === "ExportAllDeclaration" || parent?.type === "ExportNamedDeclaration")) {
    return true;
  }

  if (parent?.type === "ImportDeclaration") return true;
  if (parent?.type === "ImportExpression") return true;
  if (parent?.type === "TSImportType") return true;
  if (parent?.type === "ExportAllDeclaration" || parent?.type === "ExportNamedDeclaration") return true;

  if (parent?.type === "ObjectProperty" && parent.key === grand) return true;

  if (parent?.type === "MemberExpression" && parent.property === grand && parent.computed) return true;

  if (parent?.type === "CallExpression") {
    if (parent.callee?.type === "Import") {
      return true;
    }
    if (typeof parent.callee?.name === "string") {
      const name = parent.callee.name;
      if (name === "require" || name === "import") {
        return true;
      }
    }
  }

  // Ignore strings in import/export specifiers
  if (parent?.type === "ImportSpecifier" || parent?.type === "ExportSpecifier") return true;

  // Specific Decorator checks:
  // 1. @Component: Only strictly allow template property (handled by first pass visitor, so ignore all here)
  // 2. @Injectable: Ignore providedIn
  // 3. Any other decorator property that is NOT explicitly allowed/safe

  // Find the ObjectProperty we are inside
  const objectProp = p.findParent?.((pp: any) => pp.isObjectProperty?.());
  if (objectProp) {
    const keyName = objectProp.node.key?.name; // e.g. "selector", "template", "providedIn"

    // Find if this ObjectProperty is inside a Decorator
    const decorator = objectProp.findParent?.((pp: any) => pp.isDecorator?.());

    if (decorator) {
      const expression = decorator.node.expression;
      if (expression?.type === "CallExpression") {
        const calleeName = expression.callee?.name;

        // Block @Component properties (template is handled elsewhere or processed already)
        if (calleeName === "Component") {
          // We ignore EVERYTHING inside @Component in this generic visitor
          // valid 'template' strings should have been processed by the Decorator visitor pass
          // or if it's a simple string template, we want to allow it ONLY if it is the template property.
          // But since we use processedTemplateNodes to skip handled templates, 
          // any other string here is likely selector, styles, etc.
          // So we can safely ignore all.
          return true;
        }

        // Block @Injectable providedIn
        if (calleeName === "Injectable") {
          return true;
        }

        // Block @NgModule declarations, imports, exports, providers, bootstrap
        if (calleeName === "NgModule") {
          return true;
        }

        // Block @Pipe name
        if (calleeName === "Pipe") {
          return true;
        }

        // Block @Directive selector
        if (calleeName === "Directive") {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if string is in a control flow condition (if, for, while, switch, ternary)
 */
function inControlFlowCondition(p: any): boolean {
  // Check if we're in an if statement test
  if (p.findParent?.((pp: any) => {
    if (pp.isIfStatement?.()) {
      return pp.node.test === p.node || isAncestorOf(pp.node.test, p.node);
    }
    return false;
  })) {
    return true;
  }

  // Check if we're in a for statement (init, test, or update)
  if (p.findParent?.((pp: any) => {
    if (pp.isForStatement?.()) {
      const forNode = pp.node;
      return forNode.init === p.node || isAncestorOf(forNode.init, p.node) ||
        forNode.test === p.node || isAncestorOf(forNode.test, p.node) ||
        forNode.update === p.node || isAncestorOf(forNode.update, p.node);
    }
    return false;
  })) {
    return true;
  }

  // Check if we're in a while statement test
  if (p.findParent?.((pp: any) => {
    if (pp.isWhileStatement?.() || pp.isDoWhileStatement?.()) {
      return pp.node.test === p.node || isAncestorOf(pp.node.test, p.node);
    }
    return false;
  })) {
    return true;
  }

  // Check if we're in a switch discriminant
  if (p.findParent?.((pp: any) => {
    if (pp.isSwitchStatement?.()) {
      return pp.node.discriminant === p.node || isAncestorOf(pp.node.discriminant, p.node);
    }
    return false;
  })) {
    return true;
  }

  // Check if we're in a ternary (conditional expression) test
  if (p.findParent?.((pp: any) => {
    if (pp.isConditionalExpression?.()) {
      return pp.node.test === p.node || isAncestorOf(pp.node.test, p.node);
    }
    return false;
  })) {
    return true;
  }

  return false;
}

/**
 * Check if string is in a message/alert/confirmation context (should be extracted)
 */
function inMessageContext(p: any): boolean {
  // Check if we're in a call expression with message-related method names
  const callExpr = p.findParent?.((pp: any) => pp.isCallExpression?.());
  if (callExpr) {
    const callee = callExpr.node.callee;

    // Direct function calls: alert, confirm, prompt, throw
    if (callee?.type === "Identifier") {
      const name = callee.name;
      if (["alert", "confirm", "prompt", "Error", "TypeError", "RangeError", "ReferenceError",
        "SyntaxError", "URIError", "EvalError"].includes(name)) {
        return true;
      }
    }

    // Method calls: console.log, console.error, window.alert, etc.
    if (callee?.type === "MemberExpression") {
      const propName = callee.property?.name;
      const objName = callee.object?.name;

      // DO NOT extract from console.* methods
      if (objName === "console") {
        return false;
      }

      // Also ignore common logging libraries/methods if identified
      if (["log", "debug", "trace"].includes(propName)) {
        // Simple heuristic: if method is just 'log', 'debug', or 'trace', assume it's developer-facing
        return false;
      }

      // window.alert, window.confirm, window.prompt
      if (objName === "window" && ["alert", "confirm", "prompt"].includes(propName)) {
        return true;
      }

      // Common message/error methods by name pattern
      if (["toast", "snackbar", "notification", "message", "showMessage", "showError",
        "showWarning", "showInfo", "showSuccess", "openSnackBar", "open", "error",
        "success", "warning", "info", "set", "setText", "setMessage", "setError",
        "add", "push", "show", "display", "present", "alert", "notify", "emit",
        "throwError", "reject", "fail", "setContent", "setTitle", "setDescription"].includes(propName)) {
        return true;
      }

      // Check if the object itself has a message-related name
      if (callee.object?.type === "MemberExpression") {
        const serviceProp = callee.object.property?.name;
        if (["toastr", "snackBar", "messageService", "notificationService", "toast",
          "dialog", "modal", "alert", "notification", "message"].includes(serviceProp)) {
          return true;
        }
      }

      // Check if object name suggests it's related to errors/messages (like this.error, this.message)
      if (callee.object?.type === "MemberExpression" && callee.object.object?.type === "ThisExpression") {
        const objPropName = callee.object.property?.name;
        if (objPropName && /^(error|message|notification|alert|toast|status|feedback|result|response)s?$/i.test(objPropName)) {
          return true;
        }
      }

      // Direct this.error, this.message patterns (e.g., this.error.set(...))
      if (objName && /^(error|message|notification|alert|toast|status|feedback)s?$/i.test(objName)) {
        return true;
      }
    }
  }

  // Check if we're in a throw statement
  if (p.findParent?.((pp: any) => pp.isThrowStatement?.())) {
    return true;
  }

  // Check if we're in a new Expression for Error types
  const newExpr = p.findParent?.((pp: any) => pp.isNewExpression?.());
  if (newExpr) {
    const calleeName = newExpr.node.callee?.name;
    if (calleeName && /Error$/.test(calleeName)) {
      return true;
    }
  }

  // Check if we're in a decorator (like @Component)
  if (p.findParent?.((pp: any) => pp.isDecorator?.())) {
    return true;
  }

  // Check if we're in an object property with message-related key names
  const objProp = p.findParent?.((pp: any) => pp.isObjectProperty?.());
  if (objProp) {
    const keyName = objProp.node.key?.name || objProp.node.key?.value;
    if (["title", "message", "text", "label", "placeholder", "tooltip", "description",
      "errorMessage", "successMessage", "warningMessage", "infoMessage", "header",
      "content", "body", "subject", "detail", "summary", "error", "warning", "info",
      "success", "alert", "notification", "feedback", "status", "statusText"].includes(keyName)) {
      return true;
    }
  }

  return false;
}

/**
 * Helper to check if childNode is a descendant of parentNode
 */
function isAncestorOf(parentNode: any, childNode: any): boolean {
  if (!parentNode || !childNode) return false;

  function traverse(node: any): boolean {
    if (node === childNode) return true;
    if (!node || typeof node !== "object") return false;

    for (const key in node) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (traverse(item)) return true;
        }
      } else if (typeof value === "object") {
        if (traverse(value)) return true;
      }
    }
    return false;
  }

  return traverse(parentNode);
}

function indexFromLineCol(content: string, line: number, col: number): number {
  if (line < 1 || col < 0) return -1;
  let currentLine = 1;
  let index = 0;
  while (index < content.length && currentLine < line) {
    if (content.charCodeAt(index) === 10) currentLine++;
    index++;
  }
  if (currentLine !== line) return -1;
  return index + col;
}
