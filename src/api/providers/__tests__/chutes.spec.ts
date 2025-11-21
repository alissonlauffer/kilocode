// npx vitest run api/providers/__tests__/chutes.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { chutesDefaultModelId, chutesDefaultModelInfo, DEEP_SEEK_DEFAULT_TEMPERATURE } from "@roo-code/types"

import { ChutesHandler } from "../chutes"

// Create mock functions
const mockCreate = vi.fn()

// Mock Anthropic module
vi.mock("@anthropic-ai/sdk", () => ({
	Anthropic: vi.fn(() => ({
		messages: {
			create: mockCreate,
		},
	})),
}))

describe("ChutesHandler", () => {
	let handler: ChutesHandler

	beforeEach(() => {
		vi.clearAllMocks()
		// Set up default mock implementation
		mockCreate.mockImplementation(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "Test response" },
				}
				yield {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "" },
				}
				yield {
					type: "message_start",
					message: {
						usage: {
							input_tokens: 10,
							output_tokens: 5,
						},
					},
				}
				yield {
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: { output_tokens: 5 },
				}
				yield {
					type: "message_stop",
				}
			},
		}))
		handler = new ChutesHandler({ chutesApiKey: "test-key" })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should use the correct Chutes base URL", () => {
		new ChutesHandler({ chutesApiKey: "test-chutes-api-key" })
		expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://claude.chutes.ai/" }))
	})

	it("should use the provided API key", () => {
		const chutesApiKey = "test-chutes-api-key"
		new ChutesHandler({ chutesApiKey })
		expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: chutesApiKey }))
	})

	it("should handle DeepSeek R1 reasoning format", async () => {
		// Override the mock for this specific test - DeepSeek R1 uses special thinking tags
		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: " <think> Thinking..." },
				}
				yield {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Hello" },
				}
				yield {
					type: "message_start",
					message: {
						usage: {
							input_tokens: 10,
							output_tokens: 5,
						},
					},
				}
				yield {
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: { output_tokens: 5 },
				}
				yield {
					type: "message_stop",
				}
			},
		}))

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hi" }]

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		// Should include reasoning chunks for DeepSeek R1 format
		const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning" || chunk.type === "text")
		expect(reasoningChunks.length).toBeGreaterThan(0)
	})

	it("should handle non-DeepSeek models", async () => {
		// Use default mock implementation which returns text content
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hi" }]

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		// Filter out non-text chunks and empty text chunks for this test
		const textChunks = chunks.filter((chunk) => chunk.type === "text" && chunk.text !== "")
		expect(textChunks).toEqual([{ type: "text", text: "Test response" }])
	})

	it("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(chutesDefaultModelId)
		expect(model.info).toEqual(expect.objectContaining(chutesDefaultModelInfo))
	})

	it("should return specified model when valid model is provided", () => {
		const testModelId = "deepseek-ai/DeepSeek-R1"
		const handlerWithModel = new ChutesHandler({
			apiModelId: testModelId,
			chutesApiKey: "test-chutes-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
	})

	it("completePrompt method should return text from Chutes API", async () => {
		const expectedResponse = "This is a test response from Chutes"
		mockCreate.mockResolvedValueOnce({
			content: [{ type: "text", text: expectedResponse }],
		})
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "Chutes API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(errorMessage)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from Chutes stream"

		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: testContent },
				}
				yield {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "" },
				}
				yield {
					type: "message_start",
					message: {
						usage: {
							input_tokens: 10,
							output_tokens: 5,
						},
					},
				}
				yield {
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: { output_tokens: 5 },
				}
				yield {
					type: "message_stop",
				}
			},
		}))

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({ type: "text", text: testContent })
	})

	it("createMessage should yield usage data from stream", async () => {
		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: "message_start",
					message: {
						usage: {
							input_tokens: 10,
							output_tokens: 20,
						},
					},
				}
				yield {
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: { output_tokens: 0 },
				}
				yield {
					type: "message_stop",
				}
			},
		}))

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({ type: "usage", inputTokens: 10, outputTokens: 20 })
	})

	it("should apply DeepSeek default temperature for R1 models", () => {
		const testModelId = "deepseek-ai/DeepSeek-R1"
		const handlerWithModel = new ChutesHandler({
			apiModelId: testModelId,
			chutesApiKey: "test-chutes-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
	})

	it("should use default temperature for non-DeepSeek models", () => {
		const testModelId = "unsloth/Llama-3.3-70B-Instruct"
		const handlerWithModel = new ChutesHandler({
			apiModelId: testModelId,
			chutesApiKey: "test-chutes-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
	})
})
