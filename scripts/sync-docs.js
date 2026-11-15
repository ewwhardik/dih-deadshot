/**
 * Generates docs/features-data.js directly from src/data/* so the GitHub Pages
 * site always stays synchronized with the actual client catalog and version.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const version = fs.readFileSync(path.join(root, "version.txt"), "utf8").trim();
const { FEATURE_CATEGORIES, FEATURE_REGISTRY } = require(path.join(root, "src/data/featureRegistry"));
const { WEAPONS, OFFICIAL_SKINS } = require(path.join(root, "src/data/deadshotCatalog"));

const payload = {
  version,
  generatedAt: new Date().toISOString(),
  featureCount: FEATURE_REGISTRY.length,
  categories: FEATURE_CATEGORIES,
  features: FEATURE_REGISTRY,
  weapons: Object.values(WEAPONS).map((w) => ({
    id: w.id,
    name: w.name,
    shortName: w.shortName,
    texture: w.texture,
    model: w.model,
  })),
  officialSkins: OFFICIAL_SKINS.slice(0, 26),
};

const outPath = path.join(root, "docs", "features-data.js");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  `// Synchronized catalog bundle for Dih Client v${version} by ewwhardik.\nwindow.DIH_DOCS_DATA = ${JSON.stringify(payload, null, 2)};\n`,
  "utf8"
);
console.log(`Synced docs/features-data.js (${payload.featureCount} features, v${version})`);
