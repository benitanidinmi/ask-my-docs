export function normalizeText(text: string) {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitIntoChunks(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines;
}

export function scoreChunk(question: string, chunk: string) {
  const normalizedQuestion = normalizeText(question);
  const normalizedChunk = normalizeText(chunk);

  const questionWords = normalizedQuestion
    .split(" ")
    .filter((word) => word.length > 1);

  let score = 0;

  for (const word of questionWords) {
    if (normalizedChunk.includes(word)) {
      score += 1;
    }
  }

  return score;
}

export function findBestChunks(question: string, chunks: string[], topK = 3) {
  const scored = chunks.map((chunk, index) => ({
    index,
    chunk,
    score: scoreChunk(question, chunk),
  }));

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}