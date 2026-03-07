export const runtime = "nodejs";

import fs from "fs/promises";
import path from "path";

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

    if (!file.name.endsWith(".txt")) {
      return Response.json(
        { ok: false, message: "Şimdilik sadece .txt dosyaları destekleniyor." },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const storageDir = path.join(process.cwd(), "storage");
    const filePath = path.join(storageDir, file.name);

    await fs.mkdir(storageDir, { recursive: true });
    await fs.writeFile(filePath, buffer);

    return Response.json({
      ok: true,
      filename: file.name,
      message: "Dosya kaydedildi.",
    });
  } catch (error) {
    return Response.json(
      { ok: false, message: "Upload sırasında hata oluştu." },
      { status: 500 }
    );
  }
}