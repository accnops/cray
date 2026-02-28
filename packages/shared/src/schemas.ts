import { z } from "zod";

export const RawEventSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  uuid: z.string().optional(),
  parentUuid: z.string().optional(),
  sessionId: z.string().optional(),
  message: z.any().optional(),
  toolUseResult: z.any().optional(),
}).passthrough();

export const UsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
}).passthrough();

export const AssistantMessageSchema = z.object({
  model: z.string().optional(),
  id: z.string().optional(),
  role: z.literal("assistant"),
  content: z.array(z.any()),
  usage: UsageSchema.optional(),
}).passthrough();

export type RawEventInput = z.infer<typeof RawEventSchema>;
export type UsageInput = z.infer<typeof UsageSchema>;
export type AssistantMessageInput = z.infer<typeof AssistantMessageSchema>;
