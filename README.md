# Ask My Docs (WIP)

A simple Next.js app where you can upload a TXT, text-based PDF, or supported image and ask questions about it.

## Current Status (Day 1)
- Basic UI: file picker + question input
- Mock API endpoints:
  - `POST /api/upload` (returns file name)
  - `POST /api/ask` (returns a placeholder answer)

## Current Status (Day 2)
- Processes `.txt` and text-based `.pdf` files in memory
- Splits document text into chunks
- Finds the most relevant text chunks for a given question
- Returns matching sections from the document

## Current Status (Day 3)
- Processes uploaded document text without persistent filesystem storage
- Splits document text into chunks
- Finds the most relevant sections for a question
- Uses AI to generate an answer grounded in the retrieved text
- Shows source snippets under each answer

## Current Status (Day 4)
- Uses OpenAI embeddings for semantic search
- Retrieves the most relevant document chunks by meaning, not just keyword match
- Generates grounded answers from retrieved sources

## Tech Stack
- Next.js (App Router) + TypeScript
- Tailwind CSS
- `unpdf` for in-memory text extraction from text-based PDFs
- OpenAI vision for in-memory extraction from PNG, JPG/JPEG, and WEBP images

## Upload limits
- TXT: 100 KB and valid UTF-8
- PDF: 4 MB, up to 100 pages, with at most 100,000 extracted characters
- Images: 4 MB, up to 10,000 pixels per side and 20 megapixels total
- Scanned/image-only PDFs require OCR and are not supported yet

## AI rate limiting
- AI operations use Upstash Redis for serverless-safe persistent quotas.
- Defaults: 3 AI operations/minute per visitor, 10/day per visitor, 200/day globally.
- TXT/PDF parsing does not consume AI quota; image vision and `/api/ask` do.
- Required server variables: `RATE_LIMIT_HASH_SALT` plus writable Redis REST credentials. On Vercel, the app prefers the integration-provided `KV_REST_API_URL` / `KV_REST_API_TOKEN` and otherwise uses `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. It never uses the read-only token.
- Optional limit overrides: `AI_BURST_LIMIT`, `AI_DAILY_LIMIT_PER_VISITOR`, and `AI_GLOBAL_DAILY_LIMIT`.
- AI operations fail closed with HTTP 503 when the limiter is missing or unavailable.

## Getting Started
```bash
npm install
npm run dev
