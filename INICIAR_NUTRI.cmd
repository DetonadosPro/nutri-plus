@echo off
setlocal
title Nutri+ - Sistema local
cd /d "%~dp0"

echo.
echo ========================================
echo          Iniciando o Nutri+
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado neste computador.
  echo Instale o Node.js 22 ou superior e tente novamente.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem Se as duas partes do Nutri+ ja estiverem saudaveis, apenas abre o programa.
curl.exe --ssl-no-revoke --silent --fail --max-time 3 "https://localhost:3000" >nul 2>nul
if errorlevel 1 goto :iniciar
curl.exe --ssl-no-revoke --silent --fail --max-time 3 "https://localhost:3000/api/health" 2>nul | findstr /C:"\"ok\":true" >nul
if not errorlevel 1 goto :ja_rodando

:iniciar

if not exist "node_modules" (
  echo Preparando o sistema pela primeira vez...
  call npm install
  if errorlevel 1 goto :erro
)

echo Preparando o banco de dados...
call npm run db:setup
if errorlevel 1 goto :erro

echo Preparando a interface...
call npm run build
if errorlevel 1 goto :erro

echo.
echo O navegador abrira automaticamente quando o sistema estiver pronto.
echo No celular conectado ao mesmo Wi-Fi: https://192.168.1.31:3000
echo Para encerrar o Nutri+, feche esta janela ou pressione Ctrl+C.
echo.

start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\open-nutri-when-ready.ps1"
call npm run start:local
exit /b %errorlevel%

:ja_rodando
echo O Nutri+ ja esta em funcionamento.
echo Abrindo o programa no navegador...
start "" "https://localhost:3000"
exit /b 0

:erro
echo.
echo Nao foi possivel iniciar o Nutri+.
echo Consulte o arquivo README.md ou envie uma captura desta janela.
echo.
pause
exit /b 1
