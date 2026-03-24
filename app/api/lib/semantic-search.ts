import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ScoredChunk = {
  index: number;
  chunk: string;
  score: number;
};

export async function getEmbedding(text: string) {
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    encoding_format: "float",
  });

  return response.data[0].embedding;
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
  chunks: string[],
  topK = 3
): Promise<ScoredChunk[]> {
  const questionEmbedding = await getEmbedding(question);

  const scoredChunks = await Promise.all(
    chunks.map(async (chunk, index) => {
      const chunkEmbedding = await getEmbedding(chunk);
      const score = cosineSimilarity(questionEmbedding, chunkEmbedding);

      return {
        index,
        chunk,
        score,
      };
    })
  );

  return scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}