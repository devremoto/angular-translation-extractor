const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'loader-generator.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Update filter logic - catch all occurrences of the filter predicate
// We target exactly matching the existing code logic used in both places
content = content.replace(
    /!translations\[key\]/g,
    'isForce || !translations[key]'
);

// Update logs - anchor on the parallel log which appears in both templates
// The source file has literal \n inside strings, which are represented as \\n
const parallelLogSnippet = 'console.log("🚀 Parallel mode - translate up to 5 languages at once\\\\n");';
const forceLogSnippet = '  if (isForce) console.log("💪 Force mode - overwriting existing translations\\\\n");';

// Check if we find the snippet
if (content.indexOf(parallelLogSnippet) === -1) {
    console.error("Could not find parallel log snippet!");
    console.error("Snippet looked for:", parallelLogSnippet);
} else {
    // Append the force log line after the parallel log line
    // We expect 2 replacements
    const parts = content.split(parallelLogSnippet);
    console.log(`Found ${parts.length - 1} occurrences of parallel log.`);
    content = parts.join(parallelLogSnippet + '\n' + forceLogSnippet);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated loader-generator.ts v2');
