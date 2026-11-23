import assert from "node:assert/strict";
import { test } from "node:test";
import { browserLaunchOptions } from "./browser/unpacked-extension.mjs";

test("extension browser runs in bundled Chromium without opening a window by default", () => {
  assert.deepEqual(browserLaunchOptions({}), { channel: "chromium", headless: true });
});

test("an explicitly selected browser executable still runs without opening a window", () => {
  const executablePath = "C:/Test Chromium/chrome.exe";
  assert.deepEqual(browserLaunchOptions({ E2E_BROWSER_PATH: executablePath }), { executablePath, headless: true });
});

test("Playwright inspector mode cannot silently open a visible test browser", () => {
  assert.throws(() => browserLaunchOptions({ PWDEBUG: "1" }), /without PWDEBUG or --debug/);
});
