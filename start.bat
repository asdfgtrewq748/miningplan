@echo off
chcp 65001 >nul 2>&1
title MiningPlan - Startup

echo ============================================
echo   MiningPlan - Smart Mining Design System
echo ============================================
echo.

set "ROOT=%~dp0mining-plan"

:: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.8+
    pause
    exit /b 1
)

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 18+
    pause
    exit /b 1
)

echo [1/4] Installing backend dependencies...
cd /d "%ROOT%\backend_python"
pip install -r requirements.txt -q

echo [2/4] Installing frontend dependencies...
cd /d "%ROOT%\frontend"
if not exist "node_modules" (
    echo       First install, may take a few minutes...
    npm install
) else (
    echo       Dependencies already installed, skipping.
)

echo [3/4] Starting backend on port 3001...
cd /d "%ROOT%\backend_python"
start "Backend-FastAPI" cmd /k "python main.py"

echo [4/4] Starting frontend on port 5173...
cd /d "%ROOT%\frontend"
start "Frontend-Vite" cmd /k "npm run dev"

echo.
echo ============================================
echo   Started!
echo   Frontend:    http://localhost:5173
echo   Backend:     http://localhost:3001
echo   API Docs:    http://localhost:3001/docs
echo ============================================
echo.
echo Press any key to exit (services will keep running)...
pause >nul
