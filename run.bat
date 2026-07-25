@echo off
rem Arranca Writers Hoard en modo desktop (Vite + Electron).
rem "call" es obligatorio: npm es npm.cmd y sin call el .bat nunca vuelve.
cd /d "%~dp0"
cls

call npm install
if errorlevel 1 (
  echo.
  echo [run.bat] npm install fallo - revisa los errores de arriba.
  pause
  exit /b 1
)

call npm run dev:desktop

rem Si la app termina o falla, deja la ventana abierta para leer la salida.
pause
