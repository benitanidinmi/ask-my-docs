export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return Response.json({ ok: false, message: "Dosya bulunamadı." }, { status: 400 });
    }

    // Şimdilik dosyayı kaydetmiyoruz.
    // Sadece "aldım" demek için dosya adını dönüyoruz.
    return Response.json({ ok: true, filename: file.name });
  } catch (err) {
    return Response.json({ ok: false, message: "Upload sırasında hata oluştu." }, { status: 500 });
  }
}