export const runtime = "nodejs";
import { splitIntoChunks } from "../lib/text-utils";

const MAX_FILE_SIZE = 100_000;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
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

    const fileContent = await file.text();
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
  } catch {
    return Response.json(
      { ok: false, message: "Upload sırasında hata oluştu." },
      { status: 500 }
    );
  }
}
