import { z } from "zod";

const interpreterModeSchema = z.enum(["fake", "deepseek"]);
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
  DEEPSEEK_API_KEY: z.string().trim().optional(),
  DEEPSEEK_MODEL: z.string().trim().min(1).default("deepseek-v4-flash"),
  ENABLE_DEBUG_SIMULATED_DEVICES: booleanEnvSchema
});

export type InterpreterMode = z.infer<typeof interpreterModeSchema>;

export type AppConfig = {
  host: string;
  port: number;
  interpreterMode: InterpreterMode;
  deepseek: {
    apiKey?: string;
    model: string;
  };
  enableDebugSimulatedDevices: boolean;
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

  return {
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    interpreterMode: parsed.data.AGENT_INTERPRETER_MODE,
    deepseek: {
      ...(apiKey ? { apiKey } : {}),
      model: parsed.data.DEEPSEEK_MODEL
    },
    enableDebugSimulatedDevices: parsed.data.ENABLE_DEBUG_SIMULATED_DEVICES
  };
}
