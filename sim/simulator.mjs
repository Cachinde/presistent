import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ASSET_PATTERN, BOOT_API, CHAT_PROMPTS, CHAT_PROFILE_NAME, PAGE_ROUTES, SECONDARY_ROUTES } from "./target.mjs";
import {
  assetHeaders,
  cookieHeader,
  documentHeaders,
  jsonHeaders,
  newSessionStateId,
  parseCookieRaw,
  parseSetCookies,
  pickUserAgent,
} from "./session.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function jitterRange(min = 120, max = 900) {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return a + Math.random() * (b - a);
}

function makePause(jitterMsCfg, fallback = "120,900") {
  let min = 0, max = 0, fixed = 0;
  if (typeof jitterMsCfg === "number" && Number.isFinite(jitterMsCfg) && jitterMsCfg > 0) fixed = jitterMsCfg;
  else {
    const raw = String(jitterMsCfg ?? fallback).trim() || fallback;
    const parts = raw.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
    if (parts.length === 1 && parts[0] > 0) fixed = parts[0];
    else if (parts.length >= 2) { min = Math.min(parts[0], parts[1]); max = Math.max(parts[0], parts[1]); }
    else { min = 120; max = 900; }
  }
  return () => (fixed > 0 ? fixed : jitterRange(min, max));
}

function loadState(stateDir) {
  const out = { cookies: {}, uid: newSessionStateId() };
  if (!stateDir) return out;
  try {
    const file = path.join(stateDir, "session.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw.cookies === "object") {
      out.cookies = { ...raw.cookies };
      out.uid = typeof raw.uid === "string" && raw.uid ? raw.uid.slice(0, 18) : out.uid;
    }
  } catch {}
  return out;
}

function saveState(stateDir, state) {
  if (!stateDir) return;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "session.json"), JSON.stringify(state, null, 2), "utf8");
  } catch {}
}

function discoverAssets(html) {
  if (typeof html !== "string") return [];
  ASSET_PATTERN.lastIndex = 0;
  const set = new Set();
  let m;
  while ((m = ASSET_PATTERN.exec(html))) set.add(m[0]);
  return [...set];
}

export function isChatDueNow(chatHours, forceChat) {
  if (forceChat === true || forceChat === "1" || forceChat === "true") return true;
  const raw = (chatHours || "").trim();
  if (raw === "" || raw === "*") return false;
  const list = raw.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 0 && x <= 23);
  if (!list.length) return false;
  return list.includes(new Date().getUTCHours());
}

function detectMarkdown(text) {
  if (typeof text !== "string" || !text) return false;
  return /```|\n#{1,6}\s|\*\*[^*\n]+\*\*|\n\s*[-*]\s|\n\s*\d+\.\s|^\s*>\s|\[[^\]]+\]\(/.test(text);
}

export async function runSimulation(options = {}) {
  const target = options.target || process.env.TARGET_URL || "https://akira-ia.onrender.com";
  const timeoutMs = Number(options.timeoutMs ?? process.env.SIM_TIMEOUT_MS ?? 15000);
  const assetsMax = Number(options.assetsMax ?? process.env.SIM_ASSETS_MAX ?? 3);
  const jitterMs = options.jitterMs ?? process.env.SIM_JITTER_MS ?? "120,900";
  const stateDir = options.stateDir ?? process.env.SIM_STATE_DIR ?? null;
  const chatEnabled = String(options.chatEnabled ?? process.env.SIM_ENABLE_CHAT ?? "true").toLowerCase() === "true";
  const chatHours = options.chatHours ?? process.env.SIM_CHAT_HOURS ?? "9,15,21";
  const forceChat = options.forceChat ?? (process.env.SIM_FORCE_CHAT === "1" ? true : false);
  const pollSeconds = Number(options.pollSeconds ?? process.env.SIM_CHAT_POLL_SECONDS ?? 45);
  const uaFixed = options.userAgent ?? process.env.SIM_UA ?? "";
  const pause = makePause(jitterMs, "120,900");

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const uaInfo = pickUserAgent(uaFixed);
  const state = loadState(stateDir);
  const steps = [];
  const errors = [];
  let cookies = { ...state.cookies };

  const record = (p, res, ms, note = "") => {
    steps.push({
      path: p,
      status: res ? res.status : 0,
      ms,
      ok: !!res && res.status >= 200 && res.status < 400,
      ...(note ? { note } : {}),
    });
  };

  const requestOnce = async (p, headers, extra = {}) => {
    const ms0 = Date.now();
    try {
      const hs = { ...headers };
      const c = cookieHeader(cookies);
      if (c) hs["Cookie"] = c;
      else if (extra.cookieOnly) hs["Cookie"] = cookieHeader(cookies);
      if (extra.method !== "GET" && !hs["Content-Type"]) hs["Content-Type"] = "application/json";
      let res = await fetch(target + p, {
        method: extra.method || "GET",
        headers: hs,
        ...(extra.body ? { body: typeof extra.body === "string" ? extra.body : JSON.stringify(extra.body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: extra.redirect || "follow",
      });
      for (const raw of res.headers.getSetCookie()) {
        const single = {};
        parseCookieRaw(raw, single);
        for (const [k, v] of Object.entries(single)) cookies[k] = v;
      }
      const bodyText = await res.text();
      const ms = Date.now() - ms0;
      return { res, bodyText, ms };
    } catch (err) {
      const ms = Date.now() - ms0;
      errors.push(`${p}: ${err && err.message ? err.message : String(err)}`);
      return { res: null, bodyText: "", ms };
    }
  };

  const navigate = async (p, headers, note = "") => {
    const r = await requestOnce(p, headers);
    let retry = null;
    if (!r.res && errors.length) {
      await sleep(700 + Math.random() * 600);
      retry = await requestOnce(p, headers);
    }
    const final = r.res ? r : retry;
    record(p, final && final.res, final ? final.ms : 0, note);
    return final;
  };

  // 1. Página inicial (documento)
  const home = await navigate("/", documentHeaders(uaInfo.ua));
  const coldStart = !!home && home.ms > 8000;
  if (stateDir) saveState(stateDir, { cookies, uid: state.uid });

  // 2. Assets extraídos do HTML
  const assets = discoverAssets(home.bodyText);
  const chosen = [];
  if (assets.length) {
    const pool = [...assets];
    while (chosen.length < Math.min(assetsMax, pool.length)) {
      chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
  }
  for (const a of chosen) {
    await sleep(pause());
    const h = assetHeaders(uaInfo.ua);
    if (a.endsWith(".css")) h["Sec-Fetch-Dest"] = "style";
    await navigate(a, h);
  }

  // 3. API de boot (sessão/billing/health)
  for (const p of BOOT_API) {
    await sleep(pause());
    await navigate(p, jsonHeaders(uaInfo.ua, target + "/"));
  }

  // 4. Página secundária aleatória (login/plans/tasks)
  const secondary = PAGE_ROUTES.filter((r) => r !== "/")[Math.floor(Math.random() * (PAGE_ROUTES.length - 1))];
  await sleep(pause());
  await navigate(secondary, documentHeaders(uaInfo.ua));

  // 5. Rotas não críticas
  if (Math.random() < 0.7) {
    const s = SECONDARY_ROUTES[Math.floor(Math.random() * SECONDARY_ROUTES.length)];
    await sleep(pause());
    await navigate(s, documentHeaders(uaInfo.ua));
  }

  // 6. Chat real (opcional/gated)
  const chatAttempt = chatEnabled && isChatDueNow(chatHours, forceChat);
  const chat = {
    enabled: chatEnabled,
    attempted: chatAttempt,
    status: chatAttempt ? "pending" : "skipped",
    reason: chatAttempt ? "" : chatEnabled ? `fora das horas (${chatHours} UTC)` : "desativado por config",
    jobId: "",
    replyPreview: "",
    replyChars: 0,
    provider: "",
    markdownDetected: false,
    pollAttempts: 0,
    tookMs: 0,
  };

  if (chatAttempt) {
    const c0 = Date.now();
    try {
      let chatHome = home.bodyText && home.bodyText.length > 200 ? home : await navigate("/", documentHeaders(uaInfo.ua));
      void chatHome;
      const post = await requestOnce("/api/chat", jsonHeaders(uaInfo.ua, target + "/"), {
        method: "POST",
        body: { message: CHAT_PROMPTS[Math.floor(Math.random() * CHAT_PROMPTS.length)], history: [], jobId: randomUUID() },
      });
      let jobId = "";
      let needsProfile = false;
      if (post.res && post.res.status === 202) {
        try {
          const j = JSON.parse(post.bodyText || "{}");
          jobId = typeof j.jobId === "string" ? j.jobId : "";
        } catch {}
        record("/api/chat", post.res, post.ms, "job criado");
      } else if (post.res && post.res.status === 403) {
        let payload = {};
        try { payload = JSON.parse(post.bodyText || "{}"); } catch {}
        if (payload.code === "profile_required") needsProfile = true;
      }
      if (!jobId && needsProfile) {
        const prof = await requestOnce("/api/auth/profile", jsonHeaders(uaInfo.ua, target + "/"), {
          method: "POST",
          body: { displayName: CHAT_PROFILE_NAME },
        });
        record("/api/auth/profile", prof && prof.res, prof ? prof.ms : 0, needsProfile ? "profile_required → redefinido" : "");
        const retry = await requestOnce("/api/chat", jsonHeaders(uaInfo.ua, target + "/"), {
          method: "POST",
          body: { message: CHAT_PROMPTS[Math.floor(Math.random() * CHAT_PROMPTS.length)], history: [], jobId: randomUUID() },
        });
        if (retry.res && retry.res.status === 202) {
          try { jobId = JSON.parse(retry.bodyText || "{}").jobId || ""; } catch {}
          record("/api/chat", retry.res, retry.ms, "job criado (após profile)");
        } else {
          record("/api/chat", retry.res, retry.ms, "falhou após profile");
          chat.status = "error";
        }
      }
      chat.jobId = jobId;
      if (jobId) {
        const deadline = Date.now() + pollSeconds * 1000;
        while (Date.now() < deadline) {
          chat.pollAttempts++;
          await sleep(2500 + Math.random() * 1200);
          const poll = await requestOnce(`/api/chat?jobId=${jobId}`, jsonHeaders(uaInfo.ua, target + "/"));
          if (poll.res && poll.res.status === 200) {
            try {
              const result = JSON.parse(poll.bodyText || "{}");
              chat.replyPreview = String(result.reply || "").slice(0, 220);
              chat.replyChars = typeof result.reply === "string" ? result.reply.length : 0;
              chat.provider = typeof result.provider === "string" ? result.provider : "";
              chat.markdownDetected = detectMarkdown(result.reply);
              chat.status = "ok";
            } catch {}
            record(`/api/chat?jobId=${jobId}`, poll.res, poll.ms, "resposta recebida");
            break;
          }
          if (poll.res && (poll.res.status === 503 || poll.res.status === 404)) {
            chat.status = "error";
            record(`/api/chat?jobId=${jobId}`, poll.res, poll.ms, "falhou/expirou");
            break;
          }
          record(`/api/chat?jobId=${jobId}`, poll.res, poll.ms, "processing");
        }
        if (chat.status === "pending") chat.status = "timeout";
      } else {
        chat.status = "error";
      }
    } catch (err) {
      chat.status = "error";
      errors.push(`chat: ${err && err.message ? err.message : String(err)}`);
    }
    chat.tookMs = Date.now() - c0;
  }

  if (stateDir) saveState(stateDir, { cookies, uid: state.uid });

  const nav = steps;
  const okCount = nav.filter((s) => s.ok).length;
  const okRate = nav.length ? okCount / nav.length : 0;
  let verdict = "warm_ok";
  if (okRate < 0.6) verdict = "degraded";
  if (okRate === 0) verdict = "failed";
  if (chat.status === "ok" && okCount > 0) verdict = nav.some((s) => s.status >= 500) ? "degraded" : "warm_ok";

  const report = {
    service: "presistent",
    target,
    startedAt,
    finishedAt: new Date().toISOString(),
    tookMs: Date.now() - t0,
    profile: { userAgent: uaInfo.ua, cookies: Object.keys(cookies) },
    coldStart,
    steps: nav,
    assets: chosen,
    chat,
    errors,
    okRate: Math.round(okRate * 100) / 100,
    verdict,
  };
  return report;
}

export default runSimulation;
