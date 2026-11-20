import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("../", import.meta.url);
const MAX_LINES = 800;
const SOURCE_EXTENSION = /\.(?:[cm]?js|[cm]?ts|[jt]sx|css|scss|sass|less|html?|ps1|psm1|sh|bash|bat|cmd|py|sql|jsonc|ya?ml|toml)$/i;
const JSON_CONFIGS = new Set(["package.json", "extension/manifest.json"]);

function physicalLineCount(source) {
  if (!source) return 0;
  return source.split(/\r\n|\n|\r/).length - Number(/[\r\n]$/.test(source));
}

test("authored source files stay within the 800 physical line budget", () => {
  // Include both tracked files and new source that would be committed. Ignore
  // docs, data/locale JSON, lockfiles and generated or vendored output.
  const paths = new Set(execFileSync(
    "git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: ROOT, encoding: "utf8", windowsHide: true },
  ).split("\0").filter(Boolean));

  const oversized = [];
  for (const path of paths) {
    if (!SOURCE_EXTENSION.test(path) && !JSON_CONFIGS.has(path)) continue;
    const file = new URL(path.split("/").map(encodeURIComponent).join("/"), ROOT);
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) continue; // Tracked files removed from the working tree.
    assert.ok(stat.isFile(), `Expected regular source file: ${path}`);
    const lines = physicalLineCount(readFileSync(file, "utf8"));
    if (lines > MAX_LINES) oversized.push(`${path}: ${lines} lines`);
  }
  assert.deepEqual(oversized, [], `Split files longer than ${MAX_LINES} physical lines`);
});
