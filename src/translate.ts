import * as cp from "node:child_process";

export async function runTranslateCommand(opts: {
  cwd: string;
  command: string;
  args: string[];
  onStdout: (s: string) => void;
  onStderr: (s: string) => void;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = cp.spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    proc.stdout.on("data", d => opts.onStdout(String(d)));
    proc.stderr.on("data", d => opts.onStderr(String(d)));

    proc.on("error", reject);
    proc.on("close", code => resolve(code ?? 0));
  });
}
