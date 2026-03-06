@echo off
echo Starting X Campus Sync...
pm2 start src\server.js --name "calendar-sync" 2>nul || pm2 restart calendar-sync
timeout /t 3 /nobreak >nul
echo Server is running at http://localhost:3000
start http://localhost:3000
