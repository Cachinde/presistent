#!/usr/bin/env node
import { runSimulation } from "./simulator.mjs";
import { normalizeTarget } from "./target.mjs";

function argFlag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1;
}
function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return undefined;
}

const args = {
  target: normalizeTarget(process.env.TARGET_URL || argValue("target") || ""),
  chat: argFlag("chat"),
  quiet: argFlag("quiet"),
  json: argFlag("json"),
};

const report = await runSimulation({
  target: args.target,
  chatEnabled: String(process.env.SIM_ENABLE_CHAT ?? "true"),
  chatHours: process.env.SIM_CHAT_HOURS ?? "9,15,21",
  forceChat: args.chat || (process.env.SIM_FORCE_CHAT === "1"),
  pollSeconds: process.env.SIM_CHAT_POLL_SECONDS,
  assetsMax: process.env.SIM_ASSETS_MAX,
  timeoutMs: process.env.SIM_TIMEOUT_MS,
  jitterMs: process.env.SIM_JITTER_MS,
  stateDir: process.env.SIM_STATE_DIR ?? "sim/state",
  userAgent: process.env.SIM_UA,
});

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else if (!args.quiet) {
  const line = (s) => `  ${String(s.status).padEnd(3)} ${String(s.ms).padStart(6)}ms  ${s.path}${s.note ? `  (${s.note})` : ""}`;
  console.log(`# presistent — ${report.startedAt} → ${report.verdict} (okRate ${report.okRate}, coldStart ${report.coldStart})`);
  for (const s of report.steps) console.log(line(s));
  if (report.chat.attempted) {
    console.log(`# chat: ${report.chat.status} · provider ${report.chat.provider || "-"} · reply ${report.chat.replyChars} chars · markdown ${report.chat.markdownDetected} · ${report.chat.tookMs}ms`);
    if (report.chat.replyPreview) console.log(`#   «${report.chat.replyPreview}»`);
  }
  for (const e of report.errors) console.log(`! ${e}`);
} else {
  console.log(`${report.verdict} okRate=${report.okRate}`);
}

process.exitCode = report.verdict === "warm_ok" ? 0 : 1;
