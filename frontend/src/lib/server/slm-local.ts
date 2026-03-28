import { GoogleGenerativeAI } from '@google/generative-ai';
import { createSupabaseServiceClient } from '@/lib/server/slm';

type JsonRecord = Record<string, unknown>;

type OcrRow = {
  file_id: string;
  page: number;
  text: string | null;
};

type TrainingDataRow = {
  question: string;
  answer: string;
  file_ids: string[] | null;
  source: string;
};

type ModelRow = {
  id: string;
  version: number;
  status: string;
  training_config: JsonRecord | null;
};

type RankedChunk = {
  fileId: string;
  pages: number[];
  text: string;
  score: number;
};

const DEFAULT_TARGET_PAIRS = 24;
const DEFAULT_TOP_K = 4;
const MAX_CONTEXT_CHARS = 14_000;
const MAX_TRAINING_SNIPPETS = 12;

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function scoreTextMatch(query: string, content: string): number {
  const queryTokens = unique(tokenize(query));
  const contentTokens = new Set(tokenize(content));
  if (queryTokens.length === 0) return 0;
  let matched = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) matched += 1;
  }
  return matched / queryTokens.length;
}

function buildChunks(rows: OcrRow[]): RankedChunk[] {
  const chunks: RankedChunk[] = [];
  const grouped = new Map<string, OcrRow[]>();

  for (const row of rows) {
    if (!row.text?.trim()) continue;
    const key = row.file_id;
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }

  for (const [fileId, pages] of grouped.entries()) {
    const ordered = pages.sort((a, b) => a.page - b.page);
    let currentText = '';
    let currentPages: number[] = [];

    for (const row of ordered) {
      const pageText = row.text?.trim() || '';
      const nextText = currentText ? `${currentText}\n\n${pageText}` : pageText;
      if (nextText.length > 3500 && currentText) {
        chunks.push({ fileId, pages: currentPages, text: currentText, score: 0 });
        currentText = pageText;
        currentPages = [row.page];
      } else {
        currentText = nextText;
        currentPages.push(row.page);
      }
    }

    if (currentText) {
      chunks.push({ fileId, pages: currentPages, text: currentText, score: 0 });
    }
  }

  return chunks;
}

function trimContext(chunks: RankedChunk[], maxChars = MAX_CONTEXT_CHARS): RankedChunk[] {
  const result: RankedChunk[] = [];
  let total = 0;
  for (const chunk of chunks) {
    if (!chunk.text) continue;
    const nextTotal = total + chunk.text.length;
    if (result.length > 0 && nextTotal > maxChars) break;
    result.push(chunk);
    total = nextTotal;
  }
  return result;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseGeneratedPairs(raw: string): Array<{ question: string; answer: string; file_ids?: string[] }> {
  const parsed = safeJsonParse<Array<{ question: string; answer: string; file_ids?: string[] }>>(raw);
  if (!parsed) return [];
  return parsed
    .map((item) => ({
      question: typeof item.question === 'string' ? item.question.trim() : '',
      answer: typeof item.answer === 'string' ? item.answer.trim() : '',
      file_ids: Array.isArray(item.file_ids) ? item.file_ids.filter((value) => typeof value === 'string') : [],
    }))
    .filter((item) => item.question && item.answer);
}

function fallbackTrainingPairs(chunks: RankedChunk[], targetPairs: number) {
  return chunks.slice(0, targetPairs).map((chunk, index) => {
    const excerpt = chunk.text.slice(0, 500).replace(/\s+/g, ' ').trim();
    return {
      question: `What key information appears in document excerpt ${index + 1}?`,
      answer: excerpt,
      file_ids: [chunk.fileId],
    };
  });
}

async function generateTrainingPairsWithGemini(chunks: RankedChunk[], targetPairs: number) {
  const model = getGeminiModel();
  if (!model) return [];

  const snippets = chunks.slice(0, MAX_TRAINING_SNIPPETS).map((chunk, index) => ({
    id: index + 1,
    file_id: chunk.fileId,
    pages: chunk.pages,
    excerpt: chunk.text.slice(0, 2000),
  }));

  const prompt = [
    'You are preparing supervised fine-tuning data for a personal medical-document assistant.',
    `Generate up to ${targetPairs} question/answer pairs grounded only in the excerpts below.`,
    'Requirements:',
    '- Questions should be diverse: factual, summarization, chronology, and cross-reference when possible.',
    '- Answers must stay faithful to the excerpted text and say when information is not present.',
    '- Return strict JSON array only.',
    '- Each item must have question, answer, and file_ids (array of file ids used).',
    JSON.stringify(snippets),
  ].join('\n');

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  return parseGeneratedPairs(text);
}

function buildFewShotExamples(rows: TrainingDataRow[]): string {
  return rows
    .slice(0, 6)
    .map((row, index) => `Example ${index + 1}\nQ: ${row.question}\nA: ${row.answer}`)
    .join('\n\n');
}

function fallbackAnswer(query: string, chunks: RankedChunk[]) {
  if (chunks.length === 0) {
    return {
      answer: 'I could not find relevant document text for that question yet.',
      score: 1.5,
    };
  }

  const top = chunks[0];
  const excerpt = top.text.slice(0, 1400).replace(/\s+/g, ' ').trim();
  const score = Math.min(4.2, 2 + Math.round(top.score * 20) / 10);
  return {
    answer: `Best match for "${query}": ${excerpt}`,
    score,
  };
}

async function generateAnswerWithGemini(query: string, chunks: RankedChunk[], examples: TrainingDataRow[]) {
  const model = getGeminiModel();
  if (!model) return null;

  const context = trimContext(chunks).map((chunk, index) => ({
    chunk: index + 1,
    file_id: chunk.fileId,
    pages: chunk.pages,
    text: chunk.text.slice(0, 2800),
  }));

  const prompt = [
    'You are a medical-document assistant answering only from the provided context.',
    'If the answer is uncertain or missing, say so plainly.',
    'Prefer concise, concrete answers and mention the supporting file ids/pages when helpful.',
    `User question: ${query}`,
    `Training examples:\n${buildFewShotExamples(examples) || 'None available.'}`,
    `Context:\n${JSON.stringify(context)}`,
    'Return strict JSON with keys: answer, confidence.',
  ].join('\n\n');

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const parsed = safeJsonParse<{ answer?: string; confidence?: number }>(text);
  if (!parsed?.answer) return null;
  return {
    answer: parsed.answer.trim(),
    score: typeof parsed.confidence === 'number'
      ? Math.min(5, Math.max(1, parsed.confidence))
      : Math.min(4.6, 2.2 + chunks[0]?.score * 2),
  };
}

async function fetchOcrRows(userId: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('ocr_results')
    .select('file_id, page, text')
    .eq('user_id', userId)
    .order('file_id', { ascending: true })
    .order('page', { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as OcrRow[];
}

async function fetchTrainingRows(userId: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('slm_training_data')
    .select('question, answer, file_ids, source')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data || []) as TrainingDataRow[];
}

async function fetchLatestModels(userId: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('slm_models')
    .select('id, version, status, training_config')
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(10);

  if (error) throw new Error(error.message);
  return (data || []) as ModelRow[];
}

function normalizeTrainingConfig(trainingConfig: JsonRecord | null | undefined, chunkCount: number, pairCount: number): JsonRecord {
  return {
    engine: 'local-gemini-slm',
    chunk_count: chunkCount,
    pair_count: pairCount,
    target_pairs: typeof trainingConfig?.target_pairs === 'number' ? trainingConfig.target_pairs : DEFAULT_TARGET_PAIRS,
    trained_at: new Date().toISOString(),
    ...(trainingConfig || {}),
  };
}

export async function runLocalSlmTraining(options: {
  userId: string;
  force?: boolean;
  trainingConfig?: JsonRecord | null;
}) {
  const supabase = createSupabaseServiceClient();
  const existingModels = await fetchLatestModels(options.userId);
  const trainingModel = existingModels.find((model) => model.status === 'training');
  if (trainingModel && !options.force) {
    throw new Error('Training already in progress.');
  }
  if (trainingModel && options.force) {
    const { error: cancelError } = await supabase
      .from('slm_models')
      .update({
        status: 'failed',
        training_config: {
          ...(trainingModel.training_config || {}),
          superseded_at: new Date().toISOString(),
          superseded_reason: 'Force retrain requested',
        },
      })
      .eq('id', trainingModel.id);

    if (cancelError) throw new Error(cancelError.message);
  }

  const nextVersion = (existingModels[0]?.version || 0) + 1;
  const insertPayload = {
    user_id: options.userId,
    version: nextVersion,
    status: 'training',
    adapter_path: `local://slm/${options.userId}/v${nextVersion}`,
    training_config: options.trainingConfig || {},
  };

  const { data: createdRows, error: insertError } = await supabase
    .from('slm_models')
    .insert(insertPayload)
    .select('id')
    .limit(1);

  if (insertError) throw new Error(insertError.message);

  const modelId = createdRows?.[0]?.id as string | undefined;
  if (!modelId) throw new Error('Failed to create training model record.');

  try {
    const ocrRows = await fetchOcrRows(options.userId);
    const chunks = buildChunks(ocrRows);
    if (chunks.length === 0) {
      throw new Error('No OCR text found for this user.');
    }

    const targetPairs = typeof options.trainingConfig?.target_pairs === 'number'
      ? Math.max(6, Math.min(60, Math.floor(options.trainingConfig.target_pairs)))
      : DEFAULT_TARGET_PAIRS;

    let pairs = await generateTrainingPairsWithGemini(chunks, targetPairs);
    if (pairs.length === 0) {
      pairs = fallbackTrainingPairs(chunks, targetPairs);
    }

    const rowsToInsert = pairs.map((pair) => ({
      user_id: options.userId,
      file_ids: pair.file_ids && pair.file_ids.length > 0 ? pair.file_ids : [],
      question: pair.question,
      answer: pair.answer,
      source: 'gemini_synthetic',
    }));

    if (rowsToInsert.length > 0) {
      const { error: trainingInsertError } = await supabase
        .from('slm_training_data')
        .insert(rowsToInsert);
      if (trainingInsertError) throw new Error(trainingInsertError.message);
    }

    const normalizedConfig = normalizeTrainingConfig(options.trainingConfig || null, chunks.length, rowsToInsert.length);
    const { error: updateError } = await supabase
      .from('slm_models')
      .update({
        status: 'ready',
        training_config: normalizedConfig,
      })
      .eq('id', modelId);

    if (updateError) throw new Error(updateError.message);

    return {
      mode: 'local',
      version: nextVersion,
      chunkCount: chunks.length,
      trainingPairCount: rowsToInsert.length,
      adapterPath: insertPayload.adapter_path,
      status: 'ready',
    };
  } catch (error) {
    await supabase
      .from('slm_models')
      .update({
        status: 'failed',
        training_config: {
          ...(options.trainingConfig || {}),
          failure_reason: error instanceof Error ? error.message : 'Unknown training error',
        },
      })
      .eq('id', modelId);

    throw error;
  }
}

export async function runLocalSlmQuery(options: {
  userId: string;
  query: string;
  topK?: number;
}) {
  const supabase = createSupabaseServiceClient();
  const models = await fetchLatestModels(options.userId);
  const readyModel = models.find((model) => model.status === 'ready');
  if (!readyModel) {
    throw new Error('No ready SLM model found. Train the model first.');
  }

  const ocrRows = await fetchOcrRows(options.userId);
  const chunks = buildChunks(ocrRows)
    .map((chunk) => ({ ...chunk, score: scoreTextMatch(options.query, chunk.text) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score);

  const selectedChunks = chunks.slice(0, Math.max(1, options.topK || DEFAULT_TOP_K));
  const trainingRows = await fetchTrainingRows(options.userId);
  const selectedTrainingRows = trainingRows
    .map((row) => ({
      ...row,
      matchScore: scoreTextMatch(options.query, `${row.question} ${row.answer}`),
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6)
    .map((row) => ({
      question: row.question,
      answer: row.answer,
      file_ids: row.file_ids,
      source: row.source,
    }));

  let answerPayload = await generateAnswerWithGemini(options.query, selectedChunks, selectedTrainingRows);
  if (!answerPayload) {
    answerPayload = fallbackAnswer(options.query, selectedChunks);
  }

  const docRefs = unique(
    selectedChunks.map((chunk) => `${chunk.fileId}:${chunk.pages[0]}-${chunk.pages[chunk.pages.length - 1]}`),
  );

  const { error: feedbackError } = await supabase
    .from('slm_feedback')
    .insert({
      user_id: options.userId,
      query: options.query,
      doc_refs: docRefs,
      responses: [{ answer: answerPayload.answer, source: 'local' }],
      scores: { best_score: Number(answerPayload.score.toFixed(2)) },
      gold_response: null,
      model_version: readyModel.version,
      response_time_ms: null,
      token_count: tokenize(answerPayload.answer).length,
      used_in_training: false,
    });

  if (feedbackError) {
    throw new Error(feedbackError.message);
  }

  return {
    mode: 'local',
    answer: answerPayload.answer,
    best_response: answerPayload.answer,
    confidence: Number(answerPayload.score.toFixed(2)),
    doc_refs: docRefs,
    response_time_ms: null,
    token_count: tokenize(answerPayload.answer).length,
    model_version: readyModel.version,
  };
}
