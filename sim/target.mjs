export const TARGET = (process.env.TARGET_URL || "https://akira-ia.onrender.com").replace(/\/+$/, "");

export const PAGE_ROUTES = ["/", "/login", "/plans", "/tasks"];
export const BOOT_API = ["/api/auth/session", "/api/billing", "/api/health", "/api/health/ready"];
export const SECONDARY_ROUTES = ["/robots.txt", "/sitemap.xml"];

export const ASSET_PATTERN = /\/_next\/static\/[A-Za-z0-9\/._-]+\.(?:css|js)/g;

export const CHAT_PROFILE_NAME = process.env.SIM_CHAT_PROFILE || "Presistent Guard";

export const CHAT_PROMPTS = [
  "Saudações AKIRA, confirma o teu estado por favor.",
  "Escreve em uma frase o que consegues fazer.",
  "Quantos minutos tem uma hora? Responde sem formatação.",
  "Diz-me uma curiosidade curiosa sobre a Lua, em texto simples.",
  "Qual é a diferença entre HTTP e HTTPS? Uma linha basta.",
  "Resume em duas frases para que serve uma sessão de cookies.",
  "Diz olá e indica a tua versão, sem listas nem blocos.",
  "Explica em texto corrido como processas a tua resposta.",
  "Pede-me dois temas que eu te posso pedir hoje.",
  "Confirma que estás a serviço e termina com um ponto final.",
];

export function normalizeTarget(value) {
  const t = typeof value === "string" ? value.trim() : "";
  return t ? t.replace(/\/+$/, "") : TARGET;
}
