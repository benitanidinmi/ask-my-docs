# Ask My Docs (WIP)

A simple Next.js app where you can upload a document and ask questions about it.

## Current Status (Day 1)
- Basic UI: file picker + question input
- Mock API endpoints:
  - `POST /api/upload` (returns file name)
  - `POST /api/ask` (returns a placeholder answer)

## Current Status (Day 2)
- Uploads and stores `.txt` files
- Splits document text into chunks
- Finds the most relevant text chunks for a given question
- Returns matching sections from the document

## Current Status (Day 3)
- Uploads and stores `.txt` files
- Splits document text into chunks
- Finds the most relevant sections for a question
- Uses AI to generate an answer grounded in the retrieved text
- Shows source snippets under each answer

## Tech Stack
- Next.js (App Router) + TypeScript
- Tailwind CSS

## Getting Started
```bash
npm install
npm run dev