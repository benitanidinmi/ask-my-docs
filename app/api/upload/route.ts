export const runtime = "nodejs";
import { splitIntoChunks } from "../lib/text-utils";

const MAX_FILE_SIZE = 100_000;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return Response.json(
        { ok: false, message: "Dosya bulunamadı." },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith(".txt")) {
      return Response.json(
        { ok: false, message: "Şimdilik sadece .txt dosyaları destekleniyor." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { ok: false, message: "Dosya en fazla 100 KB olabilir." },
        { status: 400 }
      );
    }

    let fileContent: string;

    try {
      fileContent = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer()
      );
    } catch (error) {
      if (error instanceof TypeError) {
        return Response.json(
          { ok: false, message: "Dosya geçerli UTF-8 metin içermelidir." },
          { status: 400 }
        );
      }

      throw error;
    }
    const chunks = splitIntoChunks(fileContent);

    if (chunks.length === 0) {
      return Response.json(
        { ok: false, message: "Dosya boş olamaz." },
        { status: 400 }
      );
    }

    return Response.json({
      ok: true,
      filename: file.name,
      documentText: fileContent,
      message: "Dosya hazırlandı.",
    });
  } catch (error) {
    console.error("Unexpected TXT upload failure:", error);

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
