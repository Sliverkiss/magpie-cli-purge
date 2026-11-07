// 原生扩展层:生成的扩展在 agent 进程内做了什么。
//
// 扩展文件是生成的,所以这里把它渲染到临时目录再 import —— 和 pi 装载它的效果一样。
// 驱动方式是 pi-purge 测自己的方式:一个假的 pi 对象,把 before_agent_start 的
// 处理函数抓出来,直接喂 event。

import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const HOME = mkdtempSync(join(tmpdir(), "magpie-cli-purge-native-"))
process.env.HOME = HOME
process.env.MAGPIE_CLI_PURGE_HOME = join(HOME, ".magpie-cli-purge")

const { render, writeState } = await import("../lib/native.mjs")

// 把生成的扩展写成 .mjs 再 import(Node 不认 .ts)
const file = join(HOME, "generated.mjs")
writeFileSync(file, render())
const mod = await import(pathToFileURL(file).href)

function load() {
  const events = new Map()
  mod.default({ on: (name, handler) => events.set(name, handler) })
  const before = events.get("before_agent_start")
  assert.ok(before, "扩展该注册 before_agent_start")
  return before
}

const before = load()

const HOST = `You are an agent harness speaking as a helpful assistant.

Available tools:
- read: Read file contents

Current working directory: /work`

const PERSONA = "You are a plain assistant."
const event = (prompt, cwd = "/work") => ({ systemPrompt: prompt, systemPromptOptions: { cwd } })

test("关着时不动系统提示词", async () => {
  writeState({ enabled: false, mode: "append", persona: PERSONA })
  assert.equal(await before(event(HOST)), undefined, "关着就不该返回替换品")
})

test("append 不动宿主文本,人设挂最前", async () => {
  writeState({ enabled: true, mode: "append", persona: PERSONA })
  const out = await before(event(HOST))
  assert.equal(out.systemPrompt, `${PERSONA}\n\n${HOST}`)
})

test("strict 只留人设与工作目录", async () => {
  writeState({ enabled: true, mode: "strict", persona: PERSONA })
  const out = await before(event(HOST, "/some/dir"))
  assert.equal(out.systemPrompt, `${PERSONA}\n\nCurrent working directory: /some/dir`)
})

test("人设为空 + strict:只留工作目录", async () => {
  writeState({ enabled: true, mode: "strict", persona: "" })
  const out = await before(event(HOST, "/some/dir"))
  assert.equal(out.systemPrompt, "Current working directory: /some/dir")
})

test("人设为空 + append:真的没事可做", async () => {
  writeState({ enabled: true, mode: "append", persona: "" })
  assert.equal(await before(event(HOST)), undefined)
})

test("网关层已改过的不再叠一遍", async () => {
  writeState({ enabled: true, mode: "append", persona: PERSONA })
  const out = await before(event(`${PERSONA}\n\n${HOST}`))
  assert.equal(out, undefined, "原样返回,人设不叠两遍")
})

test("关掉之后立刻恢复原样", async () => {
  writeState({ enabled: true, mode: "strict", persona: PERSONA })
  await before(event(HOST))
  writeState({ enabled: false, mode: "strict", persona: PERSONA })
  assert.equal(await before(event(HOST)), undefined, "关了就不该再替换")
})

test("状态文件读不出来时不动,不抛", async () => {
  writeState({ enabled: true, mode: "append", persona: PERSONA })
  const missing = join(HOME, "nope.json")
  // 把状态文件挪走:扩展读不到就该原样放行
  const { renameSync } = await import("node:fs")
  const { statePath } = await import("../lib/native.mjs")
  renameSync(statePath(), missing)
  assert.equal(await before(event(HOST)), undefined)
  renameSync(missing, statePath())
})

test("生成的扩展是自洽的:不 import 本仓库的任何东西", () => {
  const src = render()
  assert.ok(!src.includes("../lib/"), "不该 import 仓库内的相对路径")
  assert.match(src, /import \{ readFileSync \} from "node:fs"/)
  assert.match(src, /before_agent_start/)
  assert.match(src, /magpie-cli-purge/)
})
