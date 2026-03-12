<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# JEE CBT Simulator

Practice JEE-style CBT tests with realistic UI, timed sessions, section-wise palettes, and PDF-based question extraction using Gemini.

## Features

- PDF → Questions extraction using Gemini (bounding boxes + answers)
- JEE Main / Advanced scoring logic
- Timer, question palette, and section navigation
- Demo mode (no PDF needed)
- API key stored locally in browser (optional)
- Dark / light toggle

## Requirements

- Node.js 18+
- A Google Gemini API key

## Quick Start (Local)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the dev server:
   ```bash
   npm run dev
   ```
3. Open the URL printed by Vite.

## API Key Setup

Choose one of these:

- **Browser prompt (recommended)**: Click `Set / Change Key` in the app and paste your key. It’s stored in `localStorage`.
- **.env file**: Create a `.env` at the project root:
  ```env
  VITE_GEMINI_API_KEY=YOUR_KEY_HERE
  ```
  Then restart `npm run dev`.

## Build

```bash
npm run build
```

Output goes to `dist/`.

## Deploy to Vercel

1. Push the repo to GitHub (make sure `src/` exists in the repo).
2. Import the repo in Vercel.
3. Set:
   - **Framework**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Add env var:
   - `VITE_GEMINI_API_KEY=YOUR_KEY`
5. Deploy.

## Troubleshooting

- **API key not found / INVALID_ARGUMENT**:
  - Make sure you set `VITE_GEMINI_API_KEY` or used the in‑app key prompt.
  - Restart the dev server after changing `.env`.

- **Vercel build fails with `Failed to resolve ./src/main.tsx`**:
  - Ensure these files exist in the repo under `src/`:
    - `src/main.tsx`
    - `src/App.tsx`
    - `src/index.css`
  - Remove duplicate copies from the repo root.

- **Rate limit errors**:
  - Your API tier limits RPM/RPD/TPM. Try fewer requests or a lower‑cost model.

## Project Structure

```
src/
  App.tsx
  main.tsx
  index.css
```

## Security Note

This app uses a client‑side Gemini API key. For production, consider moving API calls to a backend to avoid exposing the key in the browser.
