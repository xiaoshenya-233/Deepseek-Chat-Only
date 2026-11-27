# 上游同步说明

网页来自开源仓库 [`deepseek-ai/chat-demo`](https://github.com/deepseek-ai/chat-demo)（MIT），
本项目在它的基础上做了本地补丁。本文说明基线版本、同步流程与红线。

## 基线

| 项 | 值 |
| --- | --- |
| 上游仓库 | `https://github.com/deepseek-ai/chat-demo.git` |
| 锁定 tag / 提交 | `v0.1.3` / `8ad7b56` |
| 上游版本号 | `web/package.json` 的 `0.1.3`（只表示基线，不代表本项目发布版本） |
| 本地补丁快照 | `docs/patches/local-web.patch` |
| 本地改动范围 | `web/src` 下的界面与业务代码（未改动上游的构建配置结构） |

## 同步前体检

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File web\check-upstream.ps1 -OutFile ..\docs\upstream-report.md
```

脚本只读：拉取上游新提交与标签、列出与本地锁定提交之间的改动文件、检查是否与本地补丁冲突。
报告含三部分信息：

- `VERDICT`：基线是否已最新；
- 新提交列表：作者、标题、涉及文件；
- 冲突提示：本地改动过的文件中，上游也改了的会单独标出。

## 合并步骤

```powershell
cd web
git fetch origin --tags
git --no-pager log --oneline HEAD..origin/main          # 先看要合进来的提交
git merge --no-ff origin/main                            # 冲突时逐个文件手工合并
```

合并后按顺序做完整验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File web\build-windows.ps1     # 1. 网页构建
powershell -NoProfile -ExecutionPolicy Bypass -File android\build-apk.ps1     # 2. APK
cd desktop; npm run dist:win                                                  # 3. 桌面
cd web; npm run lint; npm run type                                            # 4. 静态检查
```

桌面端还可以用 `npm run capture` 在不同窗口宽度下截图，确认布局没有被上游样式改动影响。

## 本地补丁快照

补丁保存 `web/src` 相对上游的**全部**改动，用于比对、回滚与新建分支：

```powershell
# 生成（在 web/ 目录，包含未跟踪文件）
cd web
git add -N -A
git --no-pager diff --binary --output='..\docs\patches\local-web.patch'
git reset

# 校验：能否反向应用（说明工作区与补丁一致）
git apply --check --reverse ..\docs\patches\local-web.patch

# 应用（例如在新克隆的上游仓库上恢复本地改动）
git apply --3way ..\docs\patches\local-web.patch
```

补丁数量级（`git --no-pager diff --stat` 的统计）会随功能增长，看数字没有意义，看能否反向应用即可。

### 本地差异清单

按模块列出本地改动，合并上游后逐项核对是否仍然生效：

| 模块 | 本地改动 |
| --- | --- |
| `components/session` | 会话提示词入口、缓存命中率徽标、对话总览（桌面标题栏按钮 / 移动端悬浮球） |
| `components/messages` | 分支切换、复制与朗读、回到底部、窗口化渲染与懒加载、思考过程折叠 |
| `components/settings` | 对话管理与提示词管理拆分、界面模式与缩放、折叠思考开关、日出日落主题 |
| `components/casual` | 三栏休闲模式、会话头像裁剪、表情包面板 |
| `services/chat` | 摘要与上下文压缩、图片预算、上下文去重、附件哈希去重、导入导出增强 |
| `services/api` | 错误归类（密钥失效 / 限流 / 图片超限 / 网络）、事件解析容错 |
| `i18n` | 全部自定义文案（`zh` 为键来源，`en` 与之一一对应） |

## 能力基线

同步后必须仍然可用的能力（任一丢失都视为回归，先回退再排查）：

| 分类 | 能力 |
| --- | --- |
| 会话 | 多会话、自动标题、重命名、删除、置顶、时间分组 |
| 消息 | 流式回答、深度思考、停止 / 重新生成 / 继续生成、编辑已发送消息、分支切换 |
| 内容渲染 | Markdown、代码高亮、KaTeX、Mermaid（放大与存图）、来源引用 |
| 附件 | 拍照 / 相册 / 文件三入口、拖放与粘贴、图片压缩与去重、PDF 用系统应用打开 |
| 上下文 | 图片预算裁剪、上下文图片去重、自动摘要与手动压缩、缓存命中率徽标 |
| 数据 | 官方格式 ZIP 导入 / 导出（含从签名链接导入）、导出所选、批量删除 |
| 个性化 | 按对话提示词、会话头像、表情包、界面模式、界面缩放、主题（含日出日落） |
| 导航 | 回到底部、对话总览跳转、折叠思考过程、懒渲染与分页回收 |
| 原生 | 三端下载桥、附件打开、Android 返回键、桌面窗口状态记忆与缩放快捷键 |

## 红线

以下内容改动会破坏兼容性，同步上游时不要「顺手对齐」：

| 位置 | 约束 |
| --- | --- |
| 导出 ZIP 结构 | 必须保持 `export_format_version: 3` 与条目顺序（`manifest → user → sessions → index → files`），否则与其他 DeepSeek 客户端不互通 |
| `chat_session_index.json` | 只写成功导出的会话，字段名与上游一致 |
| 历史消息的 `file_id` | 导入/导出的附件身份不能重写，否则引用关系断裂 |
| `native/download-bridge.js` | 三端唯一的桥接实现，签名（方法名与参数）不能单侧修改 |
| 上游 MIT 声明 | `LICENSES/MIT-deepseek-chat-demo.txt` 与 `web/LICENSE` 不得删除或改写；本项目整体是 GPLv3，MIT 部分作为其组成部分再分发 |
| `.gitattributes` | `.ps1` 用 CRLF、`.sh` 用 LF，且 `.ps1` 存 UTF-8 with BOM |

## 提交前检查清单

- [ ] `web/check-upstream.ps1` 报告无冲突，或冲突已手工解决
- [ ] `npm run type` 与 `npm run lint` 通过
- [ ] `web/build-windows.ps1` 能产出 `release/web/`，`index.html` 含 `application-version` 与下载桥
- [ ] 至少构建一次 APK 或桌面端，确认打包链路仍然可用
- [ ] 重新生成 `docs/patches/local-web.patch`，并确认可反向应用
- [ ] 若上游改了界面或数据结构，同步更新 `CODE_ARCHITECTURE.md` 与各端 README
