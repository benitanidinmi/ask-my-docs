import OpenAI from "openai";
import { DocumentChunk, normalizeText } from "./text-utils";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0,
});

export type ScoredChunk = {
  index: number;
  chunk: string;
  score: number;
  page?: number;
};

const MIN_RELATIVE_SCORE = 0.75;

export async function getEmbedding(text: string) {
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    encoding_format: "float",
  });

  return response.data[0].embedding;
}

async function getEmbeddings(texts: string[]) {
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
    encoding_format: "float",
  });

  return response.data.map((item) => item.embedding);
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length) {
    throw new Error("Embedding boyutları eşleşmiyor.");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

export async function findBestChunksByEmbedding(
  question: string,
  chunks: DocumentChunk[],
  topK = 3
): Promise<ScoredChunk[]> {
  const [questionEmbedding, ...chunkEmbeddings] = await getEmbeddings([
    question,
    ...chunks.map((chunk) => chunk.text),
  ]);

  const scoredChunks = chunks.map((chunk, index) => {
    const chunkEmbedding = chunkEmbeddings[index];
    const score = cosineSimilarity(questionEmbedding, chunkEmbedding);

    return {
      index,
      chunk: chunk.text,
      score,
      page: chunk.page,
    };
  });

  const sortedChunks = scoredChunks.sort((a, b) => b.score - a.score);
  const bestScore = sortedChunks[0]?.score ?? 0;
  const selected: ScoredChunk[] = [];

  for (const candidate of sortedChunks) {
    if (bestScore > 0 && candidate.score < bestScore * MIN_RELATIVE_SCORE) {
      continue;
    }

    const candidateWords = new Set(normalizeText(candidate.chunk).split(" "));
    const isNearDuplicate = selected.some((item) => {
      const selectedWords = new Set(normalizeText(item.chunk).split(" "));
      const overlap = [...candidateWords].filter((word) => selectedWords.has(word));
      const unionSize = new Set([...candidateWords, ...selectedWords]).size;
      return unionSize > 0 && overlap.length / unionSize >= 0.85;
    });

    if (!isNearDuplicate) selected.push(candidate);
    if (selected.length === topK) break;
  }

  return selected;
}
