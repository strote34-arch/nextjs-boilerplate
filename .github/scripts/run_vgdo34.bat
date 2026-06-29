@echo off
cd /d C:\afishiru
echo [%date% %time%] Проверка афиши Дом Офицеров vgdo34.ru...
C:\afishiru\python.exe update_vgdo34.py >> C:\afishiru\logs\vgdo34_update.log 2>&1
echo [%date% %time%] Готово.
