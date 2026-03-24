"use client";

import { useMemo, useState } from "react";

type UploadResult = { ok: boolean; filename?: string; message?: string };

type MatchItem = {
  index: number;
  chunk: string;
  score: number;
};

type AskResult = {
  ok: boolean;
  answer?: string;
  usedFilename?: string;
  message?: string;
  matches?: MatchItem[];
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [answer, setAnswer] = useState<string>("");
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [loadingAsk, setLoadingAsk] = useState(false);

  const canAsk = useMemo(() => !!file && question.trim().length > 0, [file, question]);

  async function handleUpload() {
    if (!file) {
      setUploadStatus("Lütfen bir dosya seç.");
      return;
    }

    setLoadingUpload(true);
    setUploadStatus("");
    setAnswer("");
    setMatches([]);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = (await res.json()) as UploadResult;

      if (!res.ok || !data.ok) {
        setUploadStatus(data.message || "Yükleme başarısız.");
        return;
      }

      setUploadStatus(`Yüklendi: ${data.filename}`);
    } catch (e) {
      setUploadStatus("Bir hata oldu (upload).");
    } finally {
      setLoadingUpload(false);
    }
  }

  async function handleAsk() {
    if (!canAsk) return;

    setLoadingAsk(true);
    setAnswer("");
    setMatches([]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          filename: file?.name,
        }),
      });

      const data = (await res.json()) as AskResult;

      if (!res.ok || !data.ok) {
        setAnswer(data.message || "Cevap alınamadı.");
        return;
      }

      setAnswer(data.answer || "");
      setMatches(data.matches || []);
    } catch (e) {
      setAnswer("Bir hata oldu (ask).");
    } finally {
      setLoadingAsk(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Ask My Docs</h1>
        <p className="mt-2 text-zinc-300">
          Dosya seç → yükle → soru sor. Şimdilik sadece .txt destekleniyor ve sistem dokümandan en alakalı parçaları buluyor.
        </p>

        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="text-lg font-medium">1) Doküman ekle</h2>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".txt"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-zinc-100 hover:file:bg-zinc-700"
            />

            <button
              onClick={handleUpload}
              disabled={loadingUpload || !file}
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
            >
              {loadingUpload ? "Yükleniyor..." : "Yükle"}
            </button>
          </div>

          {uploadStatus && (
            <p className="mt-3 text-sm text-zinc-300">
              <span className="text-zinc-400">Durum:</span> {uploadStatus}
            </p>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="text-lg font-medium">2) Soru sor</h2>

          <div className="mt-4 flex flex-col gap-3">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Örn: Bu dokümanda iade koşulları ne?"
              className="min-h-24 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
            />

            <div className="flex items-center gap-3">
              <button
                onClick={handleAsk}
                disabled={loadingAsk || !canAsk}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
              >
                {loadingAsk ? "Soruluyor..." : "Sor"}
              </button>

              <p className="text-xs text-zinc-400">
                İpucu: Dosya seçili olmalı ve soru boş olmamalı.
              </p>
            </div>

            {answer && (
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm font-medium text-zinc-200">Cevap</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{answer}</p>

                {matches.length > 0 && (
                  <div className="mt-5">
                    <p className="text-sm font-medium text-zinc-200">Kaynaklar</p>

                    <div className="mt-3 flex flex-col gap-3">
                      {matches.map((match, idx) => (
                        <div
                          key={`${match.index}-${idx}`}
                          className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
                        >
                          <p className="text-xs text-zinc-400">
                            Parça #{match.index + 1} · Benzerlik: {match.score.toFixed(3)}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
                            {match.chunk}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <footer className="mt-10 text-xs text-zinc-500">
          Gün 1: UI + sahte API. Gün 2: dosyayı kaydetme + dokümandan parça bulma.
        </footer>
      </div>
    </main>
  );
}