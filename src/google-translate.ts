import * as fs from "node:fs/promises";
import axios from "axios";

// Maximum number of concurrent translation requests
const MAX_CONCURRENT_REQUESTS = 15;

async function translateText(text: string, targetLang: string, sourceLang?: string): Promise<string> {
    // Helper to extract main language (e.g. "en" from "en-US")
    // const toMain = (lang: string) => lang.split("-")[0].toLowerCase();

    // Use specific language code for API calls to support variants like pt-BR, zh-CN
    const apiTargetLang = targetLang;
    const apiSourceLang = sourceLang || "auto";

    async function doTranslate(target: string): Promise<string> {
        // Using Google Translate free API via axios
        const encoded = encodeURIComponent(text);
        const url = `https://translate.google.com/translate_a/single?client=gtx&sl=${apiSourceLang}&tl=${target}&dt=t&q=${encoded}`;

        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        });

        // Extract translation from response
        // response.data[0] is an array of [translated, original, ...]
        if (response.data && Array.isArray(response.data) && response.data[0] && Array.isArray(response.data[0])) {
            // response.data[0][0] is [translated_text, original_text, null, null, ...]
            const translationPairs = response.data[0];
            let translated = "";

            for (const pair of translationPairs) {
                if (Array.isArray(pair) && pair[0]) {
                    translated += pair[0];
                }
            }

            if (translated.length === 0 || translated === text) {
                throw new Error(`No translation received`);
            }

            return translated;
        }
        throw new Error(`Invalid response format`);
    }

    try {
        // Use the API-compatible main language code
        return await doTranslate(apiTargetLang);
    } catch (err: any) {
        // If it still fails, the text will be returned unchanged
        // This is better than throwing and losing the key entirely
        return text;
    }
}

// Helper function to process items in parallel with concurrency limit
async function parallelLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];

    for (const [index, item] of items.entries()) {
        const promise = fn(item).then((result) => {
            results[index] = result;
        });
        executing.push(promise);

        if (executing.length >= limit) {
            await Promise.race(executing);
            executing.splice(
                executing.findIndex((p) => (p as any).completed),
                1
            );
        }

        promise.then(() => {
            (promise as any).completed = true;
        });
    }

    await Promise.all(executing);
    return results;
}

export async function translateJsonFile(opts: {
    inputFile: string;
    outputDir: string;
    targetLang: string;
    sourceLang?: string;
    outputFileName?: string;
    onProgress: (msg: string) => void;
}): Promise<void> {
    const { inputFile, outputDir, targetLang, sourceLang, outputFileName, onProgress } = opts;

    try {
        const rawData = await fs.readFile(inputFile, "utf8");
        const parsedData = JSON.parse(rawData);
        // Deep copy to avoid modifying shared object references
        const data = JSON.parse(JSON.stringify(parsedData));

        onProgress(`[google-translate] Translating to ${targetLang}...`);

        // Load existing translations if they exist
        const fileName = outputFileName || targetLang;
        const outputFile = `${outputDir}/${fileName}.json`;
        let existingTranslations: any = {};
        try {
            const existingData = await fs.readFile(outputFile, "utf8");
            existingTranslations = JSON.parse(existingData);
            onProgress(`[google-translate] Loaded existing translations from ${outputFile}`);
        } catch (err) {
            onProgress(`[google-translate] No existing translations found, will create new file`);
        }

        // Step 1: Collect all translatable strings with their paths
        interface TranslationEntry {
            path: string[];
            value: string;
        }

        const entries: TranslationEntry[] = [];

        function collectStrings(obj: any, path: string[] = []): void {
            for (const [key, value] of Object.entries(obj)) {
                const currentPath = [...path, key];
                if (typeof value === "string" && value.trim().length > 0) {
                    entries.push({ path: currentPath, value });
                } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                    collectStrings(value, currentPath);
                }
            }
        }

        collectStrings(data);
        onProgress(`[google-translate] Found ${entries.length} strings in base file`);

        // Filter entries - only translate new or blank properties (merge mode)
        const entriesToTranslate = entries.filter(entry => {
            // Navigate to the same path in existing translations
            let existingValue: any = existingTranslations;
            for (const key of entry.path) {
                if (existingValue && typeof existingValue === 'object') {
                    existingValue = existingValue[key];
                } else {
                    existingValue = undefined;
                    break;
                }
            }

            // Translate if: property doesn't exist OR is blank
            const shouldTranslate = !existingValue || (typeof existingValue === 'string' && existingValue.trim() === '');
            return shouldTranslate;
        });

        onProgress(`[google-translate] ${entriesToTranslate.length} properties need translation (new or blank)`);
        onProgress(`[google-translate] ${entries.length - entriesToTranslate.length} properties already translated (preserved)`);

        if (entriesToTranslate.length === 0) {
            onProgress(`[google-translate] ✓ All properties already translated, nothing to do`);
            return;
        } else {
            onProgress(`[google-translate] First 3 strings to translate: ${entriesToTranslate.slice(0, 3).map(e => `${e.path.join('.')}="${e.value.substring(0, 30)}"`).join(', ')}`);
        }

        // Step 2: Translate only filtered strings in parallel with concurrency limit
        const startTime = Date.now();
        let completed = 0;

        onProgress(`[google-translate] Starting translation: source lang="${sourceLang}" (main: "${sourceLang?.split('-')[0]}"), target lang="${targetLang}"`);

        const translatedValues = await parallelLimit(
            entriesToTranslate,
            MAX_CONCURRENT_REQUESTS,
            async (entry) => {
                try {
                    const result = await translateText(entry.value, targetLang, sourceLang);
                    completed++;

                    // Log first few translations to verify they're working
                    if (completed <= 3 || completed === entriesToTranslate.length) {
                        const isSame = result === entry.value;
                        const marker = isSame ? "❌" : "✓";
                        onProgress(
                            `[google-translate] ${marker} #${completed}: "${entry.value.substring(0, 25)}" -> "${result.substring(0, 25)}"`
                        );
                    } else if (completed % 10 === 0) {
                        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                        onProgress(
                            `[google-translate] Progress: ${completed}/${entriesToTranslate.length} (${elapsed}s)`
                        );
                    }
                    return result;
                } catch (err) {
                    onProgress(`[google-translate] Failed to translate "${entry.value}": ${err}`);
                    return entry.value; // Return original on error
                }
            }
        );

        // Step 3: Merge existing translations with new translations
        onProgress(`[google-translate] Merging ${translatedValues.length} new translations with existing data...`);

        // Start with existing translations or empty object
        const mergedData = JSON.parse(JSON.stringify(existingTranslations));

        // Apply new translations only to filtered entries
        let appliedCount = 0;

        for (let i = 0; i < entriesToTranslate.length; i++) {
            const entry = entriesToTranslate[i];
            const translatedValue = translatedValues[i];

            // Check if translation actually changed
            const isDifferent = translatedValue !== entry.value;
            if (isDifferent) {
                appliedCount++;
            }

            // Navigate to the correct location in the merged object, creating structure as needed
            let target: any = mergedData;
            for (let j = 0; j < entry.path.length - 1; j++) {
                const key = entry.path[j];
                if (!target[key] || typeof target[key] !== 'object') {
                    target[key] = {};
                }
                target = target[key];
            }

            const lastKey = entry.path[entry.path.length - 1];
            target[lastKey] = translatedValue;
        }

        onProgress(`[google-translate] Applied ${appliedCount} out of ${entriesToTranslate.length} new translations (${entriesToTranslate.length - appliedCount} unchanged)`);

        if (appliedCount === 0) {
            onProgress(`[google-translate] WARNING: No translations were different from original! Sample: "${entriesToTranslate[0]?.value}" is still same after translation.`);
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        onProgress(`[google-translate] ✓ Completed ${entriesToTranslate.length} translations in ${totalTime}s`);

        await fs.writeFile(outputFile, JSON.stringify(mergedData, null, 2) + "\n", "utf8");
        onProgress(`[google-translate] Saved: ${outputFile}`);
    } catch (err: any) {
        throw new Error(`Google Translate error: ${err.message}`);
    }
}
