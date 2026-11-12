# nt_helper_release

[weq-devs/nt_helper](https://github.com/weq-devs/nt_helper) 构建产物的**缓存仓库**喵

在 WeQ 里：

```bash
pnpm native:fetch          # 本机平台，默认按 WeQ 固定版本锚获取
pnpm native:fetch --all    # 五个平台
pnpm native:fetch --check  # 只比对本地与远端，不改文件
```

## 原生权限助手发布

沿用本缓存仓，不增加源码仓或发布仓。每次构建发布 5 个平台的 `.node`、5 个小型原生权限助手、3 份装扮资源及 `manifest.json` / `SHA256SUMS`。助手源代码、原生核心与系统安装实现仍只在既有私有仓维护；本仓仅保存公开工作流、分发契约及合成测试。

五个平台使用对应架构的原生 runner，`.node` 和助手共用 prepare job 生成的时间戳。每个平台在普通权限下查询真实产物的构建信息、测试助手的合成场景，并检查运行依赖；不安装服务、不读 QQ 内存、不抓包。Linux 助手不得动态依赖 libpcap/SQLite/Node/OpenSSL，macOS 仅允许系统库；Windows 检查静态 CRT，不捆绑额外运行环境，抓包仍需用户已安装 Npcap。

私有源码的编译与测试输出只留在临时 runner，不打印或上传；公开上传使用明确文件名。汇总器拒绝缺件、篡改、过期、开发构建、目标或时间戳错配、符号链接及非白名单文件。助手片段只在 draft 中转，合并并核验后删除，最终总清单只透传规定的公开字段。

## 装扮单次加工

同一 `Release` 内先固定私有源码 commit，由独立的 `dress` job 调用源码工作区内的 `nt-helper-dress-pack`，只压缩、加密一套三类索引。新工作流要求指定的源码 commit 已包含该内部工具。

五个平台使用同一 `DRESS_KEY_SEED`，设置 `NT_HELPER_PACK_DRESS=0` 只嵌入派生密钥，不再重复加工。继续使用原有 NTDR v1、Brotli q9 和 AES-256-CBC，不取消加密或 commit 配套关系。

跨 job 只传递三份加密 `.dat` 与来源／哈希清单，通过本轮上传返回的 artifact ID 精确下载。每个平台先独立核对来源、哈希并解密，再实际调用 addon 逐类查询同一套索引；发布汇总还核对草稿中的索引与共享产物字节一致。缺件、错密钥、错 commit 或无法读取都会阻断发布。

中转 artifact 使用白名单，最长保留一天，工作流收尾删除本轮 artifact；不上传原始索引、密钥或私有源码。它不进入最终 Release，最终产物名称、清单格式和 WeQ 固定版本获取方式不变。失败后若中转文件已清理，应完整重跑工作流，而非只重跑失败 job。

工作流变更合入后，可先运行不发布的预检：

```sh
gh workflow run Release --repo weq-devs/nt_helper_release \
  -f ref=<私有 native 的完整 commit> -f preflight_only=true
```

此模式只构建和验证，不创建 draft、不上传 Release 资产、不更新 `latest.json`；仍使用并清理本轮加密索引中转 artifact。现有私有仓的 Release 分发入口也转发同一参数。正常发布仍需明确运行 `preflight_only=false`；本文和本地测试不代表工作流已经触发。

## 本地检查

```sh
node --test test/*.test.mjs
```

测试只使用合成字节和元数据，不加载真实原生组件，不需要凭据或网络。`scripts/verify-platform.mjs` 用于 runner 上查询真实二进制，`scripts/stage-manifest.mjs` 用于发布前的完整资产汇总；不得用合成测试替代平台编译或系统安装验收。
