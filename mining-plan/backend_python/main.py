from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn
import os
import time
from datetime import datetime
from pathlib import Path

from routers import upload, boreholes, design, score, boundary, geology, succession, gnn_geology, planning, export_cad
from store import store
from utils.logger import logger, log_api_request

app = FastAPI(title="Mining Design System API", version="2.1")

DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

# 配置 CORS - 从环境变量读取允许的域名，默认为本地开发地址
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]

# 允许局域网 IP 访问前端 dev server（例如 http://10.4.81.4:5173）
# 可通过环境变量覆盖，例如：ALLOWED_ORIGIN_REGEX=^http://(localhost|127\\.0\\.0\\.1|10\\.\\d+\\.\\d+\\.\\d+):5173$
ALLOWED_ORIGIN_REGEX = os.getenv(
    "ALLOWED_ORIGIN_REGEX",
    r"^http://(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3}):5173$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    # 允许 OPTIONS 预检，否则浏览器在 POST/JSON 时可能表现为“拒绝访问/跨域失败”
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """请求日志中间件"""
    start_time = time.time()
    response = await call_next(request)
    duration_ms = (time.time() - start_time) * 1000

    # 记录请求日志（跳过健康检查等高频请求）
    if request.url.path not in ["/health", "/", "/favicon.ico"]:
        log_api_request(request.method, request.url.path, response.status_code, duration_ms)

    return response

# 注册路由
app.include_router(upload.router, prefix="/api/upload", tags=["Upload"])
app.include_router(boreholes.router, prefix="/api/boreholes", tags=["Boreholes"])
app.include_router(design.router, prefix="/api/design", tags=["Design"])
app.include_router(score.router, prefix="/api/score", tags=["Score"])
app.include_router(boundary.router, prefix="/api/boundary", tags=["Boundary"])
app.include_router(geology.router, prefix="/api/geology", tags=["Geology"])
app.include_router(succession.router, prefix="/api/succession", tags=["Succession"])
app.include_router(gnn_geology.router, prefix="/api/gnn", tags=["GNN Geology"])
app.include_router(planning.router, prefix="/api", tags=["Planning"])
app.include_router(export_cad.router, prefix="/api/export", tags=["Export"])


@app.get("/")
async def root():
    try:
        index_html = DIST_DIR / "index.html"
        if index_html.exists() and index_html.is_file():
            return FileResponse(str(index_html))
    except Exception:
        # ignore
        pass
    return {"message": "Mining Design System Python Backend is running", "version": "2.1"}


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "2.1",
        "database": "sqlite"
    }


@app.get("/api/health")
async def api_health_check():
    return await health_check()


@app.get("/api/project")
async def get_project_info():
    """获取当前项目信息"""
    return store.get_project_info()


@app.post("/api/project/clear")
async def clear_project():
    """清空当前项目数据"""
    store.clear()
    return {"success": True, "message": "项目数据已清空"}


if __name__ == "__main__":
    logger.info("="*50)
    logger.info("Mining Design System Backend 启动中...")
    logger.info(f"允许的CORS域名: {ALLOWED_ORIGINS}")
    logger.info("="*50)
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)


# 可选：在同一端口(3001)上直接提供前端静态页面（用于局域网/演示环境，避免 5173 被拦）
# 说明：必须放在所有 /api 路由之后，避免静态挂载吞掉 API。
try:
    if DIST_DIR.exists() and DIST_DIR.is_dir():
        app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="frontend")
except Exception:
    # ignore
    pass
