import { z } from "zod";

const interpreterModeSchema = z.enum(["fake", "deepseek"]);
const deviceCapabilityModeSchema = z.enum(["simulated", "platform"]);
const traceSinkSchema = z.enum(["stdout", "stderr"]);
const DEFAULT_PLATFORM_VALIDATION_PROJECT_ID = "270544150790145";
const DEFAULT_PLATFORM_REQUEST_TIMEOUT_MS = 5_000;
const booleanEnvSchema = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === "") {
      return false;
    }

    if (["1", "true", "yes"].includes(value)) {
      return true;
    }

    if (["0", "false", "no"].includes(value)) {
      return false;
    }

    ctx.addIssue({
      code: "custom",
      message: "boolean environment values must be one of true, false, 1, 0, yes, or no"
    });
    return z.NEVER;
  });

const rawEnvSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z
    .string()
    .trim()
    .default("3000")
    .transform((value, ctx) => {
      const port = Number(value);

      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        ctx.addIssue({
          code: "custom",
          message: "PORT must be an integer between 1 and 65535"
        });
        return z.NEVER;
      }

      return port;
    }),
  AGENT_INTERPRETER_MODE: interpreterModeSchema.default("fake"),
  AGENT_DEVICE_CAPABILITY_MODE: deviceCapabilityModeSchema.default("simulated"),
  DEEPSEEK_API_KEY: z.string().trim().optional(),
  DEEPSEEK_MODEL: z.string().trim().min(1).default("deepseek-v4-flash"),
  PLATFORM_USER_CENTER_BASE_URL: z.string().trim().optional(),
  PLATFORM_IOT_BASE_URL: z.string().trim().optional(),
  PLATFORM_VALIDATION_MOBILE: z.string().trim().optional(),
  PLATFORM_VALIDATION_PASSWORD: z.string().optional(),
  PLATFORM_VALIDATION_PROJECT_ID: z.string().trim().min(1).default(DEFAULT_PLATFORM_VALIDATION_PROJECT_ID),
  PLATFORM_REQUEST_TIMEOUT_MS: z
    .string()
    .trim()
    .default(String(DEFAULT_PLATFORM_REQUEST_TIMEOUT_MS))
    .transform((value, ctx) => {
      const timeout = Number(value);

      if (!Number.isInteger(timeout) || timeout < 1) {
        ctx.addIssue({
          code: "custom",
          message: "PLATFORM_REQUEST_TIMEOUT_MS must be a positive integer"
        });
        return z.NEVER;
      }

      return timeout;
    }),
  ENABLE_DEBUG_SIMULATED_DEVICES: booleanEnvSchema,
  ENABLE_AGENT_TRACE: booleanEnvSchema,
  ENABLE_AGENT_TRACE_PAYLOADS: booleanEnvSchema,
  AGENT_TRACE_SINK: traceSinkSchema.default("stdout")
});

export type InterpreterMode = z.infer<typeof interpreterModeSchema>;
export type DeviceCapabilityMode = z.infer<typeof deviceCapabilityModeSchema>;

export type AppConfig = {
  host: string;
  port: number;
  interpreterMode: InterpreterMode;
  deviceCapabilityMode: DeviceCapabilityMode;
  deepseek: {
    apiKey?: string;
    model: string;
  };
  platform?: {
    userCenterBaseUrl: string;
    iotBaseUrl: string;
    validationMobile: string;
    validationPassword: string;
    validationProjectId: string;
    requestTimeoutMs: number;
  };
  enableDebugSimulatedDevices: boolean;
  trace: {
    enabled: boolean;
    includePayloads: boolean;
    sink: "stdout" | "stderr";
  };
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseEnv(input: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawEnvSchema.safeParse(input);

  if (!parsed.success) {
    throw new ConfigError(z.prettifyError(parsed.error));
  }

  const apiKey = parsed.data.DEEPSEEK_API_KEY || undefined;

  if (parsed.data.AGENT_INTERPRETER_MODE === "deepseek" && !apiKey) {
    throw new ConfigError(
      "DEEPSEEK_API_KEY is required when AGENT_INTERPRETER_MODE is deepseek"
    );
  }

  if (parsed.data.AGENT_DEVICE_CAPABILITY_MODE === "platform") {
    if (parsed.data.AGENT_INTERPRETER_MODE !== "deepseek") {
      throw new ConfigError(
        "AGENT_DEVICE_CAPABILITY_MODE=platform requires AGENT_INTERPRETER_MODE=deepseek"
      );
    }

    const missing = requiredPlatformKeys(parsed.data)
      .filter(([, value]) => value === undefined || value.trim() === "")
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new ConfigError(
        `AGENT_DEVICE_CAPABILITY_MODE=platform requires ${missing.join(", ")}`
      );
    }

    for (const [key, value] of [
      ["PLATFORM_USER_CENTER_BASE_URL", parsed.data.PLATFORM_USER_CENTER_BASE_URL],
      ["PLATFORM_IOT_BASE_URL", parsed.data.PLATFORM_IOT_BASE_URL]
    ] as const) {
      if (!isAbsoluteHttpUrl(value!)) {
        throw new ConfigError(`${key} must be an absolute http(s) URL when AGENT_DEVICE_CAPABILITY_MODE is platform`);
      }
    }

    if (!isLocalHost(parsed.data.HOST)) {
      throw new ConfigError(
        "AGENT_DEVICE_CAPABILITY_MODE=platform is limited to localhost or 127.0.0.1 in this internal validation build"
      );
    }
  }

  const platform = parsed.data.AGENT_DEVICE_CAPABILITY_MODE === "platform"
    ? {
        userCenterBaseUrl: parsed.data.PLATFORM_USER_CENTER_BASE_URL!,
        iotBaseUrl: parsed.data.PLATFORM_IOT_BASE_URL!,
        validationMobile: parsed.data.PLATFORM_VALIDATION_MOBILE!,
        validationPassword: parsed.data.PLATFORM_VALIDATION_PASSWORD!,
        validationProjectId: parsed.data.PLATFORM_VALIDATION_PROJECT_ID,
        requestTimeoutMs: parsed.data.PLATFORM_REQUEST_TIMEOUT_MS
      }
    : undefined;

  return {
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    interpreterMode: parsed.data.AGENT_INTERPRETER_MODE,
    deviceCapabilityMode: parsed.data.AGENT_DEVICE_CAPABILITY_MODE,
    deepseek: {
      ...(apiKey ? { apiKey } : {}),
      model: parsed.data.DEEPSEEK_MODEL
    },
    ...(platform ? { platform } : {}),
    enableDebugSimulatedDevices: parsed.data.ENABLE_DEBUG_SIMULATED_DEVICES,
    trace: {
      enabled: parsed.data.ENABLE_AGENT_TRACE,
      includePayloads: parsed.data.ENABLE_AGENT_TRACE_PAYLOADS,
      sink: parsed.data.AGENT_TRACE_SINK
    }
  };
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1";
}

function requiredPlatformKeys(input: z.infer<typeof rawEnvSchema>): Array<[string, string | undefined]> {
  return [
    ["PLATFORM_USER_CENTER_BASE_URL", input.PLATFORM_USER_CENTER_BASE_URL],
    ["PLATFORM_IOT_BASE_URL", input.PLATFORM_IOT_BASE_URL],
    ["PLATFORM_VALIDATION_MOBILE", input.PLATFORM_VALIDATION_MOBILE],
    ["PLATFORM_VALIDATION_PASSWORD", input.PLATFORM_VALIDATION_PASSWORD]
  ];
}
