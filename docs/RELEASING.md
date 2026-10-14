# 发布版本

发布仓库为 `pasiooooo/zotero-figure`，开发分支为 `bootstrap`。`CHANGELOG.md` 是 GitHub Release 说明的唯一来源。自动发布支持稳定版本标签 `vX.Y.Z`，标签必须与 `package.json` 的版本完全一致。

## 自动发布流程

推送版本标签后，`.github/workflows/release.yml` 会在 Node.js 22 上执行：

1. `npm ci` 安装锁定依赖。
2. `npm run check` 检查格式、lint、类型、测试、脚本语法和构建资源。
3. `npm run build` 生成 `build/zotero-figure.xpi` 和 `update.json`。
4. `npm run release:prepare` 检查标签、包版本、锁文件、安装包 manifest 和更新清单，并提取对应 changelog。
5. 使用仓库自带的 `GITHUB_TOKEN` 创建 Release，上传 XPI 和更新清单，并将其设为最新稳定版。

不需要额外的发布令牌或 npm 发布权限。仓库必须启用 GitHub Actions，且仓库或组织策略允许工作流请求 `contents: write`。发布失败时查看 Actions 日志，修复后重跑失败的工作流；不要移动已公开发布的标签。

若标签已推送但没有产生运行记录，可在 Actions → Release → Run workflow 中输入已有标签，或在 GitHub CLI 登录后执行：

```sh
gh workflow run release.yml --repo pasiooooo/zotero-figure --ref bootstrap -f tag=v1.1.0
```

手动入口同样检出指定标签、运行完整检查并发布，标签所指向的代码不会改变。

## 本次 1.1.0

版本与 changelog 已整理好，发布提交应同时包含功能改动、`package.json`、`package-lock.json`、`update.json` 及发布流程文件。

```sh
git push --atomic origin bootstrap v1.1.0
```

同时推送分支和标签，确保新工作流随本次代码一起到达 GitHub。

## 后续版本

先完成代码、补充 `CHANGELOG.md` 中的 `## [1.2.0] - YYYY-MM-DD` 段落并提交，保持工作区干净，再运行：

```sh
npm run release -- 1.2.0
```

`release-it` 负责更新版本、构建与检查、提交、创建 `v1.2.0` 标签和推送。GitHub Release 由 Actions 创建，避免本地工具和 CI 重复发布。

## 自动更新地址

- 插件从本仓库最新 Release 的 `update.json` 读取更新信息。
- 清单中的 XPI 下载地址固定到具体版本标签。
- 1.1.1 起安装 ID 为 `zotero-figure@pasiooooo.github.io`，更新清单只发布这个 ID。原插件和 1.1.0 无法跨 ID 自动升级；先停用旧插件，手动安装一次新版并重启，之后沿本仓库自动更新。
- 首次启动会把原 `zotero-figure` 目录复制到 `zotero-figure-pasiooooo`，并复制设置到 `extensions.zotero.pasiofigure`。保留原数据，不覆盖已有分支数据；迁移期间保持旧插件停用，预留复制所需空间。
- 仍支持 Zotero 9 和 Zotero 10。
