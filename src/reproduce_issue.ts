
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { extractFromJsTs } from './extractJsTs';
import { replaceExtractedStrings } from './replaceSource';
import { FoundString } from './types';

async function run() {
    const testFile = path.resolve(__dirname, 'test-component.ts');

    // Test case with:
    // 1. Regular string (double quotes)
    // 2. Regular string (single quotes)
    // 3. Inline template with element (multiline)
    const content = `import { Component } from '@angular/core';

@Component({
  selector: 'app-test',
  template: \`
    <h1>Hello World</h1>
    <p>Inline Template</p>
  \`
})
export class TestComponent {
  title = 'My Title';
  message = "Welcome Users";

  greet() {
    console.log('Logging Message');
  }
}
`;

    // Write validation: we expect these strings to be replaced
    // 'My Title' -> this.translate.instant('MY_TITLE')
    // "Welcome Users" -> this.translate.instant('WELCOME_USERS')
    // 'Logging Message' -> this.translate.instant('LOGGING_MESSAGE')
    // <h1>Hello World</h1> -> <h1>{{ 'HELLO_WORLD' | translate }}</h1>
    // <p>Inline Template</p> -> <p>{{ 'INLINE_TEMPLATE' | translate }}</p>

    await fs.writeFile(testFile, content, 'utf8');
    console.log(`Created test file at ${testFile}`);

    try {
        // Extract strings
        // We look for everything > 2 chars
        // We look for 'title' attribute if needed, but not relevant here
        const found = await extractFromJsTs(testFile, 'test-component.ts', 2, ['title']);

        console.log('--- Found Strings ---');
        found.forEach(f => {
            console.log(`[${f.kind}] Line: ${f.line}, Col: ${f.column}, Text: "${f.text}"`);
            if (f.rawText) console.log(`      RawText: "${f.rawText}"`);
        });

        // Simulate key generation
        const keyMap: Record<string, string> = {};
        found.forEach(f => {
            keyMap[f.text] = f.text.toUpperCase().replace(/\s+/g, '_');
        });

        const keyMapByFile = {
            [testFile]: keyMap
        };

        // Perform replacement
        console.log('\n--- Replacing Strings ---');
        const result = await replaceExtractedStrings({
            workspaceRoot: __dirname,
            found,
            keyMapByFile,
            bootstrapStyle: 'standalone'
        });

        console.log('Replacement Result:', result);

        const newContent = await fs.readFile(testFile, 'utf8');
        console.log('\n--- New Content ---');
        console.log(newContent);

        // Assertions
        const checks = [
            "this.translate.instant('MY_TITLE')",
            "this.translate.instant('WELCOME_USERS')",
            "this.translate.instant('LOGGING_MESSAGE')",
            "{{ 'HELLO_WORLD' | translate }}",
            "{{ 'INLINE_TEMPLATE' | translate }}"
        ];

        const failures = checks.filter(check => !newContent.includes(check));

        if (failures.length === 0) {
            console.log('\nSUCCESS: All expected replacements found.');
        } else {
            console.error('\nFAILURE: Missing replacements:');
            failures.forEach(f => console.error(` - ${f}`));
        }

    } catch (err) {
        console.error('Error:', err);
    }
}

run();
