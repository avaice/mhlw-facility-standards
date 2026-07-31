#!/usr/bin/env node
import path from "node:path";
import { updateRecentData } from "./recent.js";
import { discoverAllSources, updateData } from "./update.js";
import { verifyStaticData } from "./verify.js";

interface CliOptions {
  outputDirectory: string;
  minimumFacilityCount: number;
}

function parseOptions(args: string[]): CliOptions {
  let outputDirectory = "public/v1";
  let minimumFacilityCount = 100_000;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--out") {
      outputDirectory = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (argument === "--min-facilities") {
      minimumFacilityCount = Number.parseInt(args[index + 1] ?? "", 10);
      index += 1;
      continue;
    }
    throw new Error(`不明なオプションです: ${argument}`);
  }

  if (!outputDirectory || !Number.isInteger(minimumFacilityCount)) {
    throw new Error("オプションの値が不正です");
  }
  return {
    outputDirectory: path.resolve(outputDirectory),
    minimumFacilityCount,
  };
}

async function main(): Promise<void> {
  const [command = "update", ...args] = process.argv.slice(2);

  if (command === "discover") {
    const documents = await discoverAllSources(undefined, (message) =>
      console.error(message),
    );
    console.log(JSON.stringify(documents, null, 2));
    return;
  }
  if (command === "update-recent") {
    const options = parseOptions(args);
    const result = await updateRecentData({
      outputDirectory: options.outputDirectory,
      onProgress: (message) => console.error(message),
    });
    for (const warning of result.warnings) {
      console.warn(`warning: ${warning}`);
    }
    console.log(JSON.stringify(result.manifest, null, 2));
    return;
  }
  if (command === "verify") {
    const options = parseOptions(args);
    console.log(JSON.stringify(
      await verifyStaticData(options.outputDirectory),
      null,
      2,
    ));
    return;
  }
  if (command !== "update") {
    throw new Error(`不明なコマンドです: ${command}`);
  }

  const options = parseOptions(args);
  const result = await updateData({
    outputDirectory: options.outputDirectory,
    minimumFacilityCount: options.minimumFacilityCount,
    onProgress: (message) => console.error(message),
  });

  for (const warning of result.warnings) {
    console.warn(`warning: ${warning}`);
  }
  console.log(JSON.stringify(result.manifest, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
