import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { SHARD_PREFIX_LENGTH } from "./output.js";
import type {
  ChangeManifest,
  ChangeSearchIndex,
  FacilityChangeRecord,
  FacilityChangeShard,
} from "./types.js";
import { maxIsoDate } from "./utils/date.js";

function stableJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export async function writeRecentData(
  records: FacilityChangeRecord[],
  manifest: ChangeManifest,
  outputDirectory: string,
): Promise<void> {
  const output = path.resolve(outputDirectory);
  const workspace = path.resolve(process.cwd());
  const relative = path.relative(workspace, output);
  if (
    output === workspace ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`出力先はワークスペース配下にしてください: ${output}`);
  }

  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(path.join(parent, ".facility-changes-"));
  const facilitiesDirectory = path.join(temporary, "facilities");
  await mkdir(facilitiesDirectory, { recursive: true });

  const shards = new Map<
    string,
    FacilityChangeShard["facilities"]
  >();
  for (const record of records) {
    const prefix = record.medicalInstitutionCode.slice(0, SHARD_PREFIX_LENGTH);
    const facilities = shards.get(prefix) ?? {};
    facilities[record.medicalInstitutionCode] = {
      name: record.name,
      address: record.address,
      category: record.category,
      events: record.events,
    };
    shards.set(prefix, facilities);
  }

  await Promise.all(
    [...shards.entries()].map(async ([prefix, facilities]) => {
      const latestAsOf =
        maxIsoDate(
          Object.values(facilities).flatMap((facility) =>
            facility.events.map((event) => event.publishedAt)
          ),
        ) ?? manifest.latestAsOf;
      const shard: FacilityChangeShard = {
        schemaVersion: 1,
        baseAsOf: manifest.baseAsOf,
        latestAsOf,
        prefix,
        facilities,
      };
      await writeFile(
        path.join(facilitiesDirectory, `${prefix}.json`),
        stableJson(shard),
        "utf8",
      );
    }),
  );

  const search: ChangeSearchIndex = {
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    baseAsOf: manifest.baseAsOf,
    latestAsOf: manifest.latestAsOf,
    facilities: records.map((record) => [
      record.medicalInstitutionCode,
      record.name,
      record.address,
      record.category,
    ]),
  };
  await writeFile(
    path.join(temporary, "manifest.json"),
    stableJson(manifest),
    "utf8",
  );
  await writeFile(
    path.join(temporary, "search.json"),
    stableJson(search),
    "utf8",
  );

  const backup = `${output}.previous`;
  await rm(backup, { recursive: true, force: true });
  try {
    await rename(output, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  try {
    await rename(temporary, output);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    try {
      await rename(backup, output);
    } catch {
      // 初回生成時は復元対象がない。
    }
    throw error;
  }
}
