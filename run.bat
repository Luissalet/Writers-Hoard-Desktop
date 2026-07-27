@echo off
rem Arranca Writers Hoard en modo desktop (Vite + Electron).
rem "call" es obligatorio: npm es npm.cmd y sin call el .bat nunca vuelve.
cd /d "%~dp0"
cls
call npm install
if not exist "node_modules\." (
  echo.
  echo [run.bat] Faltan las dependencias.
  echo Ejecuta setup.bat una vez y vuelve a abrir run.bat.
  pause
  exit /b 1
)

call npm run dev:desktop

rem Si la app termina o falla, deja la ventana abierta para leer la salida.
pause
