import { readFileSync } from "node:fs";
import path from "node:path";

export function loadManifest(packageDir) {
  return JSON.parse(readFileSync(path.join(path.resolve(packageDir), "manifest.json"), "utf8"));
}

export function compareRollbackCompatibility(previousManifest, candidateManifest) {
  const failures = [];
  const assertSame = (field) => {
    if (JSON.stringify(previousManifest[field]) !== JSON.stringify(candidateManifest[field])) {
      failures.push(`${field} mismatch`);
    }
  };

  assertSame("master_release");
  assertSame("master_sha256");
  assertSame("master_active_markdown_count");
  assertSame("migrations");
  assertSame("public_routes");
  assertSame("services");

  if (previousManifest.version === candidateManifest.version) {
    failures.push("previous and candidate versions must differ");
  }
  if (previousManifest.source_commit === candidateManifest.source_commit) {
    failures.push("previous and candidate source commits must differ");
  }
  if (previousManifest.image?.included !== true || candidateManifest.image?.included !== true) {
    failures.push("both packages must include image artifacts");
  }
  if (previousManifest.runtime_image_env !== undefined && previousManifest.runtime_image_env?.image_id !== previousManifest.image?.id) {
    failures.push("previous runtime image env mismatch");
  }
  if (candidateManifest.runtime_image_env?.image_id !== candidateManifest.image?.id) {
    failures.push("candidate runtime image env mismatch");
  }

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }

  return {
    schemaPrismaUnchanged: true,
    migrationsUnchanged: true,
    publicRoutesUnchanged: true,
    productionComposeTopologyUnchanged: true,
    masterUnchanged: true,
    dataDestructiveMigration: false,
    applicationOnlyRollbackCompatible: true
  };
}
