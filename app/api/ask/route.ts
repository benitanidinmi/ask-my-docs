import OpenAI from "openai";
import { splitDocumentIntoChunks } from "../lib/text-utils";
import { findBestChunksByEmbedding } from "../lib/semantic-search";
import type { DocumentKind, SourceEvidence } from "../lib/types";
import {
  checkAiRateLimit,
  RateLimitUnavailableError,
  rateLimitResponse,
  rateLimitUnavailableResponse,
} from "../lib/rate-limit";

type AskBody = {
  question?: string;
  documentText?: string;
  documentKind?: DocumentKind;
};

const MAX_DOCUMENT_LENGTH = 100_000;
const MAX_QUESTION_LENGTH = 2_000;
const NOT_FOUND_ANSWER = "Bu bilgi dokümanda bulunamadı.";
const MAX_EXCERPT_LENGTH = 700;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0,
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AskBody;

    const question = body.question?.trim();
    const documentText = body.documentText?.trim();

    if (!question) {
      return Response.json(
        { ok: false, message: "Soru boş olamaz." },
        { status: 400 }
      );
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      return Response.json(
        { ok: false, message: "Soru en fazla 2.000 karakter olabilir." },
        { status: 400 }
      );
    }

    if (!documentText) {
      return Response.json(
        { ok: false, message: "Önce bir dosya yüklemelisin." },
        { status: 400 }
      );
    }

    if (documentText.length > MAX_DOCUMENT_LENGTH) {
      return Response.json(
        { ok: false, message: "Doküman en fazla 100 KB olabilir." },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { ok: false, message: "OPENAI_API_KEY eksik." },
        { status: 500 }
      );
    }

    try {
      const rateLimit = await checkAiRateLimit(req);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
    } catch (error) {
      if (error instanceof RateLimitUnavailableError) {
        return rateLimitUnavailableResponse();
      }

      throw error;
    }

    const documentKind = body.documentKind;
    const chunks = splitDocumentIntoChunks(documentText, documentKind);
    const bestChunks = await findBestChunksByEmbedding(question, chunks, 3);

    if (bestChunks.length === 0) {
      return Response.json({
        ok: true,
        answer: NOT_FOUND_ANSWER,
        sources: [],
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
        - Yalnızca aşağıdaki kaynak metinlerde açıkça bulunan bilgilere göre cevap ver.
        - Kaynaklarda bulunmayan bilgileri tahmin etme, tamamlama veya uydurma.
        - Dokümanın kaynak olarak verilmeyen diğer bölümlerini gördüğünü iddia etme.
        - Kaynaklar soruyu yanıtlamak için yeterli değilse yalnızca şu cümleyi yaz:
        "${NOT_FOUND_ANSWER}"
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
      max_completion_tokens: 500,
    });

    const answer =
      completion.choices[0]?.message?.content?.trim() ||
      NOT_FOUND_ANSWER;

    const createExcerpt = (chunk: string) => {
      if (chunk.length <= MAX_EXCERPT_LENGTH) return chunk;

      const questionWords = question
        .toLocaleLowerCase("tr-TR")
        .split(/\s+/)
        .filter((word) => word.length > 2);
      const normalizedChunk = chunk.toLocaleLowerCase("tr-TR");
      const matchIndex = questionWords
        .map((word) => normalizedChunk.indexOf(word))
        .find((index) => index >= 0) ?? 0;
      const start = Math.max(0, matchIndex - 250);
      const end = Math.min(chunk.length, start + MAX_EXCERPT_LENGTH);
      return `${start > 0 ? "…" : ""}${chunk.slice(start, end).trim()}${end < chunk.length ? "…" : ""}`;
    };

    const sources: SourceEvidence[] =
      answer === NOT_FOUND_ANSWER
        ? []
        : bestChunks.map((item, index) => ({
            id: `source-${index + 1}`,
            excerpt: createExcerpt(item.chunk),
            page: item.page,
            label:
              documentKind === "image"
                ? "Image analysis"
                : item.page
                  ? `PDF — Page ${item.page}`
                  : documentKind === "pdf"
                    ? "Relevant PDF passage"
                    : "Relevant passage",
          }));

    return Response.json({
      ok: true,
      answer,
      sources,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      { ok: false, message: "Soru işlenirken hata oluştu." },
      { status: 500 }
    );
  }
}
