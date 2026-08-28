import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type Page } from "playwright";
import { listPublicationFeeds } from "@market-themes/db";

const headless = process.argv.includes("--headless");
const extraUrls = process.argv
  .slice(2)
  .filter((value) => value !== "--headless" && /^https:\/\//i.test(value));
const authDirectory = new URL("../../../.auth/", import.meta.url);
await mkdir(authDirectory, { recursive: true });
const jsonPath = new URL("substack.storage-state.json", authDirectory);
const encodedPath = new URL("substack.storage-state.b64", authDirectory);

const browser = await chromium.launch({ headless });
const context = await browser.newContext();
const page = await context.newPage();
const prompt = headless ? null : createInterface({ input, output });

try {
  await page.goto("https://substack.com/sign-in", { waitUntil: "domcontentloaded" });
  const automated = await automateLogin(page);
  if (!automated) {
    if (headless) {
      throw new Error(
        "Headless Substack login failed. Capture the session interactively or complete 2FA/captcha in a visible browser."
      );
    }
    console.log(
      "Automation could not finish login. Complete sign-in, captcha, or 2FA in the browser."
    );
    await page.waitForURL((url) => !url.toString().includes("sign-in"), {
      timeout: 5 * 60_000
    });
  }

  const publicationUrls = await publicationHomepages(extraUrls);
  for (const homepage of publicationUrls) {
    await page.goto(homepage, { waitUntil: "domcontentloaded" });
  }

  const state = await context.storageState();
  const json = JSON.stringify(state);
  await writeFile(jsonPath, `${json}\n`, { mode: 0o600 });
  await writeFile(encodedPath, Buffer.from(json).toString("base64"), { mode: 0o600 });
  console.log("Substack session captured.");
  console.log(`Add the contents of ${encodedPath.pathname} to Render secret SUBSTACK_STORAGE_STATE_B64.`);
  console.log("Do not commit, paste into chat, or share either session file.");
  if (prompt) {
    await prompt.question("Press Enter to close the browser.");
  }
} finally {
  prompt?.close();
  await browser.close();
}

async function automateLogin(page: Page) {
  const email = process.env.SUBSTACK_EMAIL?.trim();
  const password = process.env.SUBSTACK_PASSWORD?.trim();
  if (!email || !password) return false;

  try {
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    const continueButton = page.getByRole("button", { name: /continue|sign in/i }).first();
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click();
    } else {
      await page.locator('button[type="submit"]').first().click();
    }

    const passwordChoice = page.getByRole("button", { name: /sign in with password/i });
    if (await passwordChoice.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await passwordChoice.click();
    }

    await page.locator('input[type="password"]').first().fill(password);
    const submit = page.getByRole("button", { name: /sign in|log in|continue/i }).first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
    } else {
      await page.locator('button[type="submit"]').first().click();
    }

    await page.waitForURL((url) => !url.toString().includes("sign-in"), { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

async function publicationHomepages(explicit: string[]) {
  const urls = [...explicit];
  if (process.env.DATABASE_URL) {
    const feeds = await listPublicationFeeds({ enabledOnly: true });
    for (const feed of feeds.filter((item) => item.platform === "substack")) {
      urls.push(feed.homepageUrl);
    }
  }
  return [...new Set(urls.map((value) => value.replace(/\/+$/, "")))];
}
