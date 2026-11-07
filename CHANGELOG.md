# Changelog

## 0.1.1

- 修 strict 模式在 anthropic 协议下漏清 `messages` 里的宿主 system/developer 块：Claude Desktop / Code 会把系统提示词同时发在 `body.system` 和 `messages` 里，只改前者时上游仍按那份大的走，人设不生效
- append 模式同样去重：`messages` / `input` 里的 system/developer 条目若与已保留的宿主文本重复就删掉，只发一份；认不出是重复的原样保留（宁可多花 token，不丢宿主内容）
- 「原生层已经改过」的判定收紧成「人设 + 空行」或整段等于人设：人设恰好是宿主提示词开头时不再被误判成已改写、整段跳过
- gemini 两种 `systemInstruction` 拼法都在时，空的那个不再挡住另一份宿主文本（读取与 strict 清理都认）；空的别名键顺手清掉
- anthropic 的 `hostChars` 诊断把 `messages` 里的宿主文本也算进来
- 人设上限统一 256KB：网关常量与页面导入、README 说的是同一个数
- 页面：关掉白名单里最后一个 agent 时不再落空名单（空名单 = 全部放行），给出提示并保持原状
- 页面：中文名人设的 id 不再被压成 `persona`、`persona-2`
- fail-open 时把失败原因写进 `ctx.state.purge`，静默放行也可排查
- 新增 9 条用例，共 114 条

## 0.1.0

- 网关层：异步 hook 改写 anthropic / chat / responses / gemini 请求体里的系统提示词
- 三档模式：off / append / strict
- 接管门禁：agent 白名单 + 最小工具数 + query / 环境存在性，滤掉旁路请求
- 原生层：为 pi / omp 生成并安装进程内扩展
- 插件页：总闸、模式、人设库、Agents 白名单、门禁三项
- 105 条 node:test 用例
