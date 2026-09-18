Qullamaggie Dashboard — Windows Desktop Package
===============================================

QUICK START
  1. Unzip QullamaggieDashboard-win.zip to your Desktop
     (or any folder), keeping the folder structure intact.
  2. Double-click QullamaggieDashboard.exe
  3. Your browser opens to http://127.0.0.1:5173/
     (or :17865 if 5173 is already in use).

FINNHUB API KEY
  Edit the .env file next to the .exe and set:
    FINNHUB_API_KEY=your_key_here
  Get a free key at https://finnhub.io/
  The key stays on your PC — it is never sent to the browser bundle.
  Without a key, the app still tries Yahoo then Stooq for live data.

REQUIREMENTS
  Windows 10 or 11, 64-bit (x64).
  No Node.js install needed — a private runtime is included.
  Internet access required for live market data.

STOPPING
  Close the QullamaggieDashboard.exe process from Task Manager
  (or end the task if a console was shown). That also stops the
  local server. Closing the browser tab alone does not stop it.

TROUBLESHOOTING
  - If nothing opens, check dashboard-error.log next to the .exe.
  - Ensure Windows Firewall allows local loopback (127.0.0.1).
  - Antivirus may quarantine node.exe on first run — allow it.

DISCLAIMER
  This tool is for personal research and education only.
  It is NOT investment, trading, or financial advice.
  Markets involve risk of loss. Do your own due diligence.

