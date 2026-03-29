# catalog_gui

用于给 `english_ear_static_player` 生成 `manifests/catalog-*.js` 的 Python 图形工具。

## 功能

- 扫描本地 clone 仓库中的媒体文件（音频/视频）。
- 自动按目录生成 `units`，按文件名生成 `items`。
- 只需填写本地仓库根目录，自动从 `.git/config` 提取 owner/repo（优先 `origin`）。
- `catalogId` 自动使用媒体目录名生成（例如目录 `2A` -> `catalogId: "2A"`）。
- `catalogName` 自动使用媒体目录名（例如媒体目录是 `2A`，则 `catalogName` 为 `2A`）。
- 当媒体文件位于资源目录根层时，`unitName` 同样使用媒体目录名（例如 `2A`）。
- 支持可选加速 URL，默认开启并使用 `https://p.airm.cc/` 作为前缀。
- 自动拼接 GitHub Raw URL：
  - `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`
- 生成与当前播放器兼容的 JS 包装格式，并可直接保存到 `manifests/`。

## 支持格式

- 音频：`.mp3 .wav .m4a .aac .ogg .flac`
- 视频：`.mp4 .webm .mov .m4v`

## 运行

在项目根目录执行：

```bash
python english_ear_static_player/catalog_gui/catalog_gui.py
```

## 使用建议

1. 仓库根目录选择你的本地 clone 根路径。
2. 媒体目录选择仓库内的资源目录（例如 `assets/audio`）。
3. 填写仓库根目录和媒体目录，确认 `branch` 后点击“生成预览”。
4. 输出文件填 `manifests/catalog-xxx.js`，点击“保存文件”。
