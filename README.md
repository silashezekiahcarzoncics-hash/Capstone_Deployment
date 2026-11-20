# Saipher CG DSS

Frontend: React 18 + Vite
Backend: Node.js + Express + Multer + SheetJS

Run the frontend and backend in separate terminals from the project root. On Windows, the backend launcher shares Windows' trusted root certificates with Node so Supabase TLS works with local HTTPS inspection enabled.

## Run frontend
```bash
npm install
npm run dev
```

## Run backend
```bash
npm run server
```

On macOS or Linux, run the backend with `node --watch server/server.js`.

The backend serves the API at `http://localhost:4000/api`. The frontend expects this URL by default; override it with `VITE_API_URL` when needed.

### Data Management behavior
- Accepts multiple `.xlsx` / `.xls` files.
- Reads the `orders` worksheet when present.
- Validates core columns.
- Counts transaction rows.
- Detects empty workbooks.
- Captures month/year from `Order Creation Date`.
- Profiles unique products and province-level geography.
- Stores the uploaded raw workbook and an import manifest in `server/data/datasets.json`.
