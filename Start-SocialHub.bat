@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env. Open it in Notepad and set APP_PASSWORD before signing in.
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$line=Get-Content '.env' | Where-Object { $_ -match '^APP_PASSWORD=' } | Select-Object -First 1; if (!$line -or $line.Substring(13).Length -lt 16) { exit 1 }"
if errorlevel 1 (
  echo Set APP_PASSWORD to a private password of at least 16 characters in .env, then run this script again.
  notepad .env
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing SocialHub dependencies...
  call npm install --omit=dev
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection and Node.js installation.
    pause
    exit /b 1
  )
)
echo Starting SocialHub. The website will open at http://localhost:3000
call npm start
pause
