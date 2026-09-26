import { readFile } from "node:fs/promises";
import { createIdentityBootstrapDryRun } from "./services/identityBootstrapDryRun";

export interface IdentityBootstrapDryRunCliDependencies {
  readTextFile(path: string): Promise<string>;
  writeOutput(value: string): void;
}

export async function runIdentityBootstrapDryRunCli(
  args: string[],
  dependencies: IdentityBootstrapDryRunCliDependencies
): Promise<void> {
  if (args.length !== 2) {
    throw new Error(
      "Usage: identityBootstrapDryRunCli <pb-evidence.json> <verified-at>"
    );
  }

  const [pbEvidencePath, verifiedAt] = args;
  const pbText = await dependencies.readTextFile(pbEvidencePath);

  let pbEvidence: unknown;

  try {
    pbEvidence = JSON.parse(pbText);
  } catch {
    throw new Error("PB evidence file is not valid JSON");
  }

  const report = createIdentityBootstrapDryRun(
    pbEvidence,
    verifiedAt
  );

  dependencies.writeOutput(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  runIdentityBootstrapDryRunCli(process.argv.slice(2), {
    readTextFile: (path) => readFile(path, "utf8"),
    writeOutput: (value) => process.stdout.write(value),
  }).catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown dry-run failure";

    process.stderr.write(`IDENTITY_BOOTSTRAP_DRY_RUN_FAILED: ${message}\n`);
    process.exitCode = 1;
  });
}
