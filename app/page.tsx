"use client";

import { useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import type { AskResult, DocumentKind, SourceEvidence, UploadResult } from "./api/lib/types";

type NoticeState = { tone: "info" | "success" | "error"; message: string };
const accept = ".txt,.pdf,.png,.jpg,.jpeg,.webp,text/plain,application/pdf,image/png,image/jpeg,image/webp";

function Spinner() { return <span className="spinner" aria-hidden="true" />; }
function FileIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h6.5L18 8.3v11.95H7V3.75Z M13.5 3.75V8.3H18" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" /></svg>; }
function UploadIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4 4 4M5.5 14.5v4.25h13V14.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>; }
function SunIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></svg>; }
function MoonIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.2 15.2A7.8 7.8 0 0 1 8.8 4.8a7.8 7.8 0 1 0 10.4 10.4Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" /></svg>; }

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

function fileMeta(file: File) {
  const extension = file.name.split(".").pop()?.toUpperCase() || "FILE";
  const size = file.size < 1_000_000 ? `${Math.max(1, Math.round(file.size / 1000))} KB` : `${(file.size / 1_000_000).toFixed(1)} MB`;
  return `${extension} · ${size}`;
}

export default function Home() {
  const fileId = useId(), questionId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [askError, setAskError] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [documentKind, setDocumentKind] = useState<DocumentKind>();
  const [documentReady, setDocumentReady] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<SourceEvidence[]>([]);
  const [loadingUpload, setLoadingUpload] = useState(false), [loadingAsk, setLoadingAsk] = useState(false), [dragging, setDragging] = useState(false);
  const canAsk = useMemo(() => documentReady && question.trim().length > 0 && !loadingAsk, [documentReady, question, loadingAsk]);
  const busy = loadingUpload || loadingAsk;

  function selectFile(next: File | null) {
    setFile(next); setDocumentText(""); setDocumentKind(undefined); setDocumentReady(false); setAnswer(""); setSources([]); setAskError("");
    setNotice(next ? { tone: "info", message: `${next.name} selected` } : null);
  }
  function fileChange(event: ChangeEvent<HTMLInputElement>) { selectFile(event.target.files?.[0] ?? null); }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); if (busy) return;
    const next = event.dataTransfer.files?.[0]; if (!next) return; selectFile(next);
    if (fileRef.current) { const transfer = new DataTransfer(); transfer.items.add(next); fileRef.current.files = transfer.files; }
  }

  async function handleUpload() {
    if (!file || loadingUpload) { setNotice({ tone: "error", message: "Choose a file to continue." }); return; }
    setLoadingUpload(true); setNotice(null); setAnswer(""); setSources([]); setAskError("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      const data = await response.json() as UploadResult;
      if (!response.ok || !data.ok) { setNotice({ tone: "error", message: friendlyError(response.status, data, "The document could not be prepared.") }); return; }
      if (!data.documentText) { setNotice({ tone: "error", message: "No readable content was found in this file." }); return; }
      setDocumentText(data.documentText); setDocumentKind(data.documentKind); setDocumentReady(true);
      setNotice({ tone: "success", message: "Ready for questions" });
    } catch { setNotice({ tone: "error", message: "The upload could not be completed. Check your connection and try again." }); }
    finally { setLoadingUpload(false); }
  }

  async function handleAsk() {
    if (!canAsk || loadingAsk) return;
    setLoadingAsk(true); setAnswer(""); setSources([]); setAskError("");
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, documentText, documentKind }) });
      const data = await response.json() as AskResult;
      if (!response.ok || !data.ok) { setAskError(friendlyError(response.status, data, "An answer could not be generated. Please try again.")); return; }
      setAnswer(data.answer || ""); setSources(data.sources || []);
    } catch { setAskError("The request could not be completed. Check your connection and try again."); }
    finally { setLoadingAsk(false); }
  }

  function questionKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canAsk) { event.preventDefault(); void handleAsk(); }
  }
  const uploadLabel = file?.type.startsWith("image/") ? "Analyzing image..." : "Preparing document...";
  function toggleTheme() {
    const root = document.documentElement;
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    localStorage.setItem("ask-my-docs-theme", nextTheme);
  }

  return <div className="app-shell">
    <header className="app-header">
      <div className="shell header-content">
        <a href="#workspace" className="brand" aria-label="Ask My Docs home"><span className="brand-mark">A</span><span><strong>Ask My Docs</strong><small>AI Document Assistant</small></span></a>
        <div className="header-actions"><p>Grounded answers with clear evidence.</p><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle light and dark theme" title="Toggle light and dark theme"><span className="sun-icon"><SunIcon /></span><span className="moon-icon"><MoonIcon /></span></button></div>
      </div>
    </header>

    <main id="workspace" className="shell workspace">
      <aside className="sidebar" aria-labelledby="document-heading">
        <div className="sidebar-heading"><p className="overline">Document</p><h1 id="document-heading">Your source</h1><p>Upload a document, PDF, image, or screenshot.</p></div>
        <input ref={fileRef} id={fileId} type="file" accept={accept} onChange={fileChange} disabled={busy} className="sr-only" />

        {documentReady && file ? <div className="file-summary">
          <div className="file-row"><span className="file-icon"><FileIcon /></span><div><strong title={file.name}>{file.name}</strong><span>{fileMeta(file)}</span></div></div>
          <label htmlFor={fileId} className={`change-button${busy ? " is-disabled" : ""}`}>Change file</label>
        </div> : <div className={`dropzone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`} onDragEnter={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={drop}>
          <span className="upload-icon"><UploadIcon /></span><p>{file ? file.name : "Drop a file here"}</p><span>{file ? fileMeta(file) : "or choose from your device"}</span>
          <label htmlFor={fileId} className={`choose-button${busy ? " is-disabled" : ""}`}>{file ? "Choose another" : "Choose file"}</label>
        </div>}

        {!documentReady && <button type="button" onClick={handleUpload} disabled={busy || !file} className="upload-button">{loadingUpload && <Spinner />}{loadingUpload ? uploadLabel : "Upload document"}</button>}
        <div aria-live="polite" aria-atomic="true">{loadingUpload && <Status tone="info" message={uploadLabel} loading />}{!loadingUpload && notice && <Status {...notice} />}</div>

        <div className="file-guidance"><p><strong>Supported</strong>TXT · PDF · PNG · JPG · WEBP</p><p><strong>Limits</strong>TXT 100 KB · PDF/images 4 MB</p></div>
        <div className="demo-note"><span aria-hidden="true">i</span><p><strong>Public demo</strong>Usage is rate limited to protect API costs.</p></div>
      </aside>

      <div className="main-workspace">
        <section className="question-panel" aria-labelledby="question-heading">
          <div className="panel-heading"><div><p className="overline">Question</p><h2 id="question-heading">Ask a question</h2></div><span className={`ready-pill${documentReady ? " is-ready" : ""}`}>{documentReady ? "Document ready" : "Upload required"}</span></div>
          <label htmlFor={questionId} className="sr-only">Your question</label>
          <textarea id={questionId} value={question} maxLength={2000} onChange={event => setQuestion(event.target.value)} onKeyDown={questionKey} placeholder="Ask something about the uploaded document..." disabled={busy} className="question-input" />
          <div className="question-actions"><p><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd></p><button type="button" onClick={handleAsk} disabled={!canAsk || loadingUpload} className="ask-button">{loadingAsk && <Spinner />}{loadingAsk ? "Searching..." : "Ask"}</button></div>
          <div aria-live="assertive">{askError && <Status tone="error" message={askError} />}</div>
        </section>

        <section className="answer-panel" aria-labelledby="answer-heading">
          <div className="panel-heading answer-heading"><div><p className="overline">Result</p><h2 id="answer-heading">Answer</h2></div>{answer && <span className="grounded-pill"><span aria-hidden="true">✓</span>Based on your document</span>}</div>
          {loadingAsk ? <div className="answer-loading" role="status"><i className="skeleton short" /><i className="skeleton" /><i className="skeleton medium" /><span className="sr-only">Searching your document for an answer.</span></div> : answer ? <div className="answer-content"><p>{answer}</p>{sources.length > 0 && <details className="evidence"><summary><span>Evidence</span><span className="source-count">{sources.length} source{sources.length === 1 ? "" : "s"}</span></summary><div className="source-list">{sources.map(source => <article key={source.id}><p>{source.label}</p><blockquote>{source.excerpt}</blockquote></article>)}</div></details>}</div> : <div className="empty-state"><span aria-hidden="true">A</span><div><strong>Your answer will appear here.</strong><p>Upload a source and ask a question to get a grounded response with supporting evidence.</p></div></div>}
        </section>
      </div>
    </main>

    <footer className="app-footer"><div className="shell"><p>Built with Next.js, OpenAI and Vercel</p></div></footer>
  </div>;
}

function Status({ tone, message, loading = false }: NoticeState & { loading?: boolean }) {
  return <div className={`status ${tone}-status`} role={tone === "error" ? "alert" : "status"}>{loading ? <Spinner /> : <span className="status-dot" aria-hidden="true">{tone === "success" ? "✓" : ""}</span>}{message}</div>;
}
