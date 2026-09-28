import { LlmModelsResponseSchema, type LlmModelsResponse } from '@contracts/llm-models.contract';
import { invokeEdgeFunction } from '@shared/api/supabase';

export function fetchLlmModels(test?: string): Promise<LlmModelsResponse> {
  return invokeEdgeFunction('llm-models', test ? { test } : {}, LlmModelsResponseSchema);
}
