import { extractFromJsTs } from '../extractJsTs';
import * as path from 'path';

async function testExtraction() {
    const fileAbs = path.join(__dirname, '../../sample', 'test-ts-strings.ts');
    const fileRelFromSrc = 'test-ts-strings.ts';

    console.log('Testing extraction from:', fileAbs);
    console.log('='.repeat(60));

    const found = await extractFromJsTs(fileAbs, fileRelFromSrc, 3, []);

    console.log(`\nFound ${found.length} strings:\n`);

    found.forEach((item, index) => {
        console.log(`${index + 1}. [${item.kind}] "${item.text}"`);
        console.log(`   Line: ${item.line}, Column: ${item.column}`);
        console.log('');
    });
}

testExtraction().catch(console.error);
