type AskBody = {
  question?: string;
  filename?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AskBody;

    const question = body.question?.trim();
    const filename = body.filename?.trim();

    if (!question) {
      return Response.json({ ok: false, message: "Soru boş olamaz." }, { status: 400 });
    }

    // Şimdilik sahte cevap:
    const answer =
      `Soru: "${question}"\n\n` +
      `Şimdilik sahte cevap dönüyorum 🙂\n` +
      `Yarın: dokümandan en alakalı parçaları bulup buna göre cevap üreteceğiz.\n\n` +
      `Seçili dosya: ${filename || "yok"}`;

    return Response.json({ ok: true, answer, usedFilename: filename || null });
  } catch (err) {
    return Response.json({ ok: false, message: "Soru işlenirken hata oluştu." }, { status: 500 });
  }
}