
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// --- Mocking extractHtmlContent ---
function extractFromHtmlContent(html, fileAbs, fileRelFromSrc, minLen, attributeNames, baseLine, baseCol) {
    const found = [];
    const textRe = />((?:(?!<).)+)</gms;
    let m;
    while ((m = textRe.exec(html))) {
        const rawContent = m[1];
        const text = rawContent.trim();
        if (text.length < minLen) continue;

        const leadingWsMatch = rawContent.match(/^\s*/);
        const leadingWsLen = leadingWsMatch ? leadingWsMatch[0].length : 0;
        const rawText = rawContent.trim();
        
        const startOffset = m.index + 1 + leadingWsLen;
        const loc = locate(html, startOffset);
        const adjusted = adjustLocation(loc.line, loc.col, baseLine, baseCol);
        
        console.log(`[HTML] Found "${text}" at offset ${startOffset} (in template).`);
        console.log(`       Template Loc: line ${loc.line}, col ${loc.col}`);
        console.log(`       Adjusted Loc: line ${adjusted.line}, col ${adjusted.col}`);

        found.push({
            fileAbs,
            line: adjusted.line,
            column: adjusted.col,
            text,
            rawText,
            kind: "html-text"
        });
    }
    return found;
}

function locate(content, index) {
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

function adjustLocation(line, col, baseLine, baseCol) {
  if (line === 1) {
    return { line: baseLine, col: baseCol + col };
  }
  return { line: baseLine + line - 1, col };
}

// --- Mocking extractJsTs ---
async function extractFromJsTs(fileAbs) {
  const code = fs.readFileSync(fileAbs, "utf8");
  const ast = parser.parse(code, {
      sourceType: "unambiguous",
      plugins: ["typescript", "decorators-legacy"]
  });

  const found = [];

  traverse(ast, {
    Decorator(path) {
      const expr = path.node.expression;
      if (expr?.type !== "CallExpression" || expr.callee?.name !== "Component") return;
      const componentArg = expr.arguments[0];
      const templateProp = componentArg.properties.find(p => p.key.name === "template");
      
      if (!templateProp) return;

      console.log(`[JS] Found template property at line ${templateProp.value.loc.start.line}.`);

      let templateText = null;
      if (typeof templateProp.value.start === "number" && typeof templateProp.value.end === "number") {
         templateText = code.slice(templateProp.value.start + 1, templateProp.value.end - 1);
      }
      
      if (!templateText) return;

      const loc = templateProp.value.loc.start;
      const baseLine = loc.line;
      const baseCol = loc.column + 1;
      
      console.log(`[JS] Template Base: line ${baseLine}, col ${baseCol}`);
      console.log(`[JS] Template Text Start (first 20 chars): ${JSON.stringify(templateText.slice(0, 20))}`);

      const inlineFound = extractFromHtmlContent(
        templateText,
        fileAbs,
        "",
        2,
        [],
        baseLine,
        baseCol
      );
      found.push(...inlineFound);
    }
  });

  return found;
}

// --- Mocking Replacement ---
function indexFromLineCol(content, line, col) {
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

async function run() {
    const testFile = path.resolve(__dirname, 'repro_real.ts');
    
    // Simulate user file structure
    const content = `import { Component } from '@angular/core';

@Component({
  selector: 'app-main-layout',
  template: \`
    <div class="flex h-screen">
      <aside>
        <span class="font-bold">CV Engine</span>
        <nav>
          <a routerLink="/">Optimization Wizard</a>
          <a routerLink="/sources">Source CVs</a>
        </nav>
      </aside>
    </div>
  \`
})
export class MainLayoutComponent {}
`;
    
    fs.writeFileSync(testFile, content, 'utf8');
    console.log('Created test file.');
    
    const found = await extractFromJsTs(testFile);
    
    console.log(`\nFound ${found.length} strings.`);
    
    // Validate extraction
    const target = found.find(f => f.text === "Source CVs");
    if (target) {
        console.log(`\nTARGET "Source CVs" found:`);
        console.log(`  Line: ${target.line}, Column: ${target.column}`);
        console.log(`  Raw: "${target.rawText}"`);
        
        // Check content match
        const fileContent = fs.readFileSync(testFile, 'utf8');
        const start = indexFromLineCol(fileContent, target.line, target.column);
        console.log(`  Calculated Start Index: ${start}`);
        
        const extractedFromPlace = fileContent.slice(start, start + target.rawText.length);
        console.log(`  Content at place: "${extractedFromPlace}"`);
        
        if (extractedFromPlace === target.rawText) {
            console.log("  ✅ MATCH SUCCESS");
        } else {
            console.log("  ❌ MATCH FAILED");
        }
    } else {
        console.log("❌ Target string not found!");
    }
}

run();
