@echo off
cd /d "%~dp0"
start "" http://localhost:8420
python -m http.server 8420 --directory public
