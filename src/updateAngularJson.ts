import * as fs from "fs/promises";
import * as path from "path";

export interface UpdateAngularJsonOptions {
    workspaceRoot: string;
    outputRoot: string;
}

export async function updateAngularJson(opts: UpdateAngularJsonOptions): Promise<void> {
    const { workspaceRoot, outputRoot } = opts;

    const angularJsonPath = path.join(workspaceRoot, "angular.json");

    // Check if angular.json exists
    try {
        await fs.stat(angularJsonPath);
    } catch {
        // No angular.json, skip update
        return;
    }

    // Read and parse angular.json
    const content = await fs.readFile(angularJsonPath, "utf8");
    const angularJson = JSON.parse(content);

    // Find all projects
    const projects = angularJson.projects || {};
    let modified = false;

    for (const projectName of Object.keys(projects)) {
        const project = projects[projectName];
        const buildOptions = project?.architect?.build?.options;

        if (!buildOptions) continue;

        // Ensure assets array exists
        if (!Array.isArray(buildOptions.assets)) {
            buildOptions.assets = [];
        }

        // Check if outputRoot is already in assets
        const alreadyExists = buildOptions.assets.some((asset: string | object) => {
            if (typeof asset === "string") {
                return asset === outputRoot || asset.includes("i18n");
            }
            return false;
        });

        if (!alreadyExists) {
            // Add outputRoot to assets
            buildOptions.assets.push(outputRoot);
            modified = true;
        }
    }

    // Write back if modified
    if (modified) {
        const updatedContent = JSON.stringify(angularJson, null, 2) + "\n";
        await fs.writeFile(angularJsonPath, updatedContent, "utf8");
    }
}
