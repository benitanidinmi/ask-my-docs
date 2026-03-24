export function normalizeText(text: string) {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitIntoChunks(text: string, minLength = 120) {
  const rawParagraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let buffer = "";

  for (const paragraph of rawParagraphs) {
    if (buffer.length === 0) {
      buffer = paragraph;
      continue;
    }

    if (buffer.length < minLength) {
      buffer += "\n\n" + paragraph;
    } else {
      chunks.push(buffer);
      buffer = paragraph;
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer);
  }

  return chunks;
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