import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import {
  premiumPublisherProfiles,
  type PremiumPublisherId
} from "../premium-publishers";

const publisherId = process.argv[2] as PremiumPublisherId | undefined;
if (!publisherId || !(publisherId in premiumPublisherProfiles)) {
  throw new Error(
    "Usage: npm run premium:capture-session --workspace @market-themes/workers -- wsj|nyt|wapo|ft|bloomberg"
  );
}

const profile = premiumPublisherProfiles[publisherId];
const authDirectory = new URL("../../../.auth/", import.meta.url);
await mkdir(authDirectory, { recursive: true });
const jsonPath = new URL(`${publisherId}.storage-state.json`, authDirectory);
const encodedPath = new URL(`${publisherId}.storage-state.b64`, authDirectory);
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
const prompt = createInterface({ input, output });

try {
  await page.goto(profile.loginUrl, { waitUntil: "domcontentloaded" });
  await prompt.question(
    `Log in to ${profile.name} in the browser. After confirming a subscriber article opens fully, press Enter here.`
  );
  const state = await context.storageState();
  const json = JSON.stringify(state);
  await writeFile(jsonPath, `${json}\n`, { mode: 0o600 });
  await writeFile(encodedPath, Buffer.from(json).toString("base64"), { mode: 0o600 });
  console.log(`Session captured for ${profile.name}.`);
  console.log(`Add the contents of ${encodedPath.pathname} to Render secret ${profile.sessionEnvKey}.`);
  console.log("Do not commit, paste into chat, or share either session file.");
} finally {
  prompt.close();
  await browser.close();
}
