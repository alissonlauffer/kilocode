import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { CacheControlEphemeral } from "@anthropic-ai/sdk/resources"

import { type ModelInfo, chutesDefaultModelId, chutesDefaultModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { calculateApiCostAnthropic } from "../../shared/cost"
import { convertOpenAIToolsToAnthropic } from "./kilocode/nativeToolCallHelpers"

export class ChutesHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: Anthropic

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		this.client = new Anthropic({
			baseURL: "https://claude.chutes.ai/",
			apiKey: options.chutesApiKey,
		})
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		let stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>
		const cacheControl: CacheControlEphemeral = { type: "ephemeral" }
		let { id: modelId, maxTokens, temperature, reasoning: thinking } = this.getModel()

		// kilocode_change start
		const tools =
			(metadata?.allowedTools ?? []).length > 0
				? convertOpenAIToolsToAnthropic(metadata?.allowedTools)
				: undefined
		const tool_choice = (tools ?? []).length > 0 ? { type: "auto" as const } : undefined
		// kilocode_change end

		stream = await this.client.messages.create({
			model: modelId,
			max_tokens: maxTokens ?? 8192,
			temperature,
			thinking,
			system: [{ text: systemPrompt, type: "text", cache_control: cacheControl }],
			messages: messages.map((message, index) => {
				// Add cache control to the last user message for caching benefits
				if (index === messages.length - 1 && message.role === "user") {
					return {
						...message,
						content:
							typeof message.content === "string"
								? [{ type: "text", text: message.content, cache_control: cacheControl }]
								: message.content.map((content, contentIndex) =>
										contentIndex === message.content.length - 1
											? { ...content, cache_control: cacheControl }
											: content,
									),
					}
				}
				return message
			}),
			stream: true,
			// kilocode_change start
			tools,
			tool_choice,
			// kilocode_change end
		})

		let inputTokens = 0
		let outputTokens = 0
		let cacheWriteTokens = 0
		let cacheReadTokens = 0

		// kilocode_change start
		let thinkingDeltaAccumulator = ""
		let thinkText = ""
		let thinkSignature = ""
		const lastStartedToolCall = { id: "", name: "", arguments: "" }
		// kilocode_change end

		for await (const chunk of stream) {
			switch (chunk.type) {
				case "message_start": {
					// Tells us cache reads/writes/input/output.
					const {
						input_tokens = 0,
						output_tokens = 0,
						cache_creation_input_tokens,
						cache_read_input_tokens,
					} = chunk.message.usage

					yield {
						type: "usage",
						inputTokens: input_tokens,
						outputTokens: output_tokens,
						cacheWriteTokens: cache_creation_input_tokens || undefined,
						cacheReadTokens: cache_read_input_tokens || undefined,
					}

					inputTokens += input_tokens
					outputTokens += output_tokens
					cacheWriteTokens += cache_creation_input_tokens || 0
					cacheReadTokens += cache_read_input_tokens || 0

					break
				}
				case "message_delta":
					// Tells us stop_reason, stop_sequence, and output tokens
					// along the way and at the end of the message.
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}

					break
				case "message_stop":
					// No usage data, just an indicator that the message is done.
					break
				case "content_block_start":
					switch (chunk.content_block.type) {
						case "thinking":
							// We may receive multiple text blocks, in which
							// case just insert a line break between them.
							if (chunk.index > 0) {
								yield { type: "reasoning", text: "\n" }
							}

							yield { type: "reasoning", text: chunk.content_block.thinking }

							// kilocode_change start
							thinkText = chunk.content_block.thinking
							thinkSignature = chunk.content_block.signature
							if (thinkText && thinkSignature) {
								yield {
									type: "ant_thinking",
									thinking: thinkText,
									signature: thinkSignature,
								}
							}
							// kilocode_change end

							break

						// kilocode_change start
						case "redacted_thinking":
							yield {
								type: "reasoning",
								text: "[Redacted thinking block]",
							}
							yield {
								type: "ant_redacted_thinking",
								data: chunk.content_block.data,
							}
							break
						case "tool_use":
							if (chunk.content_block.id && chunk.content_block.name) {
								lastStartedToolCall.id = chunk.content_block.id
								lastStartedToolCall.name = chunk.content_block.name
								lastStartedToolCall.arguments = ""
							}
							break
						// kilocode_change end

						case "text":
							// We may receive multiple text blocks, in which
							// case just insert a line break between them.
							if (chunk.index > 0) {
								yield { type: "text", text: "\n" }
							}

							yield { type: "text", text: chunk.content_block.text }
							break
					}
					break
				case "content_block_delta":
					switch (chunk.delta.type) {
						case "thinking_delta":
							yield { type: "reasoning", text: chunk.delta.thinking }
							thinkingDeltaAccumulator += chunk.delta.thinking // kilocode_change
							break

						// kilocode_change start
						case "signature_delta":
							if (thinkingDeltaAccumulator && chunk.delta.signature) {
								yield {
									type: "ant_thinking",
									thinking: thinkingDeltaAccumulator,
									signature: chunk.delta.signature,
								}
							}
							break
						case "input_json_delta":
							if (lastStartedToolCall.id && lastStartedToolCall.name && chunk.delta.partial_json) {
								yield {
									type: "native_tool_calls",
									toolCalls: [
										{
											id: lastStartedToolCall?.id,
											function: {
												name: lastStartedToolCall?.name,
												arguments: chunk.delta.partial_json,
											},
										},
									],
								}
							}
							break
						// kilocode_change end

						case "text_delta":
							yield { type: "text", text: chunk.delta.text }
							break
					}

					break
				case "content_block_stop":
					break
			}
		}

		if (inputTokens > 0 || outputTokens > 0 || cacheWriteTokens > 0 || cacheReadTokens > 0) {
			const { totalCost } = calculateApiCostAnthropic(
				this.getModel().info,
				inputTokens,
				outputTokens,
				cacheWriteTokens,
				cacheReadTokens,
			)

			yield {
				type: "usage",
				inputTokens: 0,
				outputTokens: 0,
				totalCost,
			}
		}
	}

	getModel() {
		const modelId = this.options.apiModelId
		let id = modelId || chutesDefaultModelId
		let info: ModelInfo = chutesDefaultModelInfo

		const params = getModelParams({
			format: "anthropic",
			modelId: id,
			model: info,
			settings: this.options,
		})

		return {
			id,
			info,
			...params,
		}
	}

	async completePrompt(prompt: string) {
		let { id: model, temperature } = this.getModel()

		const stream = await this.client.messages.create({
			model,
			max_tokens: 8192,
			thinking: undefined,
			temperature,
			messages: [{ role: "user", content: prompt }],
			stream: true,
		})

		let text = ""
		for await (const chunk of stream) {
			if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
				text += chunk.delta.text
			}
		}

		return text
	}

	/**
	 * Counts tokens for the given content using Anthropic's API
	 *
	 * @param content The content blocks to count tokens for
	 * @returns A promise resolving to the token count
	 */
	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		try {
			// Use the current model
			const { id: model } = this.getModel()

			const response = await this.client.messages.countTokens({
				model,
				messages: [{ role: "user", content: content }],
			})

			return response.input_tokens
		} catch (error) {
			// Log error but fallback to tiktoken estimation
			console.warn("Chutes token counting failed, using fallback", error)

			// Use the base provider's implementation as fallback
			return super.countTokens(content)
		}
	}
}
