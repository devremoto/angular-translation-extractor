import { extractFromJsTs } from '../extractJsTs';
import * as path from 'path';

async function testConfirmExtraction() {
    const fileAbs = path.join(__dirname, '../../sample', 'confirm-example.ts');
    const fileRelFromSrc = 'confirm-example.ts';

    console.log('\n========== EXTRACTING FROM confirm-example.ts ==========\n');

    const found = await extractFromJsTs(fileAbs, fileRelFromSrc, 3, []);

    console.log(`✅ Found ${found.length} strings:\n`);

    found.forEach((item, index) => {
        console.log(`${index + 1}. [${item.kind}] on line ${item.line}:`);
        console.log(`   "${item.text}"`);
        console.log('');
    });

    console.log('\n========== THESE WILL BECOME ==========\n');
    console.log('1. Keys will be generated (e.g., CONFIG_COMPONENT_ARE_YOU_SURE)');
    console.log('2. Code will be replaced: confirm(\'Are you sure...\')');
    console.log('   →  confirm(this.translate.instant(\'CONFIG_COMPONENT_ARE_YOU_SURE\'))');
    console.log('3. JSON will have: {"CONFIG_COMPONENT_ARE_YOU_SURE": "Are you sure you want to delete this configuration?"}');
}

testConfirmExtraction().catch(console.error);
