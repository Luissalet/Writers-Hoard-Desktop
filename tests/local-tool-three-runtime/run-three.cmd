@echo off
setlocal
cd /d "%~dp0..\.."
node "tests\local-tool-three-runtime\harness.cjs" all
exit /b %errorlevel%
