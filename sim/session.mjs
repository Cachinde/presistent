import { randomBytes } from "node:crypto";

const CHROME_VERSIONS_POOL = ["141.0.7390.55", "142.0.7444.45", "140.0.7339.80", "139.0.7258.67"];

const PLATFORMS = [
  { ua: "Windows NT 10.0; Win64; x64", plat: 'Windows NT 10.0; Win64; x64', sec: "\"Windows\"" },
  { ua: "Macintosh; Intel Mac OS X 10_15_7", plat: 'Macintosh; Intel Mac OS X 10_15_7', sec: "\"macOS\"" },
  { ua: "X11; Linux x86_64", plat: "Linux x86_64", sec: "\"Linux\"" },
];

export function pickUserAgent(fixed) {
  const ua = (fixed || "").trim();
  if (ua) return { ua, platform: "", secPlatform: "", isFirefox: false };
  const v = CHROME_VERSIONS_POOL[Math.floor(Math.random() * CHROME_VERSIONS_POOL.length)];
  const p = PLATFORMS[Math.floor(Math.random() * PLATFORMS.length)];
  const full = `Mozilla/5.0 (${p.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  return { ua: full, platform: p.plat, secPlatform: p.sec, isFirefox: false };
}

export function documentHeaders(ua, seconds = 0) {
  return {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-PT,pt-BR;q=0.8,pt;q=0.7,en;q=0.6",
    "Cache-Control": seconds > 0 ? `max-age=${seconds}` : "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-User": "?1",
  };
}

export function assetHeaders(ua) {
  return {
    "User-Agent": ua,
    "Accept": "*/*",
    "Accept-Language": "pt-PT,pt-BR;q=0.8,pt;q=0.7,en;q=0.6",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Dest": "script",
    "Referer": "",
  };
}

export function jsonHeaders(ua, referer = "") {
  const h = {
    "User-Agent": ua,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-PT,pt-BR;q=0.8,pt;q=0.7,en;q=0.6",
    "Content-Type": "application/json",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
  if (referer) h["Referer"] = referer;
  return h;
}

export function parseSetCookies(importedGetSetCookie) {
  const out = {};
  if (typeof importedGetSetCookie === "function") {
    for (const raw of importedGetSetCookie()) parseCookieRaw(raw, out);
  }
  return out;
}

export function parseCookieRaw(raw, store) {
  if (typeof raw !== "string") return false;
  const [pair, ...attrs] = raw.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return false;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return false;
  let deleted = false;
  for (const a of attrs) {
    const [k, v = ""] = a.trim().split("=");
    if (k.toLowerCase() === "max-age") {
      const n = Number(v);
      if (n <= 0) deleted = true;
    } else if (k.toLowerCase() === "expires" && v) {
      const t = Date.parse(v);
      if (Number.isFinite(t) && t < Date.now()) deleted = true;
    }
  }
  if (deleted) {
    delete store[name];
  } else {
    store[name] = value;
  }
  return true;
}

export function cookieHeader(store) {
  return Object.entries(store)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function newSessionStateId() {
  return randomBytes(9).toString("hex");
}
