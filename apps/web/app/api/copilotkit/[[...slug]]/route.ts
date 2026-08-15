import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  BuiltInAgent,
  CopilotRuntime,
  convertMessagesToVercelAISDKMessages,
  convertToolsToVercelAITools,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import {
  simulateStreamingMiddleware,
  stepCountIs,
  streamText,
  wrapLanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";

import { apiError } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";
import {
  aiModelConfiguration,
  WANAFLOW_AGENT_ID,
  WANAFLOW_AGENT_PROMPT,
} from "@/lib/server/ai-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const runtime = new CopilotRuntime({
  agents: {
    [WANAFLOW_AGENT_ID]: new BuiltInAgent({
      type: "aisdk",
      factory: ({ input, abortSignal }) => {
        const configuration = aiModelConfiguration();
        const provider = createOpenAICompatible({
          name: "deepseek",
          baseURL: configuration.baseUrl,
          apiKey: process.env.DEEPSEEK_API_KEY ?? "not-configured",
        });
        const context = input.context?.length
          ? `\n\nCURRENT EXPERIENCE CONTEXT\n${input.context.map((entry) => `${entry.description}: ${entry.value}`).join("\n")}`
          : "";
        const messages: ModelMessage[] = convertMessagesToVercelAISDKMessages(
          input.messages,
          { forwardSystemMessages: false },
        );
        return streamText({
          model: wrapLanguageModel({
            model: provider.chatModel(configuration.model),
            middleware: simulateStreamingMiddleware(),
          }),
          system: `${WANAFLOW_AGENT_PROMPT}${context}`,
          messages,
          tools: convertToolsToVercelAITools(input.tools) as unknown as ToolSet,
          abortSignal,
          stopWhen: stepCountIs(6),
          temperature: 0.2,
          maxOutputTokens: 4_096,
          providerOptions: {
            deepseek: {
              thinking: { type: "disabled" },
              parallel_tool_calls: false,
            },
          },
        });
      },
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
  hooks: {
    async onRequest({ request }) {
      try {
        await requirePrincipalContext(request, "artifact:create");
      } catch (error) {
        throw apiError(error);
      }
    },
    onBeforeHandler({ route }) {
      if (!aiModelConfiguration().configured && route.method === "agent/run") {
        throw new Response(JSON.stringify({
          error: {
            code: "AI_MODEL_NOT_CONFIGURED",
            message: "Add DEEPSEEK_API_KEY to enable live AI runs.",
          },
        }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
    },
  },
});

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
