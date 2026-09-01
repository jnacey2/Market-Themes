import Anthropic from "@anthropic-ai/sdk";
import type {
  BatchCreateParams,
  MessageBatch,
  MessageBatchIndividualResponse
} from "@anthropic-ai/sdk/resources/messages";

export type AnthropicBatchRequest = BatchCreateParams.Request;
export type AnthropicBatchProviderRecord = MessageBatch;
export type AnthropicBatchResult = MessageBatchIndividualResponse;

export type AnthropicBatchApi = {
  create(requests: AnthropicBatchRequest[]): Promise<AnthropicBatchProviderRecord>;
  retrieve(batchId: string): Promise<AnthropicBatchProviderRecord>;
  results(batchId: string): Promise<AsyncIterable<AnthropicBatchResult>>;
};

export function createAnthropicBatchApi(
  apiKey = process.env.ANTHROPIC_API_KEY
): AnthropicBatchApi {
  const client = new Anthropic({ apiKey });
  return {
    create: (requests) => client.messages.batches.create({ requests }),
    retrieve: (batchId) => client.messages.batches.retrieve(batchId),
    results: async (batchId) => client.messages.batches.results(batchId)
  };
}

export function providerBatchState(batch: AnthropicBatchProviderRecord) {
  return {
    id: batch.id,
    processingStatus: batch.processing_status,
    processingCount: batch.request_counts.processing,
    succeededCount: batch.request_counts.succeeded,
    erroredCount: batch.request_counts.errored,
    canceledCount: batch.request_counts.canceled,
    expiredCount: batch.request_counts.expired,
    expiresAt: batch.expires_at,
    endedAt: batch.ended_at,
    resultsUrl: batch.results_url
  };
}
