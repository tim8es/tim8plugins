/**
 * Ambient shim for the OpenClaw Plugin SDK. The real package is provided by
 * the OpenClaw host at runtime and is not published for standalone install,
 * so this repo declares just enough of its shape to type-check against.
 */
declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface PluginHookContext {
    runId?: string;
    sessionKey?: string;
    [key: string]: unknown;
  }

  export interface PluginApi {
    pluginConfig: unknown;
    logger: {
      warn(message: string): void;
      [key: string]: unknown;
    };
    session: {
      workflow: {
        scheduleSessionTurn(input: {
          sessionKey: string;
          message: string;
          delayMs: number;
          deleteAfterRun: boolean;
          deliveryMode: string;
          name: string;
          tag: string;
        }): Promise<boolean>;
      };
    };
    on(
      event: string,
      handler: (event: any, ctx: PluginHookContext) => unknown,
      options?: { priority?: number },
    ): void;
  }

  export interface PluginEntryDefinition {
    id: string;
    name: string;
    description: string;
    register(api: PluginApi): void;
  }

  export function definePluginEntry(entry: PluginEntryDefinition): PluginEntryDefinition;
}
