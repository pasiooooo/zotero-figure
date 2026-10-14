# Changelog

## [1.1.1] - 2026-10-14

### 插件身份与更新隔离

- 显示名称改为 **PDF Figure (pasiooooo)**，插件安装 ID 改为 `zotero-figure@pasiooooo.github.io`，防止被识别为上游插件。
- 资源命名空间、Zotero 全局实例、偏好设置前缀、侧栏与窗口标识、拖拽数据类型及生成批注作者标记全部使用本分支独立标识。
- 自动更新仍指向 `pasiooooo/zotero-figure` 的最新 Release；更新清单只包含新插件 ID，发布检查会核对安装包 ID、清单 ID、版本和下载地址。
- 结果、对比布局和模型改用 `zotero-figure-pasiooooo` 数据目录。首次启动从旧目录复制一次数据和设置，不删除原数据、不覆盖已有分支数据；复制失败不会启用不完整副本，可在重启时重试。
- 本分支不再把上游生成的批注当作自己的批注修改或删除。
- 设置页面与 Library 显示本分支身份，项目链接指向当前仓库，同时保留上游作者归属。

### 安装注意

**插件 ID 已改变，旧版不能自动跨 ID 更新。请先停用原插件或 1.1.0，再手动安装一次本版 XPI，并重启 Zotero。** 数据复制需要额外磁盘空间；首次迁移时请保持旧插件停用。原目录与设置保留，此后两个插件各自保存数据，不会双向同步。

### English summary

- Give this fork its own installation ID, runtime and preference namespaces, UI identifiers, annotation ownership, and local storage.
- Keep updates on this repository and verify the package and update manifest identities before publishing.
- Copy legacy data/settings once without deleting originals or overwriting existing fork data. Disable the old plugin and manually install this release once because the add-on ID changed.

## [1.1.0] - 2026-10-14

### 新增

- **Library 与阅读器侧栏批量操作：** 单击选择，Ctrl / Command + 单击切换选择，Shift + 单击连续选择，Ctrl / Command + A 全选；右键菜单支持批量导出和删除。按 Delete 可删除选中项，确认弹窗会列出图片、表格和公式的数量。
- **框选区域识别：** 在 PDF 阅读器中立即进入截图式框选界面，识别漏检区域；已有结果也可重新识别指定区域。结果保存在本地 Figure 数据中，无须创建 Zotero 图片批注。只替换完整位于选区内的结果，未识别出内容时保留原结果。
- **区域 caption 补识别：** 使用正常的 caption 匹配流程提取 PDF 文本；选区内缺少图片或表格标题时，通过额外的页面检测补充上下文。
- **侧栏快速打开 Library：** 最大化按钮位于工具栏左起第二位。打开完整 Library 并预选当前文献，Document、Type 等筛选项可继续修改；底部工具栏默认收起。
- **Library 缩放快捷键：** 支持 Ctrl / Command + 滚轮和 Ctrl / Command + `+` / `-`，每次调整 10%，范围为 50%–200%，与缩放滑块同步。
- **批量解析前确认已有记录：** 列出已有解析记录的 PDF，可选择重新分析并覆盖、跳过并继续处理其余文件，或取消整批任务。完成提示包含跳过数量；新完成的零结果解析也会保存记录。

### 调整与修复

- 移除 Library 卡片复选框和顶部批量操作菜单，将批量操作集中到右键菜单；阅读器侧栏保留原有工具按钮。
- 侧栏图片改为单击选择、双击跳转到 PDF；将选中图片拖出侧栏可批量创建悬浮图，新图采用错开的位置，不再重排已有悬浮图。
- 取消点击其他区域自动关闭悬浮图。未固定的悬浮图可在任意位置按 Esc 关闭；固定图只有被明确选中后才能用 Esc 关闭。
- 修复侧栏多选后右键菜单无响应，以及固定悬浮图未被选中时误被 Esc 关闭的问题。
- caption 支持双击直接编辑，包括空 caption；编辑框随窗口尺寸伸缩。
- 无 caption 或 caption 无序号的结果排在最前；其余图片、表格、公式按完整编号自然排序，支持 `1.1`、`1.2`、`2.1` 及 `1-1`、`1-2`、`2-1`。
- 修复最大化 Library 的下拉菜单显示与交互，并统一其布局、筛选和视图设置。
- 重新解析确认可覆盖全局“跳过已有结果”设置；复用逐页替换流程，不提前清空数据，并保留匹配结果的手动 caption / 裁剪修正。

### 发布与兼容性

- 版本升级为 **1.1.0**，继续支持 Zotero **9 / 10**。
- 新增推送版本标签后的 GitHub Actions 自动发布：检查、测试、构建 XPI，从本 changelog 提取版本说明，上传安装包和 `update.json`。
- 下载、问题反馈与自动更新地址改为 `pasiooooo/zotero-figure`；更新清单中的 XPI 地址固定到具体版本，避免版本与安装包不一致。
- 区域 caption 依赖 PDF 文本层；扫描图片中的文字尚不支持 caption OCR。局部解析失败时，原有逐页存储逻辑会保留失败页的数据。

### English summary

- Add multi-selection, context-menu batch export/delete, keyboard shortcuts, and deletion counts to the Library and Reader sidebar.
- Add screenshot-style region recognition and caption matching, without creating Zotero annotations.
- Improve floating figures with batch drag-out, stable positions, explicit pinning, and correct Esc behavior.
- Add inline caption editing, natural figure/table/formula numbering, a full Library shortcut filtered to the current document, and Ctrl / Command zoom shortcuts.
- Prompt before reanalyzing PDFs with saved records; allow replacement, skipping, or cancellation and remember completed analyses with no results.
- Publish tagged builds and version-specific update metadata automatically through GitHub Actions. Zotero 9 and 10 remain supported.
