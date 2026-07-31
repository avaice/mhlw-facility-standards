import {
  cp,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  CompactFacilityRecord,
  DataManifest,
  FacilityRecord,
  FacilitySearchIndex,
  FacilityShard,
  StandardCatalog,
  StandardRecord,
} from "./types.js";
import { createStandardId } from "./standard.js";
import { maxIsoDate } from "./utils/date.js";
import { uniqueSorted } from "./utils/text.js";

export const SHARD_PREFIX_LENGTH = 4;

function stableJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function assertSafeOutputDirectory(outputDirectory: string): string {
  const resolved = path.resolve(outputDirectory);
  const workspace = path.resolve(process.cwd());
  const relative = path.relative(workspace, resolved);

  if (
    resolved === workspace ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`出力先はワークスペース配下の専用ディレクトリにしてください: ${resolved}`);
  }
  return resolved;
}

export async function writeStaticData(
  records: FacilityRecord[],
  manifest: DataManifest,
  outputDirectory: string,
): Promise<void> {
  const output = assertSafeOutputDirectory(outputDirectory);
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(path.join(parent, ".facility-data-"));
  const facilitiesDirectory = path.join(temporary, "facilities");
  await mkdir(facilitiesDirectory, { recursive: true });
  try {
    await cp(path.join(output, "changes"), path.join(temporary, "changes"), {
      recursive: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  const shards = new Map<
    string,
    {
      asOfDates: string[];
      facilities: Record<string, CompactFacilityRecord>;
    }
  >();
  const catalog: StandardCatalog = {
    schemaVersion: 1,
    standards: {},
  };

  function standardId(standard: StandardRecord): string {
    const id = createStandardId(standard);
    const existing = catalog.standards[id];
    const incoming = {
      abbreviation: standard.abbreviation,
      name: standard.name,
    };
    if (existing && JSON.stringify(existing) !== JSON.stringify(incoming)) {
      throw new Error(`施設基準IDの衝突を検出しました: ${id}`);
    }
    catalog.standards[id] = incoming;
    return id;
  }

  for (const record of records) {
    const prefix = record.medicalInstitutionCode.slice(0, SHARD_PREFIX_LENGTH);
    const shard = shards.get(prefix) ?? {
      asOfDates: [],
      facilities: {},
    };
    shard.asOfDates.push(record.asOf);
    shard.facilities[record.medicalInstitutionCode] = {
      name: record.facility.name,
      address: record.facility.address,
      category: record.category,
      sourceIds: uniqueSorted(record.sources.map((source) => source.bureauId)),
      sourceDocuments: uniqueSorted(
        record.sources.map((source) => source.documentUrl),
      ),
      standards: record.standards.map((standard) => [
        standardId(standard),
        standard.acceptanceNumber,
        standard.effectiveFrom,
      ]),
    };
    shards.set(prefix, shard);
  }

  await Promise.all(
    [...shards.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([prefix, compact]) => {
        const asOf = maxIsoDate(compact.asOfDates);
        if (!asOf) {
          throw new Error(`${prefix}: シャードの基準日がありません`);
        }
        const shard: FacilityShard = {
          schemaVersion: 1,
          asOf,
          prefix,
          facilities: compact.facilities,
        };
        await writeFile(
          path.join(facilitiesDirectory, `${prefix}.json`),
          stableJson(shard),
          "utf8",
        );
      }),
  );
  await writeFile(
    path.join(temporary, "catalog.json"),
    stableJson(catalog),
    "utf8",
  );
  await writeFile(
    path.join(temporary, "manifest.json"),
    stableJson(manifest),
    "utf8",
  );
  const searchIndex: FacilitySearchIndex = {
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    asOf: manifest.asOf,
    facilityCount: records.length,
    facilities: [...records]
      .sort((a, b) =>
        a.medicalInstitutionCode.localeCompare(b.medicalInstitutionCode),
      )
      .map((record) => [
        record.medicalInstitutionCode,
        record.facility.name,
        record.facility.address,
        record.category,
      ]),
  };
  await writeFile(
    path.join(temporary, "search.json"),
    stableJson(searchIndex),
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
      // 元の出力が存在しなかった場合、復元対象はない。
    }
    throw error;
  }
}
