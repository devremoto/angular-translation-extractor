import { extractFromJsTs } from '../extractJsTs';
import * as path from 'path';

async function testNonComponentExtraction() {
    const fileAbs = path.join(__dirname, '../../sample', 'non-component.ts');
    const fileRelFromSrc = 'non-component.ts';

    console.log('\n========== EXTRACTING FROM non-component.ts (NO @Component) ==========\n');

    const found = await extractFromJsTs(fileAbs, fileRelFromSrc, 3, []);

    console.log(`Found ${found.length} strings (should be 0!):\n`);

    if (found.length === 0) {
        console.log('✅ CORRECT! No strings extracted from non-@Component classes');
    } else {
        console.log('❌ ERROR! Strings should NOT be extracted from non-@Component classes:');
        found.forEach((item, index) => {
            console.log(`${index + 1}. [${item.kind}] "${item.text}"`);
        });
    }
}

testNonComponentExtraction().catch(console.error);
