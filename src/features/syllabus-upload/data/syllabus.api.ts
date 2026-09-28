import { SyllabusIngestResponseSchema, type SyllabusIngestResponse } from '@contracts/syllabus.contract';
import { invokeEdgeFunction } from '@shared/api/supabase';

export function ingestSyllabus(uploadId: string, localDate: string): Promise<SyllabusIngestResponse> {
  return invokeEdgeFunction('ingest-syllabus', { uploadId }, SyllabusIngestResponseSchema, {
    // The PDF rarely states the year; the function needs the student's today.
    'x-local-date': localDate,
  });
}
