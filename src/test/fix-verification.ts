import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { translateJsonFile as googleTranslate } from '../google-translate';

async function runTests() {
    console.log("🧪 Starting verification tests...\n");
    let failures = 0;

    // --- Test 1: Google Translate Source Param ---
    console.log("Test 1: Google Translate receives sourceLang parameter");
    let googleUrl = "";

    // Mock axios.get
    const originalGet = axios.get;
    (axios.get as unknown) = async (url: string) => {
        googleUrl = url;
        return { data: [[["Translated Value"]]] };
    };

    const tempFile = path.resolve(__dirname, 'temp_test.json');
    await fs.writeFile(tempFile, JSON.stringify({ "test": "Hello" }));

    try {
        await googleTranslate({
            inputFile: tempFile,
            outputDir: path.dirname(tempFile),
            targetLang: 'pt',
            sourceLang: 'en', // Explicit source
            onProgress: () => { }
        });

        if (googleUrl.includes('sl=en')) {
            console.log("✅ Google Translate URL contains sl=en");
        } else {
            console.error("❌ Google Translate URL MISSING sl=en. Got: " + googleUrl);
            failures++;
        }
    } catch (e) {
        console.error("❌ Google Translate test failed with error:", e);
        failures++;
    } finally {
        (axios.get as unknown) = originalGet;
    }


    

    console.log(`\nTests completed. ${failures} failures.`);
    process.exit(failures > 0 ? 1 : 0);
}

runTests();