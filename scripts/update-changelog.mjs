import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const packageJsonPath = path.join(repoRoot, "package.json");

function todayIsoDate() {
  return new Date().toISOString().split("T")[0];
}

function ensureUnreleasedSection(source) {
  const unreleasedHeader = "## [Unreleased]";
  const index = source.indexOf(unreleasedHeader);
  if (index === -1) {
    throw new Error("CHANGELOG.md must contain a '## [Unreleased]' section.");
  }
  return { index, unreleasedHeader };
}

function hasVersionSection(source, version) {
  return source.includes(`## [${version}]`);
}

function updateLinks(source, version) {
  const unreleasedRegex = /^\[Unreleased\]:\s*(.+)$/m;
  const unreleasedMatch = source.match(unreleasedRegex);
  if (!unreleasedMatch) {
    return source;
  }

  const unreleasedUrl = unreleasedMatch[1].trim();
  const compareMatch = unreleasedUrl.match(/compare\/([^.]*)\.\.\.HEAD$/);
  const previousRef = compareMatch?.[1] ?? "main";
  const nextUnreleasedUrl = unreleasedUrl.replace(/compare\/[^.]*\.\.\.HEAD$/, `compare/v${version}...HEAD`);

  let updated = source.replace(unreleasedRegex, `[Unreleased]: ${nextUnreleasedUrl}`);

  const versionLinkRegex = new RegExp(`^\\[${version}\\]:\\s*`, "m");
  if (!versionLinkRegex.test(updated)) {
    const newVersionLink = `[${version}]: https://github.com/wictorwilen/cocogen/compare/${previousRef}...v${version}`;
    updated = updated.replace(/^\[Unreleased\]:.*$/m, `$&\n${newVersionLink}`);
  }

  return updated;
}

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const version = packageJson.version;
if (!version) {
  throw new Error("package.json must contain a version.");
}

const changelog = await readFile(changelogPath, "utf8");
const { index, unreleasedHeader } = ensureUnreleasedSection(changelog);

if (hasVersionSection(changelog, version)) {
  throw new Error(`CHANGELOG.md already contains a section for version ${version}.`);
}

const date = todayIsoDate();
const releaseHeader = `## [${version}] - ${date}`;
const updatedChangelog =
  changelog.slice(0, index) +
  `${unreleasedHeader}\n\n${releaseHeader}` +
  changelog.slice(index + unreleasedHeader.length);

const finalChangelog = updateLinks(updatedChangelog, version);

await writeFile(changelogPath, finalChangelog, "utf8");
