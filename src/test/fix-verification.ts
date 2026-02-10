import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { translateJsonFile as googleTranslate } from '../google-translate';
import { translateJsonFile as libreTranslate } from '../libretranslate';
import { getGoogleTranslateScript, getLibretranslateScript } from '../loader-generator';

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

    // --- Test 2: LibreTranslate Source Param ---
    console.log("\nTest 2: LibreTranslate receives sourceLang parameter");
    let libreBody: Record<string, unknown> = {};

    // Mock axios.post
    const originalPost = axios.post;
    (axios.post as unknown) = async (url: string, body: Record<string, unknown>) => {
        libreBody = body;
        return { data: { translatedText: "Translated Value" } };
    };

    try {
        await libreTranslate({
            inputFile: tempFile,
            outputDir: path.dirname(tempFile),
            targetLang: 'it',
            sourceLang: 'en', // Explicit source
            onProgress: () => { }
        });

        if (libreBody.source === 'en') {
            console.log("✅ LibreTranslate body contains source='en'");
        } else {
            console.error("❌ LibreTranslate body MISSING source='en'. Got: ", libreBody);
            failures++;
        }
    } catch (e) {
        console.error("❌ LibreTranslate test failed with error:", e);
        failures++;
    } finally {
        (axios as any).post = originalPost;
        // Cleanup
        try { await fs.unlink(tempFile); } catch { /* no-op */ }
        try { await fs.unlink(path.resolve(__dirname, 'pt.json')); } catch { /* no-op */ }
        try { await fs.unlink(path.resolve(__dirname, 'it.json')); } catch { /* no-op */ }
    }

    // --- Test 3: Generated Google Script Content ---
    console.log("\nTest 3: Generated Google Script uses effective base lang");
    const googleScript = getGoogleTranslateScript("src/assets/i18n", "en-US");

    // Check if it uses split logic for source
    // Expect: sl: getMainLang(EFFECTIVE_BASE_LANG) || "auto"
    if (googleScript.includes('sl: getMainLang(EFFECTIVE_BASE_LANG) || "auto"')) {
        console.log("✅ Google Script template contains correct source lang logic");
    } else {
        console.error("❌ Google Script template logic incorrect.");
        console.log("Expected: sl: getMainLang(EFFECTIVE_BASE_LANG) || \"auto\"");
        failures++;
    }

    // --- Test 4: Generated LibreScript Content ---
    console.log("\nTest 4: Generated LibreTranslate Script uses effective base lang");
    const libreScript = getLibretranslateScript("src/assets/i18n", "en-US");

    // Expect: source: getMainLang(EFFECTIVE_BASE_LANG) || "auto"
    if (libreScript.includes('source: getMainLang(EFFECTIVE_BASE_LANG) || "auto"')) {
        console.log("✅ LibreTranslate Script template contains correct source lang logic");
    } else {
        console.error("❌ LibreTranslate Script template logic incorrect.");
        console.log("Expected: source: getMainLang(EFFECTIVE_BASE_LANG) || \"auto\"");
        failures++;
    }

    console.log(`\nTests completed. ${failures} failures.`);
    process.exit(failures > 0 ? 1 : 0);
}

runTests();