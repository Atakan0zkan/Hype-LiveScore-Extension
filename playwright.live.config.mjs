import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Use the installed, compatible Edge build for genuine production requests on
// Windows: bundled headless Chromium can be rejected by the Worker origin policy.
if(process.platform==="win32" && !process.env.E2E_BROWSER_PATH){
  const edge=[process.env["ProgramFiles(x86)"],process.env.ProgramFiles].filter(Boolean)
    .map(root=>join(root,"Microsoft","Edge","Application","msedge.exe")).find(existsSync);
  if(edge)process.env.E2E_BROWSER_PATH=edge;
}

export default defineConfig({
  testDir:"tests/live-e2e",testMatch:"**/*.spec.js",timeout:90000,globalTimeout:5*60*1000,
  fullyParallel:false,workers:1,retries:0,forbidOnly:true,
  outputDir:"test-results/live-browser",
  reporter:[["line"],["html",{open:"never",outputFolder:"test-results/live-browser-report"}],["json",{outputFile:"test-results/live-browser-results.json"}]],
});
