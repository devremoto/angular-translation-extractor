import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ensureDir } from "./utils";

const execAsync = promisify(exec);

export async function updateEnvironment(opts: {
    workspaceRoot: string;
    srcDir: string;
    enableTransalationCache: boolean;
}): Promise<boolean> {
    const envDir = path.join(opts.workspaceRoot, opts.srcDir, "environments");

    // Ensure directory exists
    await ensureDir(envDir);

    let envFiles: string[] = [];
    try {
        const files = await fs.readdir(envDir);
        // Match environment.ts, environment.prod.ts, environment.development.ts, etc.
        envFiles = files.filter(f => f.startsWith("environment") && f.endsWith(".ts"));
    } catch (error) {
        console.warn(`[updateEnvironment] Could not list directory ${envDir}:`, error);
    }

    // If no environments found, try running the Angular schematic
    if (envFiles.length === 0) {
        try {
            console.log("[updateEnvironment] No environment files found. Running 'ng generate environments'...");
            // Try to use local ng/npx to generate environments
            // This updates angular.json automatically
            await execAsync("npx ng generate environments", { cwd: opts.workspaceRoot });

            // Re-scan directory to find the newly created files
            const files = await fs.readdir(envDir);
            envFiles = files.filter(f => f.startsWith("environment") && f.endsWith(".ts"));
        } catch (err) {
            console.warn(`[updateEnvironment] 'ng generate environments' failed or skipped: ${err}`);
        }
    }

    // If no environment files exist (schematic failed), we'll create a default one
    if (envFiles.length === 0) {
        envFiles.push("environment.ts");
    }

    let anyUpdated = false;

    for (const file of envFiles) {
        const filePath = path.join(envDir, file);
        let content = "";
        let exists = false;

        try {
            content = await fs.readFile(filePath, "utf8");
            exists = true;
        } catch {
            // File doesn't exist. If it's the one we decided to create (environment.ts), fill it with default content.
            // If it's another file in the list, it implies it was deleted between readdir and readFile?
            if (file === "environment.ts") {
                content = `export const environment = {\n  production: false\n};\n`;
            } else {
                continue;
            }
        }

        let newContent = content;
        // Check if enableTransalationCache is already defined
        if (content.includes("enableTransalationCache")) {
            // Update existing value
            // Regex matches "enableTransalationCache: true", "enableTransalationCache: false"
            // We use a broader regex to capture current value and replace it
            const replaceRegex = /(enableTransalationCache\s*:\s*)(?:true|false)/g;
            if (replaceRegex.test(content)) {
                // Check if current value is different
                const currentValMatch = content.match(replaceRegex);
                // If we find it, let's just replace it to be sure
                newContent = content.replace(replaceRegex, `$1${opts.enableTransalationCache}`);
            }
        } else {
            // Add enableTransalationCache property if missing
            // Regex matches "export const environment = {" or "export const environment: Environment = {" etc.
            const regex = /(export\s+const\s+environment\s*(?::\s*[\w<>[\]]+\s*)?=\s*\{)/;

            if (regex.test(content)) {
                newContent = content.replace(regex, `$1\n  enableTransalationCache: ${opts.enableTransalationCache},`);
            } else {
                if (!exists && file === "environment.ts") {
                    // Fallback for new file if regex failed for some reason
                    // But strictly, we should have matched above.
                }
            }
        }

        if (newContent !== content || (!exists && file === "environment.ts")) {
            await fs.writeFile(filePath, newContent, "utf8");
            anyUpdated = true;
            console.log(`[updateEnvironment] Updated ${file} with enableTransalationCache=${opts.enableTransalationCache}`);
        }
    }

    return anyUpdated;
}
