#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CHAT_PROMPTS, CHAT_PROFILE_NAME } from "./target.mjs";

const args = process.argv.slice(2);
const headlessArg = !args.includes("--headful");
const stateDir = process.env.SIM_STATE_DIR || "sim/state";

function listMsPlaywrightBrowsers() {
  const out = [];
  try {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/ms-playwright";
    for (const dir of fs.readdirSync(base)) {
      if (!/^chromium|^msedge/.test(dir)) continue;
      for (const plat of ["chrome-linux", "chrome-linux64", "chrome-headless-shell-linux", "linux"]) {
        const p = path.join(base, dir, plat);
        for (const exe of ["chrome", "headless_shell", "msedge"]) {
          const full = path.join(p, exe);
          if (fs.existsSync(full)) out.push(full);
        }
      }
    }
  } catch {}
  return out;
}

function findBrowserExecutable() {
  const candidates = [
    process.env.SIM_EXE,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    process.env.SIM_EXE_LINUX,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  const fromImage = listMsPlaywrightBrowsers();
  for (const p of [...candidates, ...fromImage]) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return "";
}

async function resolveChromium() {
  const serverless = process.platform === "linux" || process.env.SIM_SERVERLESS === "1";
  if (serverless) {
    try {
      const chromiumLib = (await import("@sparticuz/chromium")).default;
      return { args: chromiumLib.args, executablePath: await chromiumLib.executablePath(), headless: true };
    } catch {}
  }
  const exe = findBrowserExecutable();
  return { args: ["--no-sandbox", "--disable-gpu"], executablePath: exe, headless: headlessArg };
}

export async function runBrowserSimulation(options = {}) {
  const target = (options.target || process.env.TARGET_URL || "https://akira-ia.onrender.com").replace(/\/+$/, "");
  const forceChat = options.forceChat ?? true;
  const maxRoutes = Number(options.maxRoutes ?? process.env.SIM_BROWSER_MAX_ROUTES ?? 4);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const steps = [];
  const consoleErrors = [];
  let browserOk = false;
  let exitError = "";

  const { args: launchArgs, executablePath, headless } = await resolveChromium();
  if (!executablePath) {
    throw new Error("sem browser: instala @sparticuz/chromium (serverless) ou define SIM_EXE com caminho de Chrome/Edge");
  }

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    args: [...launchArgs, "--disable-blink-features=AutomationControlled"],
    executablePath,
    headless,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-PT",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300)); });

  const visit = async (route) => {
    const s0 = Date.now();
    let status = 0;
    try {
      const res = await page.goto(target + route, { waitUntil: "domcontentloaded", timeout: Number(process.env.SIM_TIMEOUT_MS ?? 20000) });
      status = res ? res.status() : 0;
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    } catch (err) { exitError = String(err && err.message ? err.message : err); }
    const ms = Date.now() - s0;
    steps.push({ path: route, status, ms, ok: status >= 200 && status < 400 });
    if (steps.some((x) => x.path === route && x.ok)) {
      await page.evaluate(() => new Promise((r) => {
        let y = 0;
        const id = setInterval(() => { y += 300 + Math.floor(Math.random() * 400); window.scrollTo(0, y); if (y > 1600) { clearInterval(id); r(undefined); } }, 120);
      })).catch(() => {});
    }
    return status;
  };

  // 1. home (real render + assets) + scroll humano
  await visit("/");
  if (steps[0].ok) await page.waitForTimeout(600 + Math.floor(Math.random() * 900));

  // 2. rotas via navegação interna quando possível (link nav real), fallback goto
  const routes = ["/plans", "/tasks", "/login"].slice(0, Math.max(0, maxRoutes - 1));
  for (const route of routes) {
    try {
      const link = page.locator(`a[href="${route}"]`).first();
      if (await link.count().catch(() => 0)) {
        const s0 = Date.now();
        await link.click({ timeout: 5000 });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        steps.push({ path: route, status: 200, ms: Date.now() - s0, ok: true, via: "click" });
      } else {
        await visit(route);
      }
    } catch {
      await visit(route).catch(() => {});
    }
  }

  // 3. chat real: profile + POST + polling via fetch IN-PAGE (mesma sessão/cookies)
  let chat = null;
  if (forceChat) {
    const c0 = Date.now();
    chat = { status: "error", replyPreview: "", replyChars: 0, provider: "", markdownDetected: false, jobId: "" };
    try {
      await page.request.post(target + "/api/auth/profile", { data: { displayName: CHAT_PROFILE_NAME } });
      const jobId = randomUUID();
      chat.jobId = jobId;
      const post = await page.request.post(target + "/api/chat", {
        data: { message: CHAT_PROMPTS[Math.floor(Math.random() * CHAT_PROMPTS.length)], history: [], jobId },
      });
      if (post.ok()) {
        const deadline = Date.now() + Number(process.env.SIM_CHAT_POLL_SECONDS ?? 60) * 1000;
        while (Date.now() < deadline) {
          const g = await page.request.get(`${target}/api/chat?jobId=${jobId}`);
          if (g.status() === 200) {
            const result = await g.json().catch(() => ({}));
            chat.replyPreview = String(result.reply || "").slice(0, 220);
            chat.replyChars = String(result.reply || "").length;
            chat.provider = String(result.provider || "");
            chat.markdownDetected = /```|\n#{1,6}\s|\*\*[^*\n]+\*\*|\n\s*[-*]\s|\n\s*\d+\.\s|\[[^\]]+\]\(/.test(result.reply || "");
            chat.status = "ok";
            break;
          }
          if (g.status() === 503 || g.status() === 404) break;
          await page.waitForTimeout(2500 + Math.floor(Math.random() * 1500));
        }
        if (chat.status !== "ok") chat.status = "timeout";
      } else {
        chat.status = "error";
      }
    } catch (err) { exitError = String(err && err.message ? err.message : err); }
    chat.tookMs = Date.now() - c0;
  }

  // 4. screenshot final (opcional)
  let screenshot = "";
  try {
    if (process.env.SIM_SCREENSHOT === "1") {
      fs.mkdirSync(stateDir, { recursive: true });
      screenshot = path.resolve(path.join(stateDir, "last-browser.png"));
      await page.screenshot({ path: screenshot, fullPage: false });
    }
  } catch {}

  const title = await page.title().catch(() => "");
  await browser.close().catch(() => {});
  browserOk = steps.filter((s) => s.ok).length >= Math.max(1, Math.floor(steps.length / 2));

  return {
    service: "presistent-browser (chromium real)",
    target,
    startedAt,
    finishedAt: new Date().toISOString(),
    tookMs: Date.now() - t0,
    executable: path.basename(executablePath),
    headless,
    pageTitle: title,
    steps,
    consoleErrors,
    chat,
    screenshot,
    browserOk,
    ...(exitError ? { errors: [exitError] } : {}),
  };
}

const isMain = !!process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("browser.mjs");
if (isMain) {
  const report = await runBrowserSimulation({ forceChat: !args.includes("--no-chat") });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.browserOk ? 0 : 1;
}
