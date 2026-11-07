// 三种模式、四种协议、ctx 门禁、人设为空的只删不加路径。

import assert from "node:assert/strict"
import { test } from "node:test"

import { plan, rewrite, systemTextOf, textOf, MODES, DEFAULT_MODE } from "../lib/purge.mjs"

const HOST = `You are an agent harness speaking as a helpful assistant.

Available tools:
- read: Read file contents
- bash: Run commands

Guidelines:
- Be concise`

const PERSONA = "You are a plain assistant. Answer directly."

// 真 CLI 请求的形状
const body = (systemText) => ({
  tools: [{ name: "bash" }, { name: "read" }, { name: "edit" }],
  messages: [{ role: "system", content: systemText }, { role: "user", content: "hi" }],
})
const ctx = (over = {}) => ({ agent: "claude", query: "fix", cwd: "/work", session: "s1", ...over })

// ---- 模式 ----

test("append 不动宿主文本,人设挂最前", () => {
  const b = body(HOST)
  rewrite(b, "chat", { mode: "append", persona: PERSONA }, ctx())
  assert.ok(b.messages[0].content.startsWith(PERSONA))
  assert.ok(b.messages[0].content.includes("Available tools:"))
  assert.equal(b.messages[1].content, "hi")
})

test("strict 把宿主文本整段丢掉,只留人设与 cwd", () => {
  const b = body(HOST)
  rewrite(b, "chat", { mode: "strict", persona: PERSONA }, ctx({ cwd: "/work/x" }))
  assert.equal(b.messages[0].content, `${PERSONA}\n\nCurrent working directory: /work/x`)
})

test("chat strict:多段 system/developer 都要清,别把后面的宿主文本漏给上游", () => {
  const b = {
    tools: [{ name: "a" }, { name: "b" }, { name: "c" }],
    messages: [
      { role: "system", content: HOST },
      { role: "user", content: "hi" },
      { role: "developer", content: "LATER HOST TEXT" },
    ],
  }
  rewrite(b, "chat", { mode: "strict", persona: PERSONA }, ctx({ cwd: "" }))
  assert.equal(b.messages.length, 2, "developer 该整段删掉")
  assert.equal(b.messages[0].content, PERSONA)
  assert.equal(b.messages[1].content, "hi")
  assert.ok(!JSON.stringify(b.messages).includes("LATER HOST TEXT"))
})

test("chat 诊断:hostChars 把多段 system/developer 都算上", () => {
  const b = {
    tools: [{}, {}, {}],
    messages: [
      { role: "system", content: "abc" },
      { role: "user", content: "hi" },
      { role: "developer", content: "def" },
    ],
  }
  // 人设故意不匹配,走到 act:true
  assert.equal(systemTextOf(b, "chat"), "abc\n\ndef")
})

test("人设恰好是宿主提示词的前缀时,认成原生层已经改过,让开", () => {
  const b = body(HOST)
  const p = plan(b, "chat", { mode: "append", persona: "You are an agent harness" }, ctx())
  assert.equal(p.act, false)
  assert.equal(p.already, true)
})

test("没写模式时用默认那一档(和页面一致:append)", () => {
  assert.equal(DEFAULT_MODE, "append", "默认档变了就要改这条,以及页面")
  const b = body(HOST)
  const p = plan(b, "chat", { persona: PERSONA }, ctx())
  assert.equal(p.mode, DEFAULT_MODE)
  assert.equal(p.act, true)
})

test("模式表就是那三个", () => {
  assert.deepEqual(MODES, ["off", "append", "strict"])
})

// ---- ctx 门禁 ----

test("门禁:agent 不在白名单,plan 不动手", () => {
  const b = body(HOST)
  const p = plan(b, "chat", { mode: "append", persona: PERSONA, agents: ["codex"] }, ctx())
  assert.equal(p.act, false)
  assert.match(p.why, /白名单/)
})

test("门禁:空名单 = 全部放行", () => {
  const b = body(HOST)
  const p = plan(b, "chat", { mode: "append", persona: PERSONA, agents: [] }, ctx({ agent: "any-cli" }))
  assert.equal(p.act, true)
})

test("门禁:agent 为空串不算", () => {
  const b = body(HOST)
  const p = plan(b, "chat", { mode: "append", persona: PERSONA }, ctx({ agent: "" }))
  assert.equal(p.act, false)
})

test("门禁:tools 不足像旁路请求", () => {
  const b = body(HOST)
  b.tools = [{ name: "bash" }]
  const p = plan(b, "chat", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(p.act, false)
  assert.match(p.why, /tools/)
})

test("门禁:strict 也不给旁路请求塞人设", () => {
  const b = { tools: [{}, {}, {}], messages: [{ role: "user", content: "hi" }] }
  const p = plan(b, "chat", { mode: "strict", persona: PERSONA }, ctx({ query: "" }))
  assert.equal(p.act, false)
})

test("门禁:没有环境信息像旁路请求", () => {
  const b = body(HOST)
  const p = plan(b, "chat", { mode: "append", persona: PERSONA }, ctx({ cwd: "", session: "" }))
  assert.equal(p.act, false)
})

// ---- 四种协议 ----

test("chat:人设挂最前,宿主文本原样", () => {
  const b = body(HOST)
  const p = rewrite(b, "chat", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(p.act, true)
  assert.equal(b.messages.length, 2, "不该多出一条消息")
  assert.ok(b.messages[0].content.startsWith(PERSONA))
  assert.ok(b.messages[0].content.includes("Available tools:"), "宿主文本该留着")
})

test("chat:没有 system 消息时 append 补一条", () => {
  const b = { tools: [{}, {}, {}], messages: [{ role: "user", content: "hi" }] }
  rewrite(b, "chat", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(b.messages.length, 2)
  assert.equal(b.messages[0].role, "system")
  assert.equal(b.messages[0].content, PERSONA)
})

test("chat:strict 只留人设与工作目录", () => {
  const b = body(HOST)
  rewrite(b, "chat", { mode: "strict", persona: PERSONA }, ctx({ cwd: "/work" }))
  assert.equal(b.messages[0].content, `${PERSONA}\n\nCurrent working directory: /work`)
})

test("chat:内容本来就是块数组时,块结构原地保留,cache_control 不丢", () => {
  const b = {
    tools: [{}, {}, {}],
    messages: [{ role: "system", content: [{ type: "text", text: HOST, cache_control: { type: "ephemeral" } }] }],
  }
  rewrite(b, "chat", { mode: "append", persona: PERSONA }, ctx())
  assert.ok(Array.isArray(b.messages[0].content), "不该拍平成字符串")
  assert.equal(b.messages[0].content[0].text, PERSONA)
  assert.deepEqual(b.messages[0].content[1].cache_control, { type: "ephemeral" }, "缓存断点必须留着")
})

test("anthropic:块结构原地保留,cache_control 不丢", () => {
  const b = {
    tools: [{}, {}, {}],
    system: [
      { type: "text", text: HOST, cache_control: { type: "ephemeral" } },
      { type: "text", text: "Extra block." },
    ],
  }
  rewrite(b, "anthropic", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(b.system.length, 3, "人设 + 原来的两块")
  assert.equal(b.system[0].text, PERSONA)
  assert.ok(b.system[1].text.includes("agent harness"), "append 原样保留宿主文本")
  assert.deepEqual(b.system[1].cache_control, { type: "ephemeral" }, "缓存断点必须留着")
  assert.equal(b.system[2].text, "Extra block.")
})

test("anthropic:system 是字符串时也能改", () => {
  const b = { tools: [{}, {}, {}], system: HOST }
  rewrite(b, "anthropic", { mode: "append", persona: PERSONA }, ctx())
  assert.ok(Array.isArray(b.system))
  assert.equal(b.system[0].text, PERSONA)
})

test("responses:改 instructions", () => {
  const b = { tools: [{}, {}, {}], instructions: HOST, input: [] }
  rewrite(b, "responses", { mode: "append", persona: PERSONA }, ctx())
  assert.ok(b.instructions.startsWith(PERSONA))
  assert.ok(b.instructions.includes("Available tools:"))
})

test("responses strict:input 里的 system/developer 条目也要清掉", () => {
  // 宿主会把 input 里的 system/developer 折进 system,只清 instructions 会漏
  const b = {
    tools: [{}, {}, {}],
    instructions: HOST,
    input: [
      { type: "message", role: "developer", content: "LATER HOST TEXT" },
      { type: "message", role: "user", content: "hi" },
    ],
  }
  rewrite(b, "responses", { mode: "strict", persona: PERSONA }, ctx({ cwd: "" }))
  assert.equal(b.instructions, PERSONA)
  assert.equal(b.input.length, 1)
  assert.equal(b.input[0].role, "user")
})

test("responses 门禁:additional_tools 里的工具也算数", () => {
  const b = {
    tools: [],
    instructions: HOST,
    input: [{ type: "additional_tools", tools: [{}, {}, {}] }],
  }
  const p = plan(b, "responses", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(p.act, true, "工具藏在 input 里也是真诚对话")
})

test("chat 门禁:消息上的 tools 也算数(宿主解析时才并进 tools)", () => {
  const b = {
    tools: [],
    messages: [
      { role: "system", content: HOST, tools: [{ name: "a" }, { name: "b" }, { name: "c" }] },
      { role: "user", content: "hi" },
    ],
  }
  const p = plan(b, "chat", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(p.act, true)
})

test("gemini:改 systemInstruction.parts", () => {
  const b = { tools: [{}, {}, {}], systemInstruction: { parts: [{ text: HOST }] }, contents: [] }
  rewrite(b, "gemini", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(b.systemInstruction.parts.length, 2)
  assert.equal(b.systemInstruction.parts[0].text, PERSONA)
  assert.ok(b.systemInstruction.parts[1].text.includes("Available tools:"))
})

test("gemini:下划线拼法也认", () => {
  const b = { tools: [{}, {}, {}], system_instruction: { parts: [{ text: HOST }] } }
  rewrite(b, "gemini", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(b.system_instruction.parts[0].text, PERSONA)
})

// Gemini 把所有函数声明包进同一个 tools 元素(宿主 gemini.go gRequest 的形状),
// 顶层长度恒为 1 —— 直接数长度会把每个真 Gemini 请求都挡在门外
test("gemini:函数声明包在同一个 tools 元素里,数 functionDeclarations", () => {
  const b = {
    tools: [{ functionDeclarations: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] }],
    systemInstruction: { parts: [{ text: HOST }] },
    contents: [],
  }
  const p = plan(b, "gemini", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(p.act, true, "4 条函数声明该过 3 条的门,不该被顶层长度 1 挡住")
})

test("gemini:functionDeclarations 不足时仍像旁路请求", () => {
  const b = {
    tools: [{ functionDeclarations: [{ name: "a" }] }],
    systemInstruction: { parts: [{ text: HOST }] },
    contents: [],
  }
  const p = plan(b, "gemini", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(p.act, false)
  assert.match(p.why, /tools/)
})

// systemInstruction 可以是裸字符串(宿主 geminiText 同款认法),
// 展开字符串会把每个字符变成下标键发上游
test("gemini:systemInstruction 是裸字符串时,改完还是正常的 parts,不把字符串展开成下标键", () => {
  const b = { tools: [{}, {}, {}], systemInstruction: HOST, contents: [] }
  rewrite(b, "gemini", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(b.systemInstruction.parts[0].text, PERSONA)
  assert.ok(b.systemInstruction.parts[1].text.includes("agent harness"), "宿主文本该留着")
  assert.equal(Object.keys(b.systemInstruction).filter((k) => !isNaN(k)).length, 0, "不该有数字下标键")
})

test("gemini:systemInstruction 是裸 parts 数组时,宿主的 parts 不能丢", () => {
  // 宿主 geminiText 也认裸数组;把数组当对象展开会把 parts 全丢掉
  const b = { tools: [{}, {}, {}], systemInstruction: [{ text: HOST }], contents: [] }
  rewrite(b, "gemini", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(b.systemInstruction.parts[0].text, PERSONA)
  assert.ok(b.systemInstruction.parts[1].text.includes("agent harness"), "宿主文本该留着")
  assert.equal(b.systemInstruction.parts.length, 2)
})

test("systemTextOf 四种协议都读得出来", () => {
  assert.equal(systemTextOf({ system: "A" }, "anthropic"), "A")
  assert.equal(systemTextOf({ system: [{ type: "text", text: "A" }] }, "anthropic"), "A")
  assert.equal(systemTextOf({ messages: [{ role: "developer", content: "B" }] }, "chat"), "B")
  assert.equal(systemTextOf({ instructions: "C" }, "responses"), "C")
  assert.equal(systemTextOf({ systemInstruction: { parts: [{ text: "D" }] } }, "gemini"), "D")
  assert.equal(systemTextOf({ systemInstruction: [{ text: "E" }] }, "gemini"), "E")
})

// ---- 决策 ----

test("关着 / 协议不认 都不动请求", () => {
  const b = body(HOST)
  const before = JSON.stringify(b)

  assert.equal(plan(b, "chat", { mode: "off", persona: PERSONA }, ctx()).act, false)
  assert.equal(plan(b, "unknown", { mode: "append", persona: PERSONA }, ctx()).act, false)

  assert.equal(JSON.stringify(b), before, "body 一个字都不该动")
})

test("协议不认时,不改请求体并说明原因", () => {
  const b = body(HOST)
  const before = JSON.stringify(b)
  const p = rewrite(b, "unknown", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(p.act, false)
  assert.match(p.why, /不认的协议/)
  assert.equal(JSON.stringify(b), before, "body 一个字都不该动")
})

test("rewrite 报出改完的大小,和改之前一比就知道动没动", () => {
  const strictBody = body(HOST)
  const strict = rewrite(strictBody, "chat", { mode: "strict", persona: "P." }, ctx())
  assert.equal(strict.hostChars, HOST.length, "hostChars 是改之前的大小")
  assert.equal(strict.outChars, strictBody.messages[0].content.length)
  assert.ok(strict.outChars < 50, "strict 之后只剩人设与 cwd")

  const appendBody = body(HOST)
  const append = rewrite(appendBody, "chat", { mode: "append", persona: PERSONA }, ctx())
  assert.ok(append.outChars > append.hostChars, "append 之后变大了")
})

// ---- 人设为空 ----

test("人设为空 + strict + 不知道 cwd:系统提示词整个去掉", () => {
  const cases = [
    ["anthropic", { tools: [{}, {}, {}], system: HOST }, (b) => b.system],
    ["chat", body(HOST), (b) => b.messages.find((m) => m.role === "system")],
    ["responses", { tools: [{}, {}, {}], instructions: HOST }, (b) => b.instructions],
    ["gemini", { tools: [{}, {}, {}], systemInstruction: { parts: [{ text: HOST }] } }, (b) => b.systemInstruction],
  ]
  for (const [protocol, b, read] of cases) {
    rewrite(b, protocol, { mode: "strict", persona: "" }, ctx({ cwd: "" }))
    assert.equal(read(b), undefined, `${protocol} 该整处去掉,而不是留个空的`)
  }
  assert.equal(cases[1][1].messages.length, 1, "用户消息还在")
})

test("人设为空 + strict + 知道 cwd:只留工作目录", () => {
  const b = body(HOST)
  rewrite(b, "chat", { mode: "strict", persona: "" }, ctx({ cwd: "/somewhere" }))
  assert.equal(b.messages[0].content, "Current working directory: /somewhere")
})

test("人设为空 + append:没事可做", () => {
  const b = body(HOST)
  const before = JSON.stringify(b)
  const p = rewrite(b, "chat", { mode: "append", persona: "" }, ctx())
  assert.equal(p.act, false)
  assert.match(p.why, /append/)
  assert.equal(JSON.stringify(b), before)
})

test("原生层已经改过的不再改一遍", () => {
  // 原生扩展在进程内换过之后,系统提示词就是以人设开头的
  const afterNative = body(`${PERSONA}\n\n${HOST}`)
  const p = plan(afterNative, "chat", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(p.act, false)
  assert.equal(p.already, true)
  assert.match(p.why, /原生层/)
})

test("plan 不改请求体", () => {
  const b = body(HOST)
  const before = JSON.stringify(b)
  const p = plan(b, "chat", { mode: "append", persona: PERSONA }, ctx())
  assert.equal(p.act, true)
  assert.equal(JSON.stringify(b), before, "plan 是只读的")
})

test("textOf 拼接字符串与文本块", () => {
  assert.equal(textOf("A"), "A")
  assert.equal(textOf([{ type: "text", text: "A" }, "B"]), "AB")
  assert.equal(textOf(null), "")
})
