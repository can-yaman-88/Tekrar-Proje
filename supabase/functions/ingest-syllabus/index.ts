// POST /functions/v1/ingest-syllabus  { uploadId }
//
// 1. Claim the pending syllabus_uploads row (idempotent).
// 2. Download the PDF from private storage and extract its text.
// 3. LLM structured output → course, week-by-week topics, exams.
// 4. Normalise deterministically (bad dates and duplicates dropped).
// 5. Persist in one transaction via public.apply_syllabus_ingestion.
import {
  SyllabusExtractionSchema,
  SyllabusIngestRequestSchema,
  type SyllabusIngestResponse,
} from '../_shared/contracts/syllabus.contract.ts';
import { getEnv } from '../_shared/env.ts';
import { HttpError, LlmError } from '../_shared/errors.ts';
import { createHandler, jsonResponse, readJson } from '../_shared/http.ts';
import { createLlmProvider } from '../_shared/llm/index.ts';
import { readUserLlmSettings } from '../_shared/user-model.ts';
import { authenticate, createServiceClient } from '../_shared/supabase.ts';
import { mapSyllabus } from './mapper.ts';
import { extractPdfText } from './pdf.ts';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.ts';
import { SyllabusRepository } from './repository.ts';

Deno.serve(
  createHandler('ingest-syllabus', async (req, { log }) => {
    const env = getEnv();
    const service = createServiceClient(env);
    const { userId, userClient } = await authenticate(req, env, service);
    const { uploadId } = SyllabusIngestRequestSchema.parse(await readJson(req));

    const repo = new SyllabusRepository(service, userClient, userId);
    const upload = await repo.claim(uploadId);
    log.info('claimed', { uploadId, userId });

    try {
      const pdf = await repo.downloadPdf(upload.storagePath);
      const { text, pages } = await extractPdfText(pdf);
      log.info('extracted_text', { pages, chars: text.length });

      const settings = await readUserLlmSettings(service, userId);
      const llm = createLlmProvider(env, settings.model, settings.apiKey);
      const today = SyllabusRepository.today(req.headers.get('x-local-date'));
      const startedAt = performance.now();
      const { data: extraction, model } = await llm.generateStructured({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({ today, filename: upload.filename, text }),
        schema: SyllabusExtractionSchema,
        schemaName: 'syllabus_extraction',
      });
      log.info('parsed', {
        provider: llm.name,
        model,
        ms: Math.round(performance.now() - startedAt),
        topics: extraction.topics.length,
        exams: extraction.exams.length,
      });

      const { payload, warnings } = mapSyllabus(extraction, today);
      if (!payload) throw new LlmError('invalid_output', 'İzlenceden ders bilgisi çıkarılamadı.');

      const applied = await repo.apply(upload.id, model, payload);

      const body: SyllabusIngestResponse = {
        uploadId: upload.id,
        courseId: applied.courseId,
        courseName: payload.course.name,
        topicsAdded: applied.topicsAdded,
        examsAdded: applied.examsAdded,
        warnings,
      };
      return jsonResponse(body);
    } catch (error) {
      const publicError = error instanceof HttpError ? error : error instanceof LlmError ? error.toHttpError() : null;
      await repo.markFailed(upload.id, publicError?.message ?? 'İşlem başarısız oldu. Tekrar dene.');
      throw error;
    }
  }),
);
