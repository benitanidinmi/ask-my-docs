import fs from "fs/promises";
import path from "path";
import { findBestChunks, splitIntoChunks } from "../lib/text-utils";

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

    const filePath = path.join(process.cwd(), "storage", filename);
    const fileContent = await fs.readFile(filePath, "utf-8");

    const chunks = splitIntoChunks(fileContent);
    const bestChunks = findBestChunks(question, chunks, 3);

    if (bestChunks.length === 0) {
      return Response.json({
        ok: true,
        answer:
          "Soruyla eşleşen güçlü bir bölüm bulamadım. Daha farklı bir soru yazmayı deneyebilirsin.",
        matches: [],
      });
    }

    const answerLines = bestChunks.map(
      (item, i) =>
        `${i + 1}. Parça (puan: ${item.score})\n${item.chunk}`
    );

    return Response.json({
      ok: true,
      answer:
        "Soruna en yakın görünen doküman parçalarını aşağıda buldum:\n\n" +
        answerLines.join("\n\n--------------------\n\n"),
      matches: bestChunks,
    });
  } catch (error) {
    return Response.json(
      { ok: false, message: "Soru işlenirken hata oluştu." },
      { status: 500 }
    );
  }
}