#!/usr/bin/env node
import { runSimulation } from "./simulator.mjs";
import { normalizeTarget } from "./target.mjs";

const interval = Number(process.env.SIM_INTERVAL_SECONDS || 180);
const tolerance = interval * 0.2;

const round = async () => {
  try {
    const t0 = Date.now();
    const r = await runSimulation({
      target: normalizeTarget(process.env.TARGET_URL || ""),
      chatEnabled: String(process.env.SIM_ENABLE_CHAT ?? "true"),
      chatHours: process.env.SIM_CHAT_HOURS ?? "9,15,21",
      pollSeconds: process.env.SIM_CHAT_POLL_SECONDS,
      assetsMax: process.env.SIM_ASSETS_MAX,
      timeoutMs: process.env.SIM_TIMEOUT_MS,
      jitterMs: process.env.SIM_JITTER_MS,
      stateDir: process.env.SIM_STATE_DIR ?? "sim/state",
      userAgent: process.env.SIM_UA,
    });
    console.log(`[${new Date().toISOString()}] ronda ${r.verdict} okRate=${r.okRate} took=${r.tookMs}ms chat=${r.chat.status}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ronda falhada: ${err && err.message ? err.message : err}`);
  }
};

const schedule = () => {
  const wait = Math.max(10, (interval - tolerance / 2) * 1000 + Math.random() * tolerance * 1000);
  round().then(() => setTimeout(schedule, wait));
};

console.log(`presistent loop: intervalo ~${interval}s, alvo ${normalizeTarget(process.env.TARGET_URL || "https://akira-ia.onrender.com")}`);
schedule();
