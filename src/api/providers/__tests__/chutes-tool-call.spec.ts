// npx vitest run src/api/providers/__tests__/chutes-tool-call.spec.ts

// Mock vscode first to avoid import errors
vitest.mock("vscode", () => ({}))

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { ChutesHandler } from "../chutes"
import { ApiHandlerOptions } from "../../../shared/api"
import { getToolRegistry } from "../../../core/prompts/tools/schemas/tool-registry"
import { ApiHandlerCreateMessageMetadata } from "../.."

// Mock dependencies
vitest.mock("openai")
vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))
vitest.mock("../../../core/prompts/tools/schemas/tool-registry")

describe("ChutesHandler Tool Call", () => {
	const mockOptions: ApiHandlerOptions = {
		chutesApiKey: "test-key",
		apiModelId: "deepseek-ai/DeepSeek-R1",
	}

	beforeEach(() => {
		vitest.clearAllMocks()
		const mockToolRegistry = {
			generateFunctionCallSchemas: vitest.fn().mockReturnValue([
				{
					type: "function",
					function: {
						name: "read_file",
						description: "A test tool",
						parameters: {
							type: "object",
							properties: {},
							required: [],
						},
					},
				},
			]),
		}
		;(getToolRegistry as any).mockReturnValue(mockToolRegistry)
	})

	it("should include tool call parameters when tools are provided", async () => {
		const handler = new ChutesHandler(mockOptions)

		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					id: mockOptions.apiModelId,
					choices: [{ delta: { content: "test response" } }],
				}
			},
		}

		const mockCreate = vitest.fn().mockResolvedValue(mockStream)

		;(OpenAI as any).prototype.chat = {
			completions: { create: mockCreate },
		} as any

		const systemPrompt = "test system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]
		const metadata: ApiHandlerCreateMessageMetadata = {
			taskId: "test-task-id",
			tools: ["read_file"],
			toolArgs: {} as any,
		}

		const generator = handler.createMessage(systemPrompt, messages, metadata)
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				tools: [
					{
						type: "function",
						function: {
							name: "read_file",
							description: "A test tool",
							parameters: {
								type: "object",
								properties: {},
								required: [],
							},
						},
					},
				],
				tool_choice: "auto",
			}),
		)
	})

	it("should yield tool_call chunk when tool_calls are in the stream", async () => {
		const handler = new ChutesHandler(mockOptions)
		const toolCalls = [
			{
				index: 0,
				id: "tool-call-1",
				function: { name: "read_file", arguments: "{}" },
				type: "function",
			},
		]
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					id: mockOptions.apiModelId,
					choices: [{ delta: { tool_calls: toolCalls } }],
				}
			},
		}

		const mockCreate = vitest.fn().mockResolvedValue(mockStream)

		;(OpenAI as any).prototype.chat = {
			completions: { create: mockCreate },
		} as any

		const systemPrompt = "test system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]
		const metadata: ApiHandlerCreateMessageMetadata = {
			taskId: "test-task-id",
			tools: ["read_file"],
			toolArgs: {} as any,
		}

		const generator = handler.createMessage(systemPrompt, messages, metadata)
		const chunks = []
		for await (const chunk of generator) {
			chunks.push(chunk)
		}

		expect(chunks).toContainEqual({
			type: "tool_call",
			toolCalls,
			toolCallType: "openai",
		})
	})

	it("should handle DeepSeek R1 reasoning format with tool calls", async () => {
		const handler = new ChutesHandler(mockOptions)

		// Mock the model to be DeepSeek R1
		vitest.spyOn(handler, "getModel").mockReturnValue({
			id: "deepseek-ai/DeepSeek-R1",
			info: { maxTokens: 32768, temperature: 0.6 },
		} as any)

		const toolCalls = [
			{
				index: 0,
				id: "tool-call-1",
				function: { name: "read_file", arguments: "{}" },
				type: "function",
			},
		]

		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					choices: [{ delta: { content: "<think>Let me think about this tool call" } }],
				}
				yield {
					choices: [{ delta: { content: "</think>" } }],
				}
				yield {
					choices: [{ delta: { tool_calls: toolCalls } }],
				}
				yield {
					choices: [{ delta: {} }],
					usage: { prompt_tokens: 15, completion_tokens: 8 },
				}
			},
		}

		const mockCreate = vitest.fn().mockResolvedValue(mockStream)

		;(OpenAI as any).prototype.chat = {
			completions: { create: mockCreate },
		} as any

		const systemPrompt = "test system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]
		const metadata: ApiHandlerCreateMessageMetadata = {
			taskId: "test-task-id",
			tools: ["read_file"],
			toolArgs: {} as any,
		}

		const generator = handler.createMessage(systemPrompt, messages, metadata)
		const chunks = []
		for await (const chunk of generator) {
			chunks.push(chunk)
		}

		expect(chunks).toContainEqual({
			type: "reasoning",
			text: "Let me think about this tool call",
		})
		expect(chunks).toContainEqual({
			type: "tool_call",
			toolCalls,
			toolCallType: "openai",
		})
		expect(chunks).toContainEqual({
			type: "usage",
			inputTokens: 15,
			outputTokens: 8,
		})
	})

	it("should not include tool parameters when no tools are provided", async () => {
		const handler = new ChutesHandler(mockOptions)

		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					id: mockOptions.apiModelId,
					choices: [{ delta: { content: "test response" } }],
				}
			},
		}

		const mockCreate = vitest.fn().mockResolvedValue(mockStream)

		;(OpenAI as any).prototype.chat = {
			completions: { create: mockCreate },
		} as any

		const systemPrompt = "test system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]

		// No metadata provided
		const generator = handler.createMessage(systemPrompt, messages)
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.not.objectContaining({
				tools: expect.any(Array),
				tool_choice: expect.any(String),
			}),
		)
	})

	it("should handle multiple tool calls in a single response", async () => {
		const handler = new ChutesHandler(mockOptions)
		const toolCalls = [
			{
				index: 0,
				id: "tool-call-1",
				function: { name: "read_file", arguments: '{"path": "test.txt"}' },
				type: "function",
			},
			{
				index: 1,
				id: "tool-call-2",
				function: { name: "write_to_file", arguments: '{"path": "output.txt", "content": "hello"}' },
				type: "function",
			},
		]
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					id: mockOptions.apiModelId,
					choices: [{ delta: { tool_calls: toolCalls } }],
				}
			},
		}

		const mockCreate = vitest.fn().mockResolvedValue(mockStream)

		;(OpenAI as any).prototype.chat = {
			completions: { create: mockCreate },
		} as any

		const systemPrompt = "test system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]
		const metadata: ApiHandlerCreateMessageMetadata = {
			taskId: "test-task-id",
			tools: ["read_file", "write_to_file"],
			toolArgs: {} as any,
		}

		const generator = handler.createMessage(systemPrompt, messages, metadata)
		const chunks = []
		for await (const chunk of generator) {
			chunks.push(chunk)
		}

		expect(chunks).toContainEqual({
			type: "tool_call",
			toolCalls,
			toolCallType: "openai",
		})
	})
})
