export const runtime = "nodejs";
import {
  extractImageText,
  ImageValidationError,
  VisionServiceError,
} from "../lib/image-utils";
import { extractPdfText, PdfValidationError } from "../lib/pdf-utils";
import { splitIntoChunks } from "../lib/text-utils";
import type { DocumentKind } from "../lib/types";

const MAX_TXT_SIZE = 100_000;
// Keeps multipart uploads below typical serverless request limits and bounds PDF parsing work.
const MAX_PDF_SIZE = 4_000_000;
const MAX_IMAGE_SIZE = 4_000_000;
const MAX_DOCUMENT_LENGTH = 100_000;

const imageMimeTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

function validationError(code: string, message: string) {
  return Response.json({ ok: false, code, message }, { status: 400 });
}

function serverError(code: string, message: string) {
  return Response.json({ ok: false, code, message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return validationError("FILE_MISSING", "Dosya bulunamadı.");
    }

    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];

    const isImage = extension ? imageMimeTypes.has(extension) : false;

    if (extension !== ".txt" && extension !== ".pdf" && !isImage) {
      return validationError(
        "UNSUPPORTED_FILE_TYPE",
        "Sadece TXT, PDF, PNG, JPG/JPEG ve WEBP dosyaları destekleniyor."
      );
    }

    const expectedImageMime = extension ? imageMimeTypes.get(extension) : undefined;
    const allowedMimeTypes = expectedImageMime
      ? new Set([expectedImageMime])
      : extension === ".pdf"
        ? new Set(["", "application/pdf", "application/octet-stream"])
        : new Set(["", "text/plain", "application/octet-stream"]);

    if (!allowedMimeTypes.has(file.type.toLowerCase())) {
      return validationError(
        "INVALID_MIME_TYPE",
        "Dosya türü, dosya uzantısıyla eşleşmiyor."
      );
    }

    const sizeLimit = isImage
      ? MAX_IMAGE_SIZE
      : extension === ".pdf"
        ? MAX_PDF_SIZE
        : MAX_TXT_SIZE;

    if (file.size === 0) {
      return validationError("EMPTY_FILE", "Dosya boş olamaz.");
    }

    if (file.size > sizeLimit) {
      const limitMessage = extension === ".txt" ? "100 KB" : "4 MB";
      return validationError(
        "FILE_TOO_LARGE",
        `Dosya en fazla ${limitMessage} olabilir.`
      );
    }

    const bytes = await file.arrayBuffer();
    let fileContent: string;
    let documentKind: DocumentKind;

    if (isImage && expectedImageMime) {
      documentKind = "image";
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        return serverError(
          "VISION_NOT_CONFIGURED",
          "Görsel işleme servisi yapılandırılmamış."
        );
      }

      try {
        fileContent = await extractImageText(bytes, expectedImageMime, apiKey);
      } catch (error) {
        if (error instanceof ImageValidationError) {
          return validationError(error.code, error.message);
        }

        if (error instanceof VisionServiceError) {
          return serverError(
            "VISION_PROCESSING_FAILED",
            "Görsel şu anda işlenemedi. Lütfen tekrar deneyin."
          );
        }

        throw error;
      }
    } else if (extension === ".pdf") {
      documentKind = "pdf";
      try {
        fileContent = await extractPdfText(bytes);
      } catch (error) {
        if (error instanceof PdfValidationError) {
          return validationError(error.code, error.message);
        }

        throw error;
      }
    } else {
      documentKind = "txt";
      try {
        fileContent = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (error) {
        if (error instanceof TypeError) {
          return validationError(
            "INVALID_TEXT_ENCODING",
            "Dosya geçerli UTF-8 metin içermelidir."
          );
        }

        throw error;
      }
    }

    const chunks = splitIntoChunks(fileContent);

    if (chunks.length === 0) {
      return validationError(
        extension === ".pdf" ? "PDF_TEXT_NOT_FOUND" : "EMPTY_FILE",
        extension === ".pdf"
          ? "Bu PDF taranmış görünüyor veya çıkarılabilir metin içermiyor."
          : "Dosya boş olamaz."
      );
    }

    if (fileContent.length > MAX_DOCUMENT_LENGTH) {
      return validationError(
        "DOCUMENT_TEXT_TOO_LARGE",
        "Çıkarılan doküman metni 100.000 karakter sınırını aşıyor."
      );
    }

    return Response.json({
      ok: true,
      filename: file.name,
      documentText: fileContent,
      documentKind,
      message: "Dosya hazırlandı.",
    });
  } catch (error) {
    console.error("Unexpected document upload failure:", error);

    return Response.json(
      {
        ok: false,
        code: "UPLOAD_FAILED",
        message: "Upload sırasında beklenmeyen bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}
