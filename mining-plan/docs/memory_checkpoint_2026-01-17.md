# 版本锁定检查点（可回溯记忆）

- 日期：2026-01-17
- 目的：锁定当前工作区状态；为后续“资源回收/覆盖裁剪/综合评分/Top10”等改造提供可回溯基线。
- 约束：本检查点不修改任何现有业务代码；仅新增本记录文件。

## 1) Git 基线

- 是否在 git 仓库内：是（`git rev-parse --is-inside-work-tree` => true）
- HEAD：`b2675c59904518d47e659ff9d0f8119ad544d6c0`
- 分支状态（摘录）：`main...origin/main [gone]`

## 2) 工作区未提交变更（当下事实记录）

> 说明：以下为执行 `git status -sb` / `git diff --stat` 的输出摘要（用于定位“当时到底改了什么/有哪些未提交文件”）。

### 2.1 git status 摘录

- D：`1-1-1...doc`（二进制 doc 文件被删除，路径包含中文转义）
- M：`frontend/src/App.jsx`
- A：`frontend/src/components/MultiObjectivePlanPanel.jsx`
- A：`frontend/src/components/SmoothnessSlider.jsx`
- M：`frontend/src/main.jsx`
- D：`论文排版.py`（路径包含中文转义）
- ??：`frontend/src/planning/`（未跟踪目录）
- ??：`frontend/tools/`（未跟踪目录）
- ??：`snapshots/`（未跟踪目录）

### 2.2 git diff --stat 摘录

- `frontend/src/App.jsx`：约 `+3421/-?`（大幅变更）
- `frontend/src/main.jsx`：约 `+87/-?`
- `论文排版.py`：删除约 `208` 行
- `1-1-1...doc`：二进制文件 `293703 -> 0 bytes`

## 3) 关键文件内容指纹（SHA256）

用于确认“同名文件是否就是当时那一版”。

- `frontend/src/planning/workers/smartResource.worker.js`
  - SHA256：`34B2A3C29847895BAAB0ACE41D07CEE37E429C078E905972201F30CAEA5D7828`
- `frontend/src/App.jsx`
  - SHA256：`CFEDC2D39FECFE20E66B56B65E7CE8D524C532C3EA15AD2BD0C69EAC4A5539CF`

## 4) 构建/运行证据

- 最近一次前端构建命令（来自环境提示）：`npm run build`
- 退出码：`0`（成功）

> 注：该构建成功仅说明“当时工作区可以打包”，不等同于逻辑已满足验收口径。

## 5) 当前讨论焦点（口径备忘）

- 用户验收口径升级：
  - “x 与 y 都放开范围（含 axis=both 或更广义的外扩覆盖）”
  - “先把蓝色覆盖范围加大，让粉色区域（除煤柱）被 100% 覆盖，再用粉色区域裁剪”
  - “按裁剪后的工作面形态做资源回收综合评分并返回前十”
- 已知风险点（需后续实现中明确）：
  - `partial=true` 与 `fast=true` 的语义需要拆开，避免超时结果被当成稳定缓存
  - “100% 覆盖”的目标区域需严格定义（Ω？是否扣除 ws 间隔煤柱？）否则可能数学上不可达

## 6) 如何复核该检查点

在任意时刻复核是否仍处于该版本：

1) 检查 HEAD：`git rev-parse HEAD` 应为 `b2675c59904518d47e659ff9d0f8119ad544d6c0`
2) 校验 SHA256：
   - `Get-FileHash -Algorithm SHA256 frontend/src/planning/workers/smartResource.worker.js`
   - `Get-FileHash -Algorithm SHA256 frontend/src/App.jsx`
   输出应与本文件第 3 节一致。

---

（本文件为“节点记录/可回溯记忆”，不代表最终功能完成。）
