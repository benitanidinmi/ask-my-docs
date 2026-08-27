"use client";

import { useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import type { AskResult, DocumentKind, SourceEvidence, UploadResult } from "./api/lib/types";

type Notice = { tone: "info" | "success" | "error"; message: string };
const accept = ".txt,.pdf,.png,.jpg,.jpeg,.webp,text/plain,application/pdf,image/png,image/jpeg,image/webp";

function Spinner() { return <span className="spinner" aria-hidden="true" />; }
function UploadIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>; }

function friendlyError(status: number, data: UploadResult | AskResult, fallback: string) {
  if (status === 429) return `Demo usage limit reached.${data.retryAfter ? ` Try again in ${Math.ceil(data.retryAfter / 60)} minute${data.retryAfter > 60 ? "s" : ""}.` : " Please try again shortly."}`;
  if (status === 503) return "The AI service is temporarily unavailable. Please try again shortly.";
  const messages: Record<string, string> = {
    FILE_MISSING: "Choose a file to continue.", UNSUPPORTED_FILE_TYPE: "This file type is not supported.",
    INVALID_MIME_TYPE: "The file content does not match its extension.", EMPTY_FILE: "This file is empty.",
    FILE_TOO_LARGE: "This file exceeds the supported size limit.", PDF_TEXT_NOT_FOUND: "This PDF appears to be scanned or contains no extractable text.",
    DOCUMENT_TEXT_TOO_LARGE: "The extracted document text exceeds 100,000 characters.", INVALID_TEXT_ENCODING: "The TXT file must contain valid UTF-8 text.",
    VISION_PROCESSING_FAILED: "The image could not be analyzed right now. Please try again.", VISION_NOT_CONFIGURED: "Image analysis is temporarily unavailable.",
  };
  return (data.code && messages[data.code]) || fallback;
}

export default function Home() {
  const fileId = useId(), questionId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [askError, setAskError] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [documentKind, setDocumentKind] = useState<DocumentKind>();
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<SourceEvidence[]>([]);
  const [loadingUpload, setLoadingUpload] = useState(false), [loadingAsk, setLoadingAsk] = useState(false), [dragging, setDragging] = useState(false);
  const canAsk = useMemo(() => documentText.length > 0 && question.trim().length > 0, [documentText, question]);
  const busy = loadingUpload || loadingAsk;

  function selectFile(next: File | null) {
    setFile(next); setDocumentText(""); setDocumentKind(undefined); setAnswer(""); setSources([]); setAskError("");
    setNotice(next ? { tone: "info", message: `${next.name} is ready to upload.` } : null);
  }
  function fileChange(e: ChangeEvent<HTMLInputElement>) { selectFile(e.target.files?.[0] ?? null); }
  function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false); if (busy) return;
    const next = e.dataTransfer.files?.[0]; if (!next) return; selectFile(next);
    if (fileRef.current) { const dt = new DataTransfer(); dt.items.add(next); fileRef.current.files = dt.files; }
  }

  async function handleUpload() {
    if (!file || loadingUpload) { setNotice({ tone: "error", message: "Choose a file to continue." }); return; }
    setLoadingUpload(true); setNotice(null); setAnswer(""); setSources([]); setAskError("");
    try {
      const body = new FormData(); body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body }); const data = await res.json() as UploadResult;
      if (!res.ok || !data.ok) { setNotice({ tone: "error", message: friendlyError(res.status, data, "The document could not be prepared.") }); return; }
      if (!data.documentText) { setNotice({ tone: "error", message: "No readable content was found in this file." }); return; }
      setDocumentText(data.documentText); setDocumentKind(data.documentKind); setNotice({ tone: "success", message: `${data.filename ?? file.name} is ready for questions.` });
    } catch { setNotice({ tone: "error", message: "The upload could not be completed. Check your connection and try again." }); }
    finally { setLoadingUpload(false); }
  }

  async function handleAsk() {
    if (!canAsk || loadingAsk) return;
    setLoadingAsk(true); setAnswer(""); setSources([]); setAskError("");
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, documentText, documentKind }) });
      const data = await res.json() as AskResult;
      if (!res.ok || !data.ok) { setAskError(friendlyError(res.status, data, "An answer could not be generated. Please try again.")); return; }
      setAnswer(data.answer || ""); setSources(data.sources || []);
    } catch { setAskError("The request could not be completed. Check your connection and try again."); }
    finally { setLoadingAsk(false); }
  }

  function questionKey(e: KeyboardEvent<HTMLTextAreaElement>) { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canAsk && !loadingAsk) { e.preventDefault(); void handleAsk(); } }
  const uploadLabel = file?.type.startsWith("image/") ? "Analyzing image..." : "Preparing document...";

  return <div className="app-shell">
    <header className="site-header"><div className="page-width header-inner"><a href="#main-content" className="brand" aria-label="Ask My Docs home"><span className="brand-mark" aria-hidden="true">A</span><span>Ask My Docs</span></a><span className="demo-badge">AI Document Assistant</span></div></header>
    <main id="main-content" className="page-width main-content">
      <div className="intro"><p className="eyebrow">Grounded answers, clear evidence</p><h1>Ask questions about documents, PDFs and screenshots.</h1><p>Upload a file, ask a question, and get a concise answer supported by passages from your document.</p></div>
      <div className="workflow">
        <section className="panel" aria-labelledby="upload-heading">
          <Heading number="1" id="upload-heading" title="Upload a document" copy="Choose the source you want to ask about." />
          <div className={`dropzone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`} onDragEnter={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragOver={e => e.preventDefault()} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={drop}>
            <input ref={fileRef} id={fileId} type="file" accept={accept} onChange={fileChange} disabled={busy} className="sr-only" />
            <span className="upload-icon"><UploadIcon /></span><div className="dropzone-copy"><p>{file ? file.name : "Drop a file here, or choose from your device"}</p><span>TXT · PDF · PNG · JPG · WEBP</span></div>
            <label htmlFor={fileId} className={`secondary-button${busy ? " is-disabled" : ""}`}>{file ? "Change file" : "Choose file"}</label>
          </div>
          <div className="action-row"><p>TXT up to 100 KB · PDF and images up to 4 MB</p><button type="button" onClick={handleUpload} disabled={busy || !file} className="primary-button">{loadingUpload && <Spinner />}{loadingUpload ? uploadLabel : documentText ? "Upload again" : "Upload"}</button></div>
          <div aria-live="polite" aria-atomic="true">{loadingUpload && <Notice tone="info" message={uploadLabel} loading />}{!loadingUpload && notice && <Notice {...notice} />}</div>
        </section>
        <section className="panel" aria-labelledby="question-heading">
          <Heading number="2" id="question-heading" title="Ask a question" copy="Answers are limited to information found in your file." />
          <label htmlFor={questionId} className="field-label">Your question</label>
          <textarea id={questionId} value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} onKeyDown={questionKey} placeholder="Ask something about the uploaded document..." disabled={busy} className="question-input" />
          <div className="action-row question-row"><p><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd> to ask</p><button type="button" onClick={handleAsk} disabled={busy || !canAsk} className="ask-button">{loadingAsk && <Spinner />}{loadingAsk ? "Searching document..." : "Ask"}</button></div>
          <div aria-live="assertive">{askError && <Notice tone="error" message={askError} />}</div>
        </section>
        <section className="answer-section" aria-labelledby="answer-heading">
          <Heading number="3" id="answer-heading" title="Answer and evidence" copy="Your result will appear here." />
          {loadingAsk ? <div className="answer-card answer-loading" role="status"><i className="skeleton short" /><i className="skeleton" /><i className="skeleton medium" /><span className="sr-only">Searching your document for an answer.</span></div> : answer ? <div className="answer-card">
            <div className="answer-meta"><span className="answer-label">Answer</span><span className="grounded-badge"><b aria-hidden="true">✓</b>Based on your document</span></div><p className="answer-text">{answer}</p>
            {sources.length > 0 && <details className="evidence"><summary><span>Evidence from your document</span><span className="source-count">{sources.length} source{sources.length === 1 ? "" : "s"}</span></summary><div className="source-list">{sources.map(source => <article key={source.id} className="source-card"><p>{source.label}</p><blockquote>{source.excerpt}</blockquote></article>)}</div></details>}
          </div> : <div className="empty-state"><span aria-hidden="true">?</span><p>Upload a document and ask a question to see a grounded answer with supporting evidence.</p></div>}
        </section>
      </div>
    </main>
    <footer className="site-footer"><div className="page-width footer-inner"><p>Built with Next.js, OpenAI and Vercel</p><p>Public demo usage is rate limited.</p></div></footer>
  </div>;
}

function Heading({ number, id, title, copy }: { number: string; id: string; title: string; copy: string }) { return <div className="section-heading"><span className="step-number" aria-hidden="true">{number}</span><div><h2 id={id}>{title}</h2><p>{copy}</p></div></div>; }
function Notice({ tone, message, loading = false }: Notice & { loading?: boolean }) { return <div className={`notice ${tone}-notice`} role={tone === "error" ? "alert" : "status"}>{loading ? <Spinner /> : <span className="notice-dot" aria-hidden="true" />}{message}</div>; }
