
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { extractFromJsTs } from './extractJsTs';
import { replaceExtractedStrings } from './replaceSource';

async function run() {
    console.log('--- Debugging Replacement Logic ---');

    // Create a temporary test file
    const testFile = path.resolve(__dirname, 'debug_repro.ts');

    // Use CRLF to mimic Windows behavior if needed, or just LF
    const content = `import { Component } from '@angular/core';

@Component({
  selector: 'app-test',
  template: \`
    <div>Hello World</div>
    <span title="Tooltip">Info</span>
  \`
})
export class TestComponent {
  title = 'My Title';
  
  greet() {
    alert("Hello User");
  }
}
`;

    await fs.writeFile(testFile, content, 'utf8');
    console.log(`Created ${testFile} (${content.length} bytes)`);

    // 1. Extract
    console.log('\n--- Extracting ---');
    const found = await extractFromJsTs(testFile, 'debug_repro.ts', 2, ['title']);

    console.log(`Found ${found.length} items:`);
    found.forEach((f, i) => {
        console.log(`[${i}] ${f.kind} "${f.text}"`);
        console.log(`    Line: ${f.line}, Col: ${f.column}`);
        console.log(`    RawText: "${f.rawText?.replace(/\n/g, '\\n')}"`);
    });

    // 2. Prepare Replacement
    const keyMap = {
        'Hello World': 'HELLO_WORLD',
        'Tooltip': 'TOOLTIP',
        'My Title': 'MY_TITLE',
        'Hello User': 'HELLO_USER'
    };

    const keyMapByFile = { [testFile]: keyMap };

    // 3. Replace
    console.log('\n--- Replacing ---');
    try {
        const result = await replaceExtractedStrings({
            workspaceRoot: __dirname,
            found,
            keyMapByFile,
            bootstrapStyle: 'standalone'
        });

        console.log('Result:', result);

        const newContent = await fs.readFile(testFile, 'utf8');
        console.log('\n--- New Content ---');
        console.log(newContent);

    } catch (err) {
        console.error('Replacement failed:', err);
    }
}

run();
