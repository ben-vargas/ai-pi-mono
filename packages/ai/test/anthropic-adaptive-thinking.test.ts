import { describe, expect, it } from "vitest";
import { getModel, supportsXhigh } from "../src/models.js";
import { streamSimple } from "../src/stream.js";
import type { Context, Model, ThinkingLevel } from "../src/types.js";

interface AdaptiveThinkingConfig {
	type: "adaptive";
}

interface EnabledThinkingConfig {
	type: "enabled";
	budget_tokens: number;
}

type CapturedThinkingConfig = AdaptiveThinkingConfig | EnabledThinkingConfig;
type CapturedEffort = "low" | "medium" | "high" | "max";

interface CapturedAnthropicPayload {
	thinking?: CapturedThinkingConfig;
	output_config?: {
		effort?: CapturedEffort | null;
	};
}

const context: Context = {
	systemPrompt: "You are a helpful assistant.",
	messages: [{ role: "user", content: "Say hello.", timestamp: Date.now() }],
};

type AnthropicTestModelId = "claude-opus-4-5" | "claude-opus-4-6";

function getAnthropicModelOrThrow(modelId: AnthropicTestModelId): Model<"anthropic-messages"> {
	const model = getModel("anthropic", modelId);
	if (!model) {
		throw new Error(`Missing test model anthropic/${modelId}`);
	}
	return model;
}

function getOpus46ModelForTests(): Model<"anthropic-messages"> {
	const opus46 = getModel("anthropic", "claude-opus-4-6");
	if (opus46) return opus46;

	const fallback = getAnthropicModelOrThrow("claude-opus-4-5");
	return { ...fallback, id: "claude-opus-4-6" };
}

async function capturePayload(
	model: Model<"anthropic-messages">,
	reasoning?: ThinkingLevel,
): Promise<CapturedAnthropicPayload> {
	let capturedPayload: unknown;
	const s = streamSimple(model, context, {
		apiKey: "fake-key",
		reasoning,
		onPayload: (payload) => {
			capturedPayload = payload;
		},
	});

	for await (const event of s) {
		if (event.type === "error") break;
	}

	expect(capturedPayload).toBeDefined();
	return capturedPayload as CapturedAnthropicPayload;
}

describe("Anthropic adaptive thinking payload", () => {
	it("uses adaptive thinking + high effort for Opus 4.6 with high reasoning", async () => {
		const payload = await capturePayload(getOpus46ModelForTests(), "high");
		expect(payload.thinking).toEqual({ type: "adaptive" });
		expect(payload.output_config?.effort).toBe("high");
	});

	it("maps xhigh to max effort for Opus 4.6", async () => {
		const payload = await capturePayload(getOpus46ModelForTests(), "xhigh");
		expect(payload.thinking).toEqual({ type: "adaptive" });
		expect(payload.output_config?.effort).toBe("max");
	});

	it("keeps budget-based thinking for non-Opus-4.6 Anthropic models", async () => {
		const payload = await capturePayload(getAnthropicModelOrThrow("claude-opus-4-5"), "xhigh");
		expect(payload.thinking?.type).toBe("enabled");
		if (payload.thinking?.type !== "enabled") {
			throw new Error(`Expected enabled thinking, received ${payload.thinking?.type ?? "undefined"}`);
		}
		expect(payload.thinking.budget_tokens).toBeGreaterThan(0);
		expect(payload.output_config).toBeUndefined();
	});

	it("omits thinking fields when reasoning is disabled", async () => {
		const payload = await capturePayload(getOpus46ModelForTests());
		expect(payload.thinking).toBeUndefined();
		expect(payload.output_config).toBeUndefined();
	});
});

describe("supportsXhigh for Anthropic Opus 4.6", () => {
	it("returns true for Anthropic Opus 4.6 IDs", () => {
		expect(supportsXhigh(getOpus46ModelForTests())).toBe(true);
	});

	it("returns false for older Anthropic Opus models", () => {
		expect(supportsXhigh(getAnthropicModelOrThrow("claude-opus-4-5"))).toBe(false);
	});
});
