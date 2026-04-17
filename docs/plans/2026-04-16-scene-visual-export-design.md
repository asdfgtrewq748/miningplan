# Scene Visual Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a batch exporter that reads the seven `.miningplan.json` scene snapshots and writes per-scene, paper-ready visual assets into a stable folder tree with vector-first outputs.

**Architecture:** Add a standalone Python exporter at the workspace root so we can reuse the existing JSON snapshot contract without depending on the frontend runtime. The exporter will discover scene files, extract saved result blocks per tab/module, rebuild publication-style figures with matplotlib, and emit `svg`/`pdf` plus `png` fallback and companion CSV/JSON files into scene-specific folders.

**Tech Stack:** Python 3, matplotlib, numpy, scipy, pytest

---

### Task 1: Lock input discovery and output contracts

**Files:**
- Create: `E:\xiangmu\miningplan\tests\test_export_scene_visuals.py`
- Create: `E:\xiangmu\miningplan\export_scene_visuals.py`

**Step 1: Write the failing test**

Cover:
- default input directory selection
- scene file discovery from a directory
- deterministic scene slug/output naming

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_export_scene_visuals.py -q`

Expected: import or attribute failures because the exporter module/functions do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- input directory chooser
- scene discovery
- scene naming helpers
- output directory helper

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_export_scene_visuals.py -q`

Expected: tests pass.

### Task 2: Lock a minimal end-to-end export

**Files:**
- Modify: `E:\xiangmu\miningplan\tests\test_export_scene_visuals.py`
- Modify: `E:\xiangmu\miningplan\export_scene_visuals.py`

**Step 1: Write the failing test**

Cover:
- exporting one minimal scene JSON creates per-scene and per-tab folders
- vector files (`.svg`, `.pdf`) and `png` fallback are written
- companion CSV/JSON summaries are written when source data exists

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_export_scene_visuals.py::test_export_scene_writes_vector_and_data_files -q`

Expected: failure because export orchestration and figure saving are missing.

**Step 3: Write minimal implementation**

Implement:
- JSON loading
- tab extraction
- figure builders for ODI map / geology cloud / spatial map / histogram / level pie / error trend / workface layout
- multi-format save helper

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_export_scene_visuals.py -q`

Expected: all tests pass.

### Task 3: Add CLI and real project defaults

**Files:**
- Modify: `E:\xiangmu\miningplan\export_scene_visuals.py`

**Step 1: Write the failing test**

Cover:
- default input prefers `软件案例附件/工程文件案例`
- default output path lands under `output/scene_visual_exports`
- format selection defaults to `svg,pdf,png`

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_export_scene_visuals.py::test_default_output_dir_is_nested_under_output -q`

Expected: failure if CLI/default helpers are missing.

**Step 3: Write minimal implementation**

Implement:
- argparse entrypoint
- default output timestamp directory
- summary index generation
- console summary

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_export_scene_visuals.py -q`

Expected: tests pass.

### Task 4: Real-data smoke export

**Files:**
- No code change unless smoke run reveals a bug

**Step 1: Run the exporter on the user-provided scene directory**

Run:
`python export_scene_visuals.py --input "E:\xiangmu\miningplan\软件案例附件\工程文件案例" --output-dir "E:\xiangmu\miningplan\output\scene_visual_exports"`

Expected:
- all seven scenes are discovered
- output directory contains one folder per scene
- each scene folder contains module/tab subfolders with figure assets

**Step 2: Inspect generated files**

Check:
- expected number of scene folders
- representative `svg` and `pdf` files exist
- index file reflects actual output

**Step 3: Fix only if smoke run exposes issues**

If needed, add or adjust tests first, then patch implementation.

