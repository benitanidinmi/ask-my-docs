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

export type DocumentChunk = {
  text: string;
  page?: number;
};

const PDF_PAGE_MARKER = "[[ASK_MY_DOCS_PAGE:";
const PDF_PAGE_PATTERN = /\[\[ASK_MY_DOCS_PAGE:(\d+)\]\]\n?/g;

export function serializePdfPages(pages: string[]) {
  return pages
    .map((text, index) => ({ page: index + 1, text: normalizeDocumentText(text) }))
    .filter((item) => item.text.length > 0)
    .map((item) => `${PDF_PAGE_MARKER}${item.page}]]\n${item.text}`)
    .join("\n\n");
}

export function splitDocumentIntoChunks(
  text: string,
  documentKind?: "txt" | "pdf" | "image"
): DocumentChunk[] {
  if (documentKind !== "pdf" && !text.includes(PDF_PAGE_MARKER)) {
    return splitIntoChunks(text).map((chunk) => ({ text: chunk }));
  }

  const sections: Array<{ page: number; start: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = PDF_PAGE_PATTERN.exec(text)) !== null) {
    sections.push({ page: Number(match[1]), start: PDF_PAGE_PATTERN.lastIndex });
  }
  PDF_PAGE_PATTERN.lastIndex = 0;

  return sections.flatMap((section, index) => {
    const end = index + 1 < sections.length
      ? text.lastIndexOf(PDF_PAGE_MARKER, sections[index + 1].start)
      : text.length;
    const pageText = text.slice(section.start, end).trim();
    return splitIntoChunks(pageText).map((chunk) => ({
      text: chunk,
      page: section.page,
    }));
  });
}

export function normalizeDocumentText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
