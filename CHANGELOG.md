# Changelog

## [1.1.2] - 2026-10-14

### Library 排布与比较性能

- 瀑布流和比较模式的固定宽度列整体居中，缩放后的余量平均分到左右；滚动条两侧预留相同空间，超宽内容仍可从左侧正常滚动浏览。
- Comparison Dimensions 按可见区域延迟创建卡片和渲染公式，每帧最多 12 张卡片、约 8 ms 预算；切换模式或筛选时取消旧任务，单个公式更新不再重建整个比较面板。文献统计改为一次遍历，减少大规模稀疏排布中的重复扫描。
- 类型等筛选根据当前结果重新紧凑排列普通比较行，保留有内容的命名组及其成员；筛选不覆盖原始排布。拖动和翻页继续指向原始结果，筛选后命名仅收集当前行可见成员，保留被筛掉的结果。

### 新增 PDF 自动分析

- 增加默认关闭的“自动分析新添加的 PDF”设置：仅监听启用后的新增 PDF，不扫描已有库；已解析结果在附件锁内检查并跳过，不覆盖手动修改。
- 新增通知合并去重，只排队附件 ID，每次分析一份 PDF，复用全局页面、渲染与推理上限；等待未下载文件最多约五分钟，失败不阻塞后续附件。关闭选项或卸载插件时取消任务并清空队列。
- 按独立设置同步批注及识别公式；自动公式识别逐条等待完成，避免批量导入积压图片任务。只刷新相应 PDF 的阅读器侧栏。

### 图注纠正与图表库窗口

- 修复新版 Zotero 缺少 `setSidebarOpen` 导致图注纠正及框选识别结果定位报错的问题，使用 `toggleSidebar` 并兼容旧接口。
- Correct Caption 菜单移除“Select Region”附加文字，各语言同步简化。
- 主窗口工具栏及设置中的图表库入口改为独立最大化窗口，与侧栏共用窗口逻辑；底部工具栏默认收起，重复打开会聚焦已有窗口。

### 主窗口入口

- 将 PDF 图表库入口从 Tools 菜单移到主窗口文献列表上方、搜索框左侧的工具栏图标，单击直接打开；已打开时聚焦原窗口。随窗口卸载清理按钮，并更新各语言的入口说明。

### 手动区域识别

- 增加 Correct Caption：右键结果后框选正确图注，直接从 PDF 文本层本地提取并替换对应说明，复用手动修改图注的存储与翻译缓存清理逻辑，并重新排序、选中定位。无需模型下载或付费 API；扫描页无文字、取消或提取失败时不覆盖原说明。

- 框选识别完成后自动展开 Figure 侧栏，选中新结果并滚动到第一项；自动补充所需类型筛选，避免结果被隐藏。等待刷新返回最新数据后定位，未识别出结果或失败、取消时不跳转。

### Library 缩放

- 缩放改为每帧合并更新，滚动期间保留卡片节点，仅在停止操作且列数变化时重新分列；暂停分页，结束后恢复加载。
- 滚轮按幅度缩放并累积触控板的小幅移动；滑块精度改为 1%，增加百分比输入，范围扩展到 10%–1000%，Ctrl/Command+0 恢复 100%。
- 图片宽度随比例连续变化，缩放期间保持当前可见卡片的位置；比较视图的公式缩略图在操作结束后适配。

### Library 筛选面板

- 修复年份柱状图的数量标签被窄柱裁切的问题：完整显示数字，年份密集时竖排，面板加宽；保留完整年份范围及悬停提示。
- 集合改用 SVG 文件夹图标；分类与文献选项取消 Zotero 按钮默认最大高度，多行标题自动撑开行高。
- 年份柱形图提供页面内悬停与键盘焦点提示，柱顶直接显示数量；输入有效范围时预览该范围，应用后保持面板打开，方便查看结果。

- 筛选弹窗增加不透明的主题底色，避免底层图文透出；年份面板加宽，柱形图按可用宽度完整铺开，不再横向滚动。

- 主 Library 与侧栏最大化窗口共用页面内筛选控件，移除依赖原生弹出菜单的下拉框。
- 分类按 Zotero 集合层级展示，包含空集合；选择父集合会包含所有子集合，切换集合时清除当前文献限制。
- 集合与文献合并为联动浏览面板，支持按文献标题检索；保留侧栏打开时默认选中当前文献、折叠工具栏的行为。
- 年份支持输入单年或闭区间（如 `2020–2024`），校验格式与起止顺序；每年结果数以柱形图显示，点击柱形可筛选该年。
- 类型改用侧栏同款图片、表格、公式图标，支持一键恢复全部类型；有效但无结果的筛选条件不再被自动清空。

### English summary

- Unify Library filters across standalone windows, with collection hierarchy, document search, year ranges and histograms, and sidebar-style type icons.
- Add smooth 10%–1000% zoom, symmetric layout spacing, and lazy comparison-card rendering. Filtered comparison views compact their rows while preserving saved layouts and hidden results.
- Add Correct Caption using selected PDF text locally, without paid APIs. Scanned captions without a text layer are not supported. Reveal and select results after manual region recognition.
- Open the Library in a standalone maximized window from the main Zotero toolbar, and fix sidebar-opening compatibility for caption correction and region recognition.
- Add an opt-in, default-off setting to analyze newly added PDFs. Deduplicate and process attachments serially, skip existing analyses, bound file retries, and cancel queued work when disabled.

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
