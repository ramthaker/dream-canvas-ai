#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  fileURLToPath(new URL("../", import.meta.url)),
);

loadDotEnv(path.join(projectRoot, ".env"));

const config = {
  url: env("FLOWPASS_URL", "https://app.flowpass.co/guest/home"),
  primaryText: env(
    "FLOWPASS_PRIMARY_TEXT",
    "Co-working day pass|Coworking day pass|Co-working pass|Coworking pass",
  ),
  fallbackText: env(
    "FLOWPASS_FALLBACK_TEXT",
    "Last-minute day pass|Last minute day pass",
  ),
  fallbackPick: env("FLOWPASS_FALLBACK_PICK", "last").toLowerCase(),
  dateText: env("FLOWPASS_DATE_TEXT", ""),
  confirmBooking: truthy(env("FLOWPASS_CONFIRM_BOOKING", "false")),
  onlyAvailable: truthy(env("FLOWPASS_ONLY_AVAILABLE", "true")),
  allowPaymentAction: truthy(env("FLOWPASS_ALLOW_PAYMENT_ACTION", "false")),
  loginOnly: truthy(env("FLOWPASS_LOGIN_ONLY", "false")),
  nonInteractive: truthy(env("FLOWPASS_NONINTERACTIVE", "false")),
  headless: truthy(env("FLOWPASS_HEADLESS", "false")),
  slowMo: Number(env("FLOWPASS_SLOWMO_MS", "75")),
  profileDir: resolveProjectPath(
    env("FLOWPASS_PROFILE_DIR", ".flowpass-profile"),
  ),
};

const successPattern =
  /booked|booking confirmed|confirmed|reserved|reservation confirmed|success/i;
const finalActionPattern = config.allowPaymentAction
  ? /book now|confirm|reserve now|complete|finish|pay|checkout/i
  : /book now|confirm|reserve now|complete|finish/i;
const progressActionPatterns = [
  /continue/i,
  /next/i,
  /select/i,
  /choose/i,
  /add/i,
];
const bookingActionPatterns = [/book/i, /reserve/i];

class NoSlotError extends Error {
  constructor(message) {
    super(message);
    this.name = "NoSlotError";
  }
}

class LoginRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "LoginRequiredError";
  }
}

const { chromium } = await importPlaywright();

const context = await chromium.launchPersistentContext(config.profileDir, {
  headless: config.headless,
  slowMo: Number.isFinite(config.slowMo) ? config.slowMo : 75,
  viewport: { width: 1280, height: 900 },
});

try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(8000);

  console.log(`Opening ${config.url}`);
  await page.goto(config.url, { waitUntil: "domcontentloaded" });
  await settle(page);
  await pauseForLoginIfNeeded(page);

  if (config.loginOnly) {
    console.log("Login/session check complete.");
    process.exitCode = 0;
  } else {
    await selectDateIfConfigured(page);

    const selected = await selectPreferredBooking(page);
    console.log(`Selected available slot: ${selected.reason}`);

    if (!config.confirmBooking) {
      const actions = await listVisibleActions(page);
      console.log("");
      console.log("Dry run complete. I did not confirm a booking.");
      console.log("Visible action buttons/links now:");
      printActions(actions);
      console.log("");
      console.log(
        'Set FLOWPASS_CONFIRM_BOOKING="true" when you want the script to click booking confirmation buttons.',
      );
      process.exitCode = 0;
    } else {
      await completeBooking(page);
    }
  }
} catch (error) {
  if (error instanceof NoSlotError) {
    console.log(error.message);
    process.exitCode = 2;
  } else if (error instanceof LoginRequiredError) {
    console.error(error.message);
    process.exitCode = 3;
  } else {
    throw error;
  }
} finally {
  await context.close();
}

async function selectDateIfConfigured(page) {
  if (!config.dateText) {
    return;
  }

  try {
    console.log(`Selecting date/day: ${config.dateText}`);
    await selectVisibleText(page, config.dateText, "first");
    await settle(page);
  } catch (error) {
    throw new NoSlotError(
      `No matching date/day was visible for "${config.dateText}". ${error.message}`,
    );
  }
}

async function selectPreferredBooking(page) {
  const errors = [];

  try {
    await selectVisibleText(page, config.primaryText, "first", {
      requireAvailable: config.onlyAvailable,
    });
    return { reason: `primary option "${config.primaryText}"` };
  } catch (primaryError) {
    errors.push(`primary: ${primaryError.message}`);
    console.log(`Primary option not selected: ${primaryError.message}`);
  }

  try {
    await selectVisibleText(
      page,
      config.fallbackText,
      config.fallbackPick === "first" ? "first" : "last",
      {
        requireAvailable: config.onlyAvailable,
      },
    );
    return {
      reason: `fallback option "${config.fallbackText}" (${config.fallbackPick})`,
    };
  } catch (fallbackError) {
    errors.push(`fallback: ${fallbackError.message}`);
  }

  throw new NoSlotError(
    `No available Flowpass slot found. ${errors.join(" ")}`,
  );
}

async function completeBooking(page) {
  console.log(
    "Automatic click mode enabled. Trying to complete the booking flow.",
  );

  for (let step = 1; step <= 8; step += 1) {
    await settle(page);

    if (await hasVisibleText(page, successPattern, 1200)) {
      console.log("Booking appears to be confirmed.");
      return;
    }

    const clickedProgress = await clickFirstAction(
      page,
      progressActionPatterns,
    );
    if (clickedProgress) {
      console.log(`Step ${step}: clicked "${clickedProgress}".`);
      continue;
    }

    const clickedBooking = await clickFirstAction(page, [
      finalActionPattern,
      ...bookingActionPatterns,
    ]);
    if (clickedBooking) {
      console.log(`Step ${step}: clicked "${clickedBooking}".`);
      continue;
    }

    const actions = await listVisibleActions(page);
    console.log("No recognized booking action was found.");
    printActions(actions);
    return;
  }

  if (await hasVisibleText(page, successPattern, 1200)) {
    console.log("Booking appears to be confirmed.");
  } else {
    console.log(
      "Stopped after several booking steps. Please check the browser state manually.",
    );
  }
}

async function pauseForLoginIfNeeded(page) {
  const loginUrl = /\/guest\/welcome|login|signin|sign-in/i.test(page.url());
  const loginTextVisible = await hasVisibleText(
    page,
    /log in|login|sign in|continue with|email/i,
    1500,
  );

  if (!loginUrl && !loginTextVisible) {
    return;
  }

  if (config.nonInteractive || config.headless) {
    throw new LoginRequiredError(
      "Flowpass needs login. Run login.cmd once, finish login in the opened browser, then let the monitor continue.",
    );
  }

  console.log("");
  console.log("Flowpass is asking for login or welcome setup.");
  console.log("Finish that in the opened browser, then return here.");

  const rl = createInterface({ input, output });
  await rl.question("Press Enter after the Flowpass home page is visible...");
  rl.close();

  await settle(page);
}

async function selectVisibleText(page, rawText, pick, options = {}) {
  const pattern = textPattern(rawText);
  await page.waitForLoadState("domcontentloaded").catch(() => {});

  const candidates = await markTextCandidates(page, pattern);
  if (candidates.length === 0) {
    throw new Error(`No visible match for "${rawText}"`);
  }

  const usable = options.requireAvailable
    ? candidates.filter((candidate) => candidate.available)
    : candidates;
  if (usable.length === 0) {
    const summary = candidates
      .slice(0, 4)
      .map((candidate) => `"${candidate.text}" (${candidate.status})`)
      .join("; ");
    throw new Error(
      `Found matches for "${rawText}", but none looked available: ${summary}`,
    );
  }

  const index = pick === "last" ? usable.length - 1 : 0;
  const candidate = usable[index];
  const locator = page.locator(`[data-flowpass-helper-id="${candidate.id}"]`);

  console.log(`Clicking ${pick} match: ${candidate.text}`);
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ trial: true });
  await locator.click();
}

async function clickFirstAction(page, patterns) {
  for (const pattern of patterns) {
    const clicked = await clickActionByPattern(page, pattern);
    if (clicked) {
      return clicked;
    }
  }

  return null;
}

async function clickActionByPattern(page, pattern) {
  const actions = await markActionCandidates(page, pattern);
  if (actions.length === 0) {
    return null;
  }

  const action = actions[0];
  const locator = page.locator(`[data-flowpass-helper-action="${action.id}"]`);
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ trial: true });
  await locator.click();
  return action.text;
}

async function markTextCandidates(page, pattern) {
  return page.evaluate(({ source, flags }) => {
    clearHelperAttributes("data-flowpass-helper-id");
    const matcher = new RegExp(source, flags);
    const clickableSelector = [
      "button",
      "a",
      '[role="button"]',
      '[role="link"]',
      "article",
      "li",
      '[class*="card" i]',
      '[class*="tile" i]',
      '[class*="item" i]',
      '[class*="option" i]',
    ].join(",");

    const seen = new Set();
    const matches = [];

    for (const element of document.querySelectorAll("body *")) {
      const text = compactText(element.innerText || element.textContent || "");
      if (
        !text ||
        text.length > 500 ||
        !matcher.test(text) ||
        !isVisible(element)
      ) {
        continue;
      }

      const target = element.closest(clickableSelector) || element;
      if (seen.has(target) || !isVisible(target)) {
        continue;
      }

      const targetText = compactText(
        target.innerText || target.textContent || text,
      );
      const disabled = isDisabled(target);
      const unavailable = looksUnavailable(targetText);
      const id = `text-${matches.length}-${Date.now()}`;
      target.setAttribute("data-flowpass-helper-id", id);
      seen.add(target);
      matches.push({
        id,
        text: targetText.slice(0, 160),
        available: !disabled && !unavailable,
        status: disabled
          ? "disabled"
          : unavailable
            ? "unavailable"
            : "available",
      });
    }

    return matches;

    function clearHelperAttributes(attribute) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        element.removeAttribute(attribute);
      }
    }

    function compactText(value) {
      return value.replace(/\s+/g, " ").trim();
    }

    function isDisabled(element) {
      for (
        let current = element;
        current && current !== document.body;
        current = current.parentElement
      ) {
        if (
          current.disabled === true ||
          current.getAttribute("aria-disabled") === "true" ||
          current.getAttribute("disabled") !== null ||
          /\bdisabled\b/i.test(current.className || "")
        ) {
          return true;
        }
      }

      return false;
    }

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function looksUnavailable(value) {
      return /sold out|fully booked|booked out|unavailable|not available|no availability|no slots|no spaces?|waitlist|closed|0\s+(left|spots?|places?)/i.test(
        value,
      );
    }
  }, regexPayload(pattern));
}

async function markActionCandidates(page, pattern) {
  return page.evaluate(({ source, flags }) => {
    clearHelperAttributes("data-flowpass-helper-action");
    const matcher = new RegExp(source, flags);
    const selector = 'button,a,[role="button"],[role="link"]';
    const matches = [];

    for (const element of document.querySelectorAll(selector)) {
      const text = compactText(
        element.innerText ||
          element.textContent ||
          element.getAttribute("aria-label") ||
          "",
      );
      const disabled =
        element.disabled === true ||
        element.getAttribute("aria-disabled") === "true" ||
        element.getAttribute("disabled") !== null;

      if (!text || disabled || !matcher.test(text) || !isVisible(element)) {
        continue;
      }

      const id = `action-${matches.length}-${Date.now()}`;
      element.setAttribute("data-flowpass-helper-action", id);
      matches.push({ id, text: text.slice(0, 120) });
    }

    return matches;

    function clearHelperAttributes(attribute) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        element.removeAttribute(attribute);
      }
    }

    function compactText(value) {
      return value.replace(/\s+/g, " ").trim();
    }

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }
  }, regexPayload(pattern));
}

async function listVisibleActions(page) {
  return page.evaluate(() => {
    const actions = [];

    for (const element of document.querySelectorAll(
      'button,a,[role="button"],[role="link"]',
    )) {
      const text = (
        element.innerText ||
        element.textContent ||
        element.getAttribute("aria-label") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const disabled =
        element.disabled === true ||
        element.getAttribute("aria-disabled") === "true" ||
        element.getAttribute("disabled") !== null;

      if (
        text &&
        !disabled &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        actions.push(text.slice(0, 120));
      }
    }

    return [...new Set(actions)].slice(0, 20);
  });
}

async function hasVisibleText(page, pattern, timeout) {
  try {
    await page
      .getByText(pattern)
      .first()
      .waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
}

function printActions(actions) {
  if (actions.length === 0) {
    console.log("- No visible actions found.");
    return;
  }

  for (const action of actions) {
    console.log(`- ${action}`);
  }
}

function textPattern(value) {
  const alternatives = value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .split(/\s+/)
        .map((token) => escapeRegExp(token).replace(/-/g, "[-\\s]?"))
        .join("\\s+"),
    );

  if (alternatives.length === 0) {
    throw new Error("Text pattern cannot be empty.");
  }

  return new RegExp(alternatives.join("|"), "i");
}

function regexPayload(pattern) {
  return { source: pattern.source, flags: pattern.flags };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function truthy(value) {
  return /^(1|true|yes|y|on)$/i.test(String(value).trim());
}

function resolveProjectPath(value) {
  return path.isAbsolute(value) ? value : path.join(projectRoot, value);
}

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...rest] = trimmed.split("=");
    const value = rest
      .join("=")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error("Playwright is not installed yet.");
    console.error("Run: setup.cmd");
    process.exit(1);
  }
}
