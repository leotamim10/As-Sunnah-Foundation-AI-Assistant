@echo off
REM As-Sunnah Foundation AI Assistant - local demo launcher (needs Docker Desktop running).
cd /d "%~dp0"
echo == As-Sunnah AI Assistant ==
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker isn't running. Please install ^& start Docker Desktop, then run this again:
  echo   https://www.docker.com/products/docker-desktop
  pause
  exit /b 1
)
echo Building ^& starting - the FIRST run downloads the AI model (~5-10 min, needs internet)...
docker compose up --build -d
if errorlevel 1 (
  echo Build/start failed. Is Docker Desktop running?
  pause
  exit /b 1
)
echo Waiting for the app to be ready...
set /a n=0
:wait
timeout /t 3 >nul
curl -s http://localhost:8000/ >nul 2>&1
if not errorlevel 1 goto ready
set /a n+=1
if %n% lss 200 goto wait
:ready
echo Ready! Opening http://localhost:8000
start "" http://localhost:8000
echo To stop later: run stop.bat  (or:  docker compose down)
pause
