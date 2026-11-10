@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js nao encontrado. Instale o Node.js para iniciar o QRIE.
    pause
    exit /b 1
)
echo Mantenha esta janela aberta durante o teste.
node server.mjs --open
if errorlevel 1 pause
