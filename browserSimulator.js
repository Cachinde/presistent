#!/usr/bin/env node
// Wrapper de compatibilidade (nome original do repo). Façade para sim/browser.mjs
import { runBrowserSimulation } from "./sim/browser.mjs";

const args = process.argv.slice(2);
const report = await runBrowserSimulation({ forceChat: !args.includes("--no-chat") });
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.browserOk ? 0 : 1;
