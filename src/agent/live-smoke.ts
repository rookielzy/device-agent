export function shouldRunDeepSeekLiveSmoke(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEEPSEEK_LIVE_SMOKE === "1" && Boolean(env.DEEPSEEK_API_KEY);
}

export function shouldRunPlatformLiveSmoke(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.PLATFORM_LIVE_SMOKE === "1" &&
    Boolean(env.DEEPSEEK_API_KEY) &&
    Boolean(env.PLATFORM_USER_CENTER_BASE_URL) &&
    Boolean(env.PLATFORM_IOT_BASE_URL) &&
    Boolean(env.PLATFORM_VALIDATION_MOBILE) &&
    Boolean(env.PLATFORM_VALIDATION_PASSWORD)
  );
}
