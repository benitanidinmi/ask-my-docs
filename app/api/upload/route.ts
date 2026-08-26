export const runtime = "nodejs";
import { extractPdfText, PdfValidationError } from "../lib/pdf-utils";
import { splitIntoChunks } from "../lib/text-utils";

const MAX_TXT_SIZE = 100_000;
// Keeps multipart uploads below typical serverless request limits and bounds PDF parsing work.
const MAX_PDF_SIZE = 4_000_000;
const MAX_DOCUMENT_LENGTH = 100_000;

function validationError(code: string, message: string) {
  return Response.json({ ok: false, code, message }, { status: 400 });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return validationError("FILE_MISSING", "Dosya bulunamadı.");
    }

    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];

    if (extension !== ".txt" && extension !== ".pdf") {
      return validationError(
        "UNSUPPORTED_FILE_TYPE",
        "Sadece TXT ve PDF dosyaları destekleniyor."
      );
    }

    const allowedMimeTypes =
      extension === ".pdf"
        ? new Set(["", "application/pdf", "application/octet-stream"])
        : new Set(["", "text/plain", "application/octet-stream"]);

    if (!allowedMimeTypes.has(file.type.toLowerCase())) {
      return validationError(
        "INVALID_MIME_TYPE",
        "Dosya türü, dosya uzantısıyla eşleşmiyor."
      );
    }

    const sizeLimit = extension === ".pdf" ? MAX_PDF_SIZE : MAX_TXT_SIZE;

    if (file.size === 0) {
      return validationError("EMPTY_FILE", "Dosya boş olamaz.");
    }

    if (file.size > sizeLimit) {
      const limitMessage = extension === ".pdf" ? "4 MB" : "100 KB";
      return validationError(
        "FILE_TOO_LARGE",
        `Dosya en fazla ${limitMessage} olabilir.`
      );
    }

    const bytes = await file.arrayBuffer();
    let fileContent: string;

    if (extension === ".pdf") {
      try {
        fileContent = await extractPdfText(bytes);
      } catch (error) {
        if (error instanceof PdfValidationError) {
          return validationError(error.code, error.message);
        }

        throw error;
      }
    } else {
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
