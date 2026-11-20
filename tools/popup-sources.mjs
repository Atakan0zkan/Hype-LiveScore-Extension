import { readFile } from "node:fs/promises";

const POPUP_ROOT = new URL("../extension/", import.meta.url);

// Keep local tooling aligned with the browser's script and cascade order.
export async function readPopupSources() {
  const html = await readFile(new URL("popup.html", POPUP_ROOT), "utf8");
  const readAssets = async (pattern, extension) => {
    const paths = [...html.matchAll(pattern)].map(match => match[1]);
    const local = new RegExp("^(?:[a-z0-9_-]+/)*[a-z0-9_-]+\\." + extension + "$", "i");
    if (!paths.length || paths.some(path => !local.test(path)) || new Set(paths).size !== paths.length) {
      throw new Error("Popup assets must be unique packaged files");
    }
    return Promise.all(paths.map(async path => {
      const url = new URL(path, POPUP_ROOT);
      return { url, source: await readFile(url, "utf8") };
    }));
  };
  const [scripts, styles] = await Promise.all([
    readAssets(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, "js"),
    readAssets(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi, "css"),
  ]);
  return { html, scripts, styles };
}
