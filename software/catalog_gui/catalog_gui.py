#!/usr/bin/env python3
"""GitHub Raw catalog generator GUI for english_ear_static_player."""

from __future__ import annotations

import json
import re
import tkinter as tk
import configparser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from urllib.parse import quote

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v"}
SUPPORTED_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS


def slugify(value: str) -> str:
    text = value.strip().lower()
    text = re.sub(r"[^\w\-]+", "-", text)
    text = re.sub(r"[_\-]+", "-", text)
    return text.strip("-") or "item"


def normalize_catalog_id(value: str) -> str:
    text = value.strip().replace(" ", "-")
    text = re.sub(r"[^A-Za-z0-9\-_]+", "-", text)
    text = re.sub(r"[-_]{2,}", "-", text)
    return text.strip("-_")


def to_title(stem: str) -> str:
    title = stem.replace("_", " ").replace("-", " ").strip()
    return title or stem


def media_type_from_ext(ext: str) -> str:
    return "video" if ext.lower() in VIDEO_EXTENSIONS else "audio"


def build_raw_url(owner: str, repo: str, branch: str, rel_path: str) -> str:
    parts = [quote(part) for part in rel_path.replace("\\", "/").split("/")]
    path = "/".join(parts)
    return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"


def build_media_url(raw_url: str, accel_enabled: bool, accel_base: str) -> str:
    if not accel_enabled:
        return raw_url
    base = accel_base.strip()
    if not base:
        return raw_url
    if not base.endswith("/"):
        base = base + "/"
    return f"{base}{raw_url}"


def parse_github_repo(repo_url: str) -> tuple[str, str]:
    value = repo_url.strip()
    if not value:
        raise ValueError("GitHub 仓库地址不能为空")

    patterns = [
        r"^https?://github\.com/([^/\s]+)/([^/\s]+?)(?:\.git)?/?$",
        r"^git@github\.com:([^/\s]+)/([^/\s]+?)(?:\.git)?$",
        r"^ssh://git@github\.com/([^/\s]+)/([^/\s]+?)(?:\.git)?/?$",
    ]
    for pattern in patterns:
        match = re.match(pattern, value, re.IGNORECASE)
        if match:
            return match.group(1), match.group(2)

    raise ValueError("GitHub 仓库地址格式不正确，请使用 https://github.com/owner/repo")


def resolve_git_dir(repo_root: Path) -> Path:
    git_entry = repo_root / ".git"
    if git_entry.is_dir():
        return git_entry
    if git_entry.is_file():
        content = git_entry.read_text(encoding="utf-8").strip()
        match = re.match(r"^gitdir:\s*(.+)$", content, re.IGNORECASE)
        if not match:
            raise ValueError(".git 文件格式不正确")
        git_dir_value = match.group(1).strip()
        git_dir = Path(git_dir_value)
        if not git_dir.is_absolute():
            git_dir = (repo_root / git_dir).resolve()
        if git_dir.exists() and git_dir.is_dir():
            return git_dir
        raise ValueError(f"gitdir 路径不存在: {git_dir}")
    raise ValueError("未找到 .git，请确认仓库根目录是否正确")


def parse_github_repo_from_local(repo_root: Path) -> tuple[str, str]:
    git_dir = resolve_git_dir(repo_root)
    config_path = git_dir / "config"
    if not config_path.exists():
        raise ValueError(f"未找到 git 配置文件: {config_path}")

    parser = configparser.RawConfigParser(strict=False)
    parser.read(config_path, encoding="utf-8")

    remote_url = ""
    origin_section = 'remote "origin"'
    if parser.has_section(origin_section):
        remote_url = parser.get(origin_section, "url", fallback="").strip()
    if not remote_url:
        for section in parser.sections():
            if section.startswith('remote "') and section.endswith('"'):
                remote_url = parser.get(section, "url", fallback="").strip()
                if remote_url:
                    break

    if not remote_url:
        raise ValueError("未在 .git/config 中找到远程仓库 URL")
    try:
        return parse_github_repo(remote_url)
    except ValueError as exc:
        raise ValueError(f"远程仓库不是 GitHub 地址: {remote_url}") from exc


def js_wrapper_name(catalog_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9]", "", catalog_id.title())
    return f"registerCatalog{safe or 'Generated'}"


def validate_catalog(catalog: dict) -> None:
    if not catalog.get("catalogId"):
        raise ValueError("catalogId 不能为空")
    if not catalog.get("catalogName"):
        raise ValueError("catalogName 不能为空")
    units = catalog.get("units", [])
    if not units:
        raise ValueError("未生成任何单元，请检查媒体目录和扩展名过滤")
    for unit in units:
        if not unit.get("unitId"):
            raise ValueError("存在空 unitId")
        if not unit.get("items"):
            raise ValueError(f"单元 {unit.get('unitName', '')} 没有条目")
        for item in unit["items"]:
            required = ["itemId", "title", "text", "type", "url", "sort"]
            missing = [key for key in required if key not in item or item[key] in ("", None)]
            if missing:
                raise ValueError(f"条目缺少字段: {', '.join(missing)}")


def build_catalog_data(
    repo_root: Path,
    media_root: Path,
    owner: str,
    repo: str,
    branch: str,
    catalog_id: str,
    catalog_name: str,
    accel_enabled: bool,
    accel_base: str,
) -> dict:
    if not repo_root.exists():
        raise ValueError(f"仓库根目录不存在: {repo_root}")
    if not media_root.exists():
        raise ValueError(f"媒体目录不存在: {media_root}")
    if repo_root not in media_root.parents and repo_root != media_root:
        raise ValueError("媒体目录必须位于仓库根目录内")

    grouped: dict[str, list[Path]] = {}
    for file in sorted(media_root.rglob("*")):
        if not file.is_file() or file.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        parent = file.parent
        rel_group = parent.relative_to(media_root).as_posix() if parent != media_root else "."
        grouped.setdefault(rel_group, []).append(file)

    units = []
    sorted_group_keys = sorted(grouped.keys(), key=lambda x: (x == ".", x))
    unit_order = 1
    for group_key in sorted_group_keys:
        files = sorted(grouped[group_key], key=lambda p: p.name.lower())
        if not files:
            continue

        unit_slug = "root" if group_key == "." else slugify(group_key.replace("/", "-"))
        unit_name = media_root.name if group_key == "." else group_key

        items = []
        for idx, file in enumerate(files, start=1):
            rel_to_repo = file.relative_to(repo_root).as_posix()
            stem = file.stem
            item_slug = slugify(stem)
            item = {
                "itemId": f"{catalog_id}-{unit_order}-{idx}-{item_slug}",
                "title": to_title(stem),
                "text": to_title(stem),
                "type": media_type_from_ext(file.suffix),
                "url": build_media_url(
                    build_raw_url(owner, repo, branch, rel_to_repo),
                    accel_enabled=accel_enabled,
                    accel_base=accel_base,
                ),
                "sort": idx,
            }
            items.append(item)

        units.append(
            {
                "unitId": f"{catalog_id}-unit-{unit_order}-{unit_slug}",
                "unitName": unit_name,
                "items": items,
            }
        )
        unit_order += 1

    catalog = {"catalogId": catalog_id, "catalogName": catalog_name, "units": units}
    validate_catalog(catalog)
    return catalog


def build_catalog_js(catalog: dict) -> str:
    wrapped = json.dumps(catalog, ensure_ascii=False, indent=2)
    fn_name = js_wrapper_name(catalog["catalogId"])
    return (
        f"(function {fn_name}(global) {{\n"
        '  "use strict";\n\n'
        f"  const catalog = {wrapped};\n\n"
        "  global.__CATALOG_REGISTRY = global.__CATALOG_REGISTRY || [];\n"
        "  global.__CATALOG_REGISTRY.push(catalog);\n"
        "})(window);\n"
    )


class CatalogGuiApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("GitHub Raw Catalog 生成器")
        self.root.geometry("1060x760")

        self.repo_root_var = tk.StringVar()
        self.media_root_var = tk.StringVar()
        self.branch_var = tk.StringVar(value="main")
        self.catalog_id_var = tk.StringVar(value="")
        self.catalog_name_var = tk.StringVar(value="")
        self.output_file_var = tk.StringVar(
            value="manifests/catalog-generated.js"
        )
        self.accel_enabled_var = tk.BooleanVar(value=True)
        self.accel_base_var = tk.StringVar(value="https://p.airm.cc/")

        self.preview_text: tk.Text | None = None
        self.status_var = tk.StringVar(value="请先填写参数，然后点击“生成预览”。")

        self._build_ui()

    def _build_ui(self) -> None:
        main = ttk.Frame(self.root, padding=12)
        main.pack(fill="both", expand=True)
        main.columnconfigure(0, weight=1)
        main.rowconfigure(1, weight=1)

        form = ttk.LabelFrame(main, text="生成参数", padding=10)
        form.grid(row=0, column=0, sticky="ew")
        form.columnconfigure(1, weight=1)

        self._row_entry_with_btn(form, 0, "仓库根目录", self.repo_root_var, self.pick_repo_root)
        self._row_entry_with_btn(form, 1, "媒体目录", self.media_root_var, self.pick_media_root)
        self._row_entry(form, 2, "分支名", self.branch_var)
        self._row_entry(form, 3, "输出文件(相对仓库)", self.output_file_var)
        self._row_accel(form, 4)

        btns = ttk.Frame(form)
        btns.grid(row=5, column=0, columnspan=3, sticky="ew", pady=(8, 0))
        ttk.Button(btns, text="生成预览", command=self.generate_preview).pack(side="left")
        ttk.Button(btns, text="保存文件", command=self.save_file).pack(side="left", padx=8)
        ttk.Button(btns, text="清空预览", command=self.clear_preview).pack(side="left")

        preview_box = ttk.LabelFrame(main, text="catalog JS 预览", padding=8)
        preview_box.grid(row=1, column=0, sticky="nsew", pady=(10, 0))
        preview_box.columnconfigure(0, weight=1)
        preview_box.rowconfigure(0, weight=1)

        self.preview_text = tk.Text(preview_box, wrap="none", font=("Consolas", 10))
        ybar = ttk.Scrollbar(preview_box, orient="vertical", command=self.preview_text.yview)
        xbar = ttk.Scrollbar(preview_box, orient="horizontal", command=self.preview_text.xview)
        self.preview_text.configure(yscrollcommand=ybar.set, xscrollcommand=xbar.set)

        self.preview_text.grid(row=0, column=0, sticky="nsew")
        ybar.grid(row=0, column=1, sticky="ns")
        xbar.grid(row=1, column=0, sticky="ew")

        status = ttk.Label(main, textvariable=self.status_var, foreground="#1d4ed8")
        status.grid(row=2, column=0, sticky="w", pady=(8, 0))

    def _row_entry(self, parent: ttk.Frame, row: int, label: str, var: tk.StringVar) -> None:
        ttk.Label(parent, text=label, width=18).grid(row=row, column=0, sticky="w", pady=4)
        ttk.Entry(parent, textvariable=var).grid(row=row, column=1, sticky="ew", padx=(8, 0), pady=4)

    def _row_entry_with_btn(
        self,
        parent: ttk.Frame,
        row: int,
        label: str,
        var: tk.StringVar,
        cmd,
    ) -> None:
        self._row_entry(parent, row, label, var)
        ttk.Button(parent, text="浏览", command=cmd, width=8).grid(row=row, column=2, padx=(8, 0), pady=4)

    def _row_accel(self, parent: ttk.Frame, row: int) -> None:
        ttk.Label(parent, text="加速 URL", width=18).grid(row=row, column=0, sticky="w", pady=4)
        wrapper = ttk.Frame(parent)
        wrapper.grid(row=row, column=1, columnspan=2, sticky="ew", padx=(8, 0), pady=4)
        wrapper.columnconfigure(1, weight=1)
        ttk.Checkbutton(
            wrapper,
            text="启用",
            variable=self.accel_enabled_var,
            command=self._on_toggle_accel,
        ).grid(row=0, column=0, sticky="w")
        self.accel_entry = ttk.Entry(wrapper, textvariable=self.accel_base_var)
        self.accel_entry.grid(row=0, column=1, sticky="ew", padx=(8, 0))
        self._on_toggle_accel()

    def _on_toggle_accel(self) -> None:
        state = "normal" if self.accel_enabled_var.get() else "disabled"
        self.accel_entry.configure(state=state)

    def pick_repo_root(self) -> None:
        selected = filedialog.askdirectory(title="选择本地仓库根目录")
        if selected:
            self.repo_root_var.set(selected)

    def pick_media_root(self) -> None:
        selected = filedialog.askdirectory(title="选择媒体目录（仓库内）")
        if selected:
            self.media_root_var.set(selected)
            dir_name = Path(selected).name
            self.catalog_name_var.set(dir_name)
            self.catalog_id_var.set(normalize_catalog_id(dir_name))

    def _build_js_from_form(self) -> str:
        repo_root = Path(self.repo_root_var.get().strip())
        media_root = Path(self.media_root_var.get().strip())
        owner, repo = parse_github_repo_from_local(repo_root)
        branch = self.branch_var.get().strip() or "main"
        catalog_id = normalize_catalog_id(media_root.name.strip() or self.catalog_id_var.get().strip())
        catalog_name = media_root.name.strip() or self.catalog_name_var.get().strip()
        if not catalog_id:
            raise ValueError("媒体目录名无法生成有效的 catalogId")
        if not catalog_name:
            raise ValueError("媒体目录名为空，无法生成 catalogName")
        accel_enabled = self.accel_enabled_var.get()
        accel_base = self.accel_base_var.get().strip()

        catalog = build_catalog_data(
            repo_root=repo_root,
            media_root=media_root,
            owner=owner,
            repo=repo,
            branch=branch,
            catalog_id=catalog_id,
            catalog_name=catalog_name,
            accel_enabled=accel_enabled,
            accel_base=accel_base,
        )
        return build_catalog_js(catalog)

    def generate_preview(self) -> None:
        try:
            js_text = self._build_js_from_form()
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("生成失败", str(exc))
            self.status_var.set(f"生成失败：{exc}")
            return

        self.preview_text.delete("1.0", "end")
        self.preview_text.insert("1.0", js_text)
        self.status_var.set("预览已生成，可直接保存到 manifests/*.js。")

    def save_file(self) -> None:
        try:
            js_text = self.preview_text.get("1.0", "end").strip()
            if not js_text:
                js_text = self._build_js_from_form().strip()

            repo_root = Path(self.repo_root_var.get().strip())
            if not repo_root.exists():
                raise ValueError("仓库根目录不存在")

            output_rel = self.output_file_var.get().strip()
            if not output_rel:
                raise ValueError("输出路径不能为空")
            output_path = (repo_root / output_rel).resolve()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(js_text + "\n", encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("保存失败", str(exc))
            self.status_var.set(f"保存失败：{exc}")
            return

        self.status_var.set(f"保存成功：{output_path}")
        messagebox.showinfo("保存成功", f"已写入：\n{output_path}")

    def clear_preview(self) -> None:
        self.preview_text.delete("1.0", "end")
        self.status_var.set("预览已清空。")


def main() -> None:
    root = tk.Tk()
    app = CatalogGuiApp(root)
    _ = app
    root.mainloop()


if __name__ == "__main__":
    main()
