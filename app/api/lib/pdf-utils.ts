import { extractText, getDocumentProxy } from "unpdf";
import { normalizeDocumentText } from "./text-utils";

const MAX_PDF_PAGES = 100;

export class PdfValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PdfValidationError";
  }
}

export async function extractPdfText(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  const signature = new TextDecoder("ascii").decode(bytes.slice(0, 5));

  if (signature !== "%PDF-") {
    throw new PdfValidationError("INVALID_PDF", "Dosya geçerli bir PDF değil.");
  }

  let pdf;

  try {
    pdf = await getDocumentProxy(bytes, {
      maxImageSize: 16_777_216,
    });

    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new PdfValidationError(
        "PDF_PAGE_LIMIT_EXCEEDED",
        `PDF en fazla ${MAX_PDF_PAGES} sayfa olabilir.`
      );
    }

    const { text } = await extractText(pdf, { mergePages: true });
    return normalizeDocumentText(text);
  } catch (error) {
    if (error instanceof PdfValidationError) {
      throw error;
    }

    const errorName = error instanceof Error ? error.name : "";
    const userCausedPdfErrors = new Set([
      "InvalidPDFException",
      "MissingPDFException",
      "PasswordException",
      "UnexpectedResponseException",
    ]);

    if (userCausedPdfErrors.has(errorName)) {
      throw new PdfValidationError(
        "PDF_UNREADABLE",
        "PDF okunamadı. Dosya bozuk veya parola korumalı olabilir."
      );
    }

    throw error;
  }
}
