// 网关 hook:开关、模式、ctx 门禁、状态回写、原生扩展的装与卸。
//
// 全程跑在临时 HOME 里,不碰真的 ~/.config/magpie,也不碰真的 ~/.pi。
// HOME 必须在 import 之前设好:native.mjs 在模块加载时就算出扩展目录了。

import assert from "node:assert/strict"
import { test } from "node:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const HOME = mkdtempSync(join(tmpdir(), "magpie-cli-purge-hook-"))
process.env.HOME = HOME
process.env.XDG_CONFIG_HOME = join(HOME, ".config")
process.env.MAGPIE_CLI_PURGE_HOME = join(HOME, ".magpie-cli-purge")

const CONFIG = join(HOME, ".config", "magpie")
const PLUGINS = join(CONFIG, "plugins.json")
const PI_EXT = join(HOME, ".pi", "agent", "extensions")
const OMP_EXT = join(HOME, ".omp", "agent", "extensions")

mkdirSync(PI_EXT, { recursive: true })
mkdirSync(OMP_EXT, { recursive: true })
mkdirSync(CONFIG, { recursive: true })

// 本插件的 spec 以 /magpie-cli-purge 结尾,hook 靠这个认出自己那一条
function writePlugins(options) {
  writeFileSync(PLUGINS, JSON.stringify({ plugins: [{ spec: "/somewhere/magpie-cli-purge", off: false, options }] }, null, 2))
}
function readPlugins() {
  return JSON.parse(readFileSync(PLUGINS, "utf8")).plugins[0].options
}

const { onRequest } = await import("../hooks.mjs")

const HOST = "You are an agent harness speaking as a helpful assistant.\n\nDo the task."

const PERSONA = "You are a plain assistant. Answer directly."

// 真 CLI 请求的形状:带一整套工具定义、query 和环境信息
function chat(text) {
  return {
    tools: [{ name: "bash" }, { name: "read" }, { name: "edit" }],
    messages: [{ role: "system", content: text }, { role: "user", content: "hi" }],
  }
}

function ctxFor(over = {}) {
  const reports = []
  return {
    reports,
    ctx: {
      agent: "claude",
      protocol: "chat",
      model: "m",
      cwd: "/work",
      query: "fix the bug",
      session: "s1",
      // magpie 把插件的 options 放进 ctx.options;测试照做
      options: readPlugins(),
      state: {},
      report: (code, bytes) => reports.push([code, bytes]),
      ...over,
    },
  }
}

test("关着时请求一个字都不动", async () => {
  writePlugins({ enabled: false, mode: "append", persona: PERSONA })
  const body = chat(HOST)
  const before = JSON.stringify(body)
  const { ctx, reports } = ctxFor()
  const out = await onRequest(body, ctx)
  assert.equal(out, undefined, "关着就不该返回 body")
  assert.equal(JSON.stringify(body), before)
  assert.deepEqual(reports, [["skipped", 0]])
})

test("append:人设挂最前,宿主文本原样", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const body = chat(HOST)
  const { ctx, reports } = ctxFor()
  const out = await onRequest(body, ctx)
  assert.equal(out, body, "返回的就是改过的 body")
  const sys = body.messages[0].content
  assert.ok(sys.startsWith(PERSONA))
  assert.ok(sys.includes("Do the task."), "宿主文本该留着")
  assert.equal(body.messages[1].content, "hi", "用户消息不该动")
  assert.equal(reports.at(-1)[0], "ready")
})

test("strict:宿主文本整段丢掉,只留人设 + 工作目录", async () => {
  writePlugins({ enabled: true, mode: "strict", persona: PERSONA })
  const body = chat(HOST)
  const { ctx } = ctxFor({ cwd: "/work/x" })
  await onRequest(body, ctx)
  assert.equal(body.messages[0].content, `${PERSONA}\n\nCurrent working directory: /work/x`)
})

test("strict + 人设为空 + 不知道 cwd:系统提示词整个去掉", async () => {
  writePlugins({ enabled: true, mode: "strict", persona: "" })
  const body = chat(HOST)
  const { ctx } = ctxFor({ cwd: "" })
  await onRequest(body, ctx)
  assert.equal(
    body.messages.filter((m) => m.role === "system" || m.role === "developer").length,
    0,
    "system 消息该整条没了,不是留一条空的",
  )
  assert.equal(body.messages.length, 1, "用户消息还在")
})

test("strict + 人设为空 + 知道 cwd:只留工作目录", async () => {
  writePlugins({ enabled: true, mode: "strict", persona: "" })
  const body = chat(HOST)
  const { ctx } = ctxFor({ cwd: "/work/x" })
  await onRequest(body, ctx)
  assert.equal(body.messages[0].content, "Current working directory: /work/x")
})

test("append + 人设为空:真的没事可做", async () => {
  writePlugins({ enabled: true, mode: "append", persona: "" })
  const body = chat(HOST)
  const before = JSON.stringify(body)
  const { ctx, reports } = ctxFor()
  assert.equal(await onRequest(body, ctx), undefined)
  assert.equal(JSON.stringify(body), before)
  assert.deepEqual(reports, [["skipped", 0]])
})

test("人设为空时不会误判成「原生层已经改过」", async () => {
  // startsWith("") 恒真,这个坑要有人盯着
  writePlugins({ enabled: true, mode: "strict", persona: "" })
  const body = chat(HOST)
  const { ctx } = ctxFor({ cwd: "" })
  const out = await onRequest(body, ctx)
  assert.equal(out, body, "该真的动手,不该跳过")
  assert.equal(body.messages.filter((m) => m.role === "system").length, 0)
})

test("ctx 门禁:agent 不在白名单则原样放行", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA, agents: ["claude"] })
  const body = chat(HOST)
  const before = JSON.stringify(body)
  const { ctx, reports } = ctxFor({ agent: "codex" })
  assert.equal(await onRequest(body, ctx), undefined)
  assert.equal(JSON.stringify(body), before)
  assert.equal(reports.at(-1)[0], "skipped")
})

test("ctx 门禁:白名单之内的 agent 会被改", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA, agents: ["claude"] })
  const body = chat(HOST)
  const { ctx } = ctxFor({ agent: "claude" })
  await onRequest(body, ctx)
  assert.ok(body.messages[0].content.startsWith(PERSONA))
})

test("ctx 门禁:空名单 = 全部放行改写", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA, agents: [] })
  const body = chat(HOST)
  const { ctx } = ctxFor({ agent: "whatever-cli" })
  await onRequest(body, ctx)
  assert.ok(body.messages[0].content.startsWith(PERSONA))
})

test("ctx 门禁:tools 不足像旁路请求,放行", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const body = chat(HOST)
  body.tools = [{ name: "bash" }]
  const before = JSON.stringify(body)
  const { ctx, reports } = ctxFor()
  assert.equal(await onRequest(body, ctx), undefined)
  assert.equal(JSON.stringify(body), before)
  assert.equal(reports.at(-1)[0], "skipped")
})

test("ctx 门禁:没有 query 像旁路请求,放行", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const body = chat(HOST)
  const before = JSON.stringify(body)
  const { ctx, reports } = ctxFor({ query: "" })
  assert.equal(await onRequest(body, ctx), undefined)
  assert.equal(JSON.stringify(body), before)
  assert.equal(reports.at(-1)[0], "skipped")
})

test("ctx 门禁:没有环境信息像旁路请求,放行", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const body = chat(HOST)
  const before = JSON.stringify(body)
  const { ctx, reports } = ctxFor({ cwd: "", session: "" })
  assert.equal(await onRequest(body, ctx), undefined)
  assert.equal(JSON.stringify(body), before)
  assert.equal(reports.at(-1)[0], "skipped")
})

test("不再往 plugins.json 写状态(宿主盯着它的 mtime,每请求改一次都会重启宿主)", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const { ctx } = ctxFor({ agent: "claude", protocol: "chat", model: "auto/x" })
  await onRequest(chat(HOST), ctx)
  const o = readPlugins()
  assert.equal(o.status, undefined, "options.status 不该被写")
})

test("状态挂在这条请求的 state 上", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const { ctx } = ctxFor({ agent: "claude", protocol: "chat", model: "auto/x" })
  await onRequest(chat(HOST), ctx)
  assert.ok(ctx.state.purge && ctx.state.purge.at, "应当有 status")
  assert.equal(ctx.state.purge.agent, "claude")
  assert.equal(ctx.state.purge.mode, "append")
  assert.ok(ctx.state.purge.hostChars > 0)
  assert.ok(ctx.state.purge.outChars > ctx.state.purge.hostChars)
})

test("开着时把原生扩展装进 pi 和 omp", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const { ctx } = ctxFor()
  await onRequest(chat(HOST), ctx)
  const file = "magpie-cli-purge.ts"
  assert.ok(existsSync(join(PI_EXT, file)), "pi 的扩展该装上")
  assert.ok(existsSync(join(OMP_EXT, file)), "omp 的扩展该装上")
  const src = readFileSync(join(PI_EXT, file), "utf8")
  assert.match(src, /before_agent_start/, "扩展该注册那个钩子")
})

test("native:false 时把已经装上的扩展摘掉", async () => {
  const file = join(PI_EXT, "magpie-cli-purge.ts")
  // 先装上
  writePlugins({ enabled: true, mode: "append", persona: PERSONA, native: true })
  await onRequest(chat(HOST), ctxFor().ctx)
  assert.ok(existsSync(file), "先该装上")
  // 再关掉原生层:文件必须被摘掉,否则关了却还在进程里生效
  writePlugins({ enabled: true, mode: "append", persona: PERSONA, native: false })
  await onRequest(chat(HOST), ctxFor().ctx)
  assert.ok(!existsSync(file), "native:false 该摘掉扩展")
  assert.ok(!existsSync(join(OMP_EXT, "magpie-cli-purge.ts")))
})

test("关掉时把原生扩展摘掉", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const file = join(PI_EXT, "magpie-cli-purge.ts")
  await onRequest(chat(HOST), ctxFor().ctx)
  assert.ok(existsSync(file))
  // 换个 options 让 hook 重新做一次 settle
  writePlugins({ enabled: false, mode: "append", persona: PERSONA })
  await onRequest(chat(HOST), ctxFor().ctx)
  assert.ok(!existsSync(file), "关了就该摘掉")
  assert.ok(!existsSync(join(OMP_EXT, "magpie-cli-purge.ts")))
})

test("native:false 就不碰扩展目录", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA, native: false })
  await onRequest(chat(HOST), ctxFor().ctx)
  assert.ok(!existsSync(join(PI_EXT, "magpie-cli-purge.ts")))
})

test("状态文件镜像给原生扩展读", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  await onRequest(chat(HOST), ctxFor().ctx)
  const st = JSON.parse(readFileSync(join(HOME, ".magpie-cli-purge", "purge.json"), "utf8"))
  assert.equal(st.enabled, true)
  assert.equal(st.mode, "append")
  assert.equal(st.persona, PERSONA)
})

test("四种协议都改得动", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const cases = [
    ["anthropic", { tools: [{}, {}, {}], system: HOST }],
    ["chat", chat(HOST)],
    ["responses", { tools: [{}, {}, {}], instructions: HOST }],
    ["gemini", { tools: [{}, {}, {}], systemInstruction: { parts: [{ text: HOST }] } }],
  ]
  for (const [protocol, body] of cases) {
    const { ctx, reports } = ctxFor({ protocol })
    const out = await onRequest(body, ctx)
    assert.equal(out, body, `${protocol} 该被改`)
    assert.equal(reports.at(-1)[0], "ready", `${protocol} 该报 ready`)
    assert.ok(JSON.stringify(body).startsWith(`{"tools"`), `${protocol} 改写照做`)
  }
})

test("body 不是对象时原样放行,不抛", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  for (const bad of [null, undefined, "x", 42]) {
    assert.equal(await onRequest(bad, ctxFor().ctx), undefined)
  }
})

test("options 坏掉也不抛", async () => {
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  assert.equal(await onRequest(chat(HOST), { protocol: "chat" }), undefined)
})

test("plugins.json 里没有本插件时,改写照做且不碰它", async () => {
  // ctx.options 照常给(那是 magpie 给 hook 的),但 plugins.json 里没有本插件:
  // 改写照做,plugins.json 一个字节都不该动
  const options = { enabled: true, mode: "append", persona: PERSONA }
  writeFileSync(PLUGINS, JSON.stringify({ plugins: [{ spec: "/elsewhere/other", options: {} }] }))
  const { ctx } = ctxFor({ options })
  const body = chat(HOST)
  await onRequest(body, ctx)
  assert.ok(body.messages[0].content.startsWith(PERSONA), "改写照做")
  const doc = JSON.parse(readFileSync(PLUGINS, "utf8"))
  assert.equal(doc.plugins.length, 1, "不该凭空加一条")
  assert.equal(doc.plugins[0].spec, "/elsewhere/other")
})

test("扩展目录后来才出现时,下个请求会补装(失败不缓存)", async () => {
  // 先让两台机器都"没装 agent":ensure 找不到目录,什么都没做
  rmSync(PI_EXT, { recursive: true, force: true })
  rmSync(OMP_EXT, { recursive: true, force: true })
  writePlugins({ enabled: true, mode: "append", persona: PERSONA })
  const first = ctxFor()
  await onRequest(chat(HOST), first.ctx)
  assert.ok(!existsSync(join(PI_EXT, "magpie-cli-purge.ts")), "目录不在,装不了")

  // 用户之后才装 pi:options 没变,下一个请求也得补上
  mkdirSync(PI_EXT, { recursive: true })
  const second = ctxFor()
  await onRequest(chat(HOST), second.ctx)
  assert.ok(existsSync(join(PI_EXT, "magpie-cli-purge.ts")), "下个请求该补装")
})
