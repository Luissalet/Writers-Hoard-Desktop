@echo off
rem Prepara Writers Hoard una vez: dependencias y binarios multimedia.
rem Las ejecuciones normales deben usar run.bat, que no modifica la instalacion.
cd /d "%~dp0"
cls

call npm install
if errorlevel 1 (
  echo.
  echo [setup.bat] npm install fallo - revisa los errores de arriba.
  pause
  exit /b 1
)

call npm run fetch:bin
if errorlevel 1 (
  echo.
  echo [setup.bat] No se pudieron descargar los binarios multimedia.
  pause
  exit /b 1
)

echo.
echo Writers Hoard esta preparado. Usa run.bat para iniciarlo.
pause
