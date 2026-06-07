export function shouldRunDeepSeekLiveSmoke(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEEPSEEK_LIVE_SMOKE === "1" && Boolean(env.DEEPSEEK_API_KEY);
}
