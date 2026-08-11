@echo off
REM ===================================================
REM Vinyl Hunter OS - Cloudflare Worker 部署脚本
REM ===================================================
REM 使用方法：
REM   deploy.bat login     - 登录 Cloudflare（首次）
REM   deploy.bat secret    - 设置 DeepSeek API Key（首次）
REM   deploy.bat deploy    - 部署 Worker
REM   deploy.bat dev       - 本地测试（可选）
REM ===================================================

set NODE_EXE=C:\Users\25121\.workbuddy\binaries\node\versions\22.22.2\node.exe
set WRANGLER=%~dp0node_modules\wrangler\bin\wrangler.js

if "%1"=="login" (
    echo === 登录 Cloudflare（浏览器会弹出授权页面）===
    "%NODE_EXE%" "%WRANGLER%" login
    goto :end
)

if "%1"=="secret" (
    echo === 设置 DeepSeek API Key ===
    echo 粘贴你的 DeepSeek API Key（sk-开头），按回车确认：
    echo.
    "%NODE_EXE%" "%WRANGLER%" secret put DEEPSEEK_API_KEY
    goto :end
)

if "%1"=="deploy" (
    echo === 部署 Worker 到 Cloudflare ===
    "%NODE_EXE%" "%WRANGLER%" deploy
    goto :end
)

if "%1"=="dev" (
    echo === 启动本地测试（访问 http://localhost:8787）===
    "%NODE_EXE%" "%WRANGLER%" dev
    goto :end
)

echo 用法：
echo   deploy.bat login    - 登录 Cloudflare（首次必须）
echo   deploy.bat secret   - 设置 DeepSeek API Key（首次必须）
echo   deploy.bat deploy   - 部署到云端
echo   deploy.bat dev      - 本地测试（可选）

:end
