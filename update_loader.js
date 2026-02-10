const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'loader-generator.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update Google Main Log
const googleLogOld = `  if (isFast) console.log("⚡ Fast mode - no delays between requests\\\\n");
  if (isParallel) console.log("🚀 Parallel mode - translate up to 5 languages at once\\\\n");`;
const googleLogNew = `  if (isFast) console.log("⚡ Fast mode - no delays between requests\\\\n");
  if (isParallel) console.log("🚀 Parallel mode - translate up to 5 languages at once\\\\n");
  if (isForce) console.log("💪 Force mode - overwriting existing translations\\\\n");`;

// Note: We use replace (first occurrence) or ensure we target the right one?
// Actually, the log block appears in both functions identically?
// Let's check read_file output.
// Google: Line 103, 104.
// Libre: Line 286, 287 (implied).
// They are identical. So we can use replaceAll to update *both* logs at once!

content = content.split(googleLogOld).join(googleLogNew);

// 2. Update keysToTranslate Logic (replaceAll)
const filterOld_v1 = `      const keysToTranslate = Object.entries(content).filter(
        ([key, value]) => !translations[key]
      );`;
const filterOld_v2 = `      const keysToTranslate = Object.entries(content).filter(
        ([key, value]) => isForce || !translations[key]
      );`;
const filterNew = `      const keysToTranslate = Object.entries(content).filter(
        ([key, value]) => isForce || !translations[key] || (typeof translations[key] === 'string' && translations[key].trim() === '')
      );`;

// Replace old versions with new one (handles both old-v1 and old-v2)
content = content.split(filterOld_v1).join(filterNew);
content = content.split(filterOld_v2).join(filterNew);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated loader-generator.ts');
