@echo off
rem sound-hook-ui one-click remote installer (double-click friendly wrapper).
rem Supports 8 agent tools: kimi / claude / codex / gemini / cursor / continue / deepseek / pi.
rem Downloads and runs install-remote.ps1 from GitHub, same as the one-liner in README.
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/CHERYoung6496/sound-hook-ui/main/install-remote.ps1)"
pause
