import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { splitIntoChunks } from "../lib/text-utils";
import { findBestChunksByEmbedding } from "../lib/semantic-search";

type AskBody = {
  question?: string;
  filename?: string;
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AskBody;

    const question = body.question?.trim();
    const filename = body.filename?.trim();

    if (!question) {
      return Response.json(
        { ok: false, message: "Soru boş olamaz." },
        { status: 400 }
      );
    }

    if (!filename) {
      return Response.json(
        { ok: false, message: "Önce bir dosya yüklemelisin." },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { ok: false, message: "OPENAI_API_KEY eksik." },
        { status: 500 }
      );
    }

    const filePath = path.join(process.cwd(), "storage", filename);
    const fileContent = await fs.readFile(filePath, "utf-8");

    const chunks = splitIntoChunks(fileContent);
    const bestChunks = await findBestChunksByEmbedding(question, chunks, 3);

    if (bestChunks.length === 0) {
      return Response.json({
        ok: true,
        answer: "Bu bilgi dokümanda bulunamadı.",
        matches: [],
      });
    }

    const contextText = bestChunks
      .map((item, index) => {
        return `Kaynak ${index + 1}:\n${item.chunk}`;
      })
      .join("\n\n");

    const prompt = `
        Sen bir doküman destekli yardımcı asistansın.

        Kurallar:
        - Sadece sana verilen kaynak metinlere göre cevap ver.
        - Kaynaklarda olmayan bir bilgiyi uydurma.
        - Eğer cevap açıkça kaynaklarda yoksa sadece şu cümleyi yaz:
        "Bu bilgi dokümanda bulunamadı."
        - Cevabın kısa, net ve sade Türkçe olsun.

        Kullanıcının sorusu:
        ${question}

        Kaynak metinler:
        ${contextText}
        `;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Sen sadece verilen kaynaklara göre cevap veren dikkatli bir asistansın.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    });

    const answer =
      completion.choices[0]?.message?.content?.trim() ||
      "Bu bilgi dokümanda bulunamadı.";

    return Response.json({
      ok: true,
      answer,
      matches: bestChunks,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      { ok: false, message: "Soru işlenirken hata oluştu." },
      { status: 500 }
    );
  }
}