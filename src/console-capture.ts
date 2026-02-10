import * as vscode from "vscode";

/**
 * Redirects console.log and console.error to a VS Code OutputChannel
 */
export function captureConsoleLogs(output: vscode.OutputChannel) {
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args: unknown[]) => {
        const message = args.map((arg) =>
            typeof arg === "string" ? arg : JSON.stringify(arg)
        ).join(" ");
        output.appendLine(message);
        originalLog(...args);
    };

    console.error = (...args: unknown[]) => {
        const message = args.map((arg) =>
            typeof arg === "string" ? arg : JSON.stringify(arg)
        ).join(" ");
        output.appendLine(`ERROR: ${message}`);
        originalError(...args);
    };

    return () => {
        console.log = originalLog;
        console.error = originalError;
    };
}
