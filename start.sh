#!/bin/bash
# 智能采掘设计系统 - 一键启动 (Git Bash)

ROOT="$(cd "$(dirname "$0")" && pwd)/mining-plan"

echo "============================================"
echo "  智能采掘设计系统 - 一键启动"
echo "============================================"
echo ""

# 检查 Python
if ! command -v python &> /dev/null; then
    echo "[错误] 未找到 Python，请先安装 Python 3.8+"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请先安装 Node.js 18+"
    exit 1
fi

echo "[1/4] 安装后端依赖..."
cd "$ROOT/backend_python"
pip install -r requirements.txt -q

echo "[2/4] 安装前端依赖..."
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
    echo "      首次安装，可能需要几分钟..."
    npm install
else
    echo "      依赖已存在，跳过安装"
fi

echo "[3/4] 启动后端 (端口 3001)..."
cd "$ROOT/backend_python"
python main.py &
BACKEND_PID=$!

echo "[4/4] 启动前端 (端口 5173)..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "============================================"
echo "  启动完成！"
echo "  前端: http://localhost:5173"
echo "  后端: http://localhost:3001"
echo "  API文档: http://localhost:3001/docs"
echo "============================================"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 捕获退出信号，清理子进程
trap "echo '正在停止服务...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait
