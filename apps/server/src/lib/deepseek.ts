import OpenAI from "openai";

export function createDeepSeekClient() {
  const configuredURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const url = new URL(configuredURL);
  const isLocalOllama = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "11434";
  if (isLocalOllama && (url.pathname === "/" || url.pathname === "/api/chat")) {
    url.pathname = "/v1";
  }

  const apiKey = process.env.DEEPSEEK_API_KEY || (isLocalOllama ? "ollama" : undefined);
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured.");

  return new OpenAI({
    baseURL: url.toString().replace(/\/$/, ""),
    apiKey,
  });
}

export const deepSeekModel = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
