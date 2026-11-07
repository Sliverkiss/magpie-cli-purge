// 三种模式,四种 agent API。
//
// 模式:
//   off      不动请求
//   append   人设挂在最前,宿主文本原样
//   strict   宿主文本整段丢掉,只留人设(+ 工作目录,如果网关知道)
//
// strict 最干净,但工具说明一起没了,harness 可能变笨;页面把三档都摆出来,
// 不替用户决定。
//
// 门禁用 ctx 字段判断(不靠文本指纹):agent 必须在白名单里,且请求要有
// tools/query/环境信息 —— 意图判断、自动审批、标题、压缩这些客户端旁路请求
// 没有这些,改了就是事故。

import { agentsAllowed, gateOf, modeOf, personaOf } from "./groups.mjs"

// 模式表只有 groups.mjs 一份;这里 re-export 给测试和页面用,别再抄一份。
export { MODES, DEFAULT_MODE } from "./groups.mjs"

// 旁路请求的工具数下限的默认值在 groups.mjs(gateOf),页面可调。

const SEP = "\n\n"

// textOf 把一处 content(字符串或块数组)读成纯文本。
export function textOf(content) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p && typeof p.text === "string" ? p.text : "")).join("")
  }
  return ""
}

// systemTextOf 是这次请求里的系统提示词文本。没有就返回空串。
export function systemTextOf(body, protocol) {
  if (!body || typeof body !== "object") return ""
  switch (protocol) {
    case "anthropic":
      return textOf(body.system)
    case "chat": {
      // 可能有多段 system/developer(strict 要把它们整段丢掉,诊断也得看全)
      const msgs = Array.isArray(body.messages) ? body.messages : []
      return msgs
        .filter((x) => x && (x.role === "system" || x.role === "developer"))
        .map((m) => textOf(m.content))
        .join(SEP)
    }
    case "responses":
      return typeof body.instructions === "string" ? body.instructions : ""
    case "gemini": {
      // systemInstruction 可以是裸字符串、裸 parts 数组或 {parts} 对象
      // (宿主 geminiText 同款认法)
      const cur = body.systemInstruction || body.system_instruction
      if (typeof cur === "string") return cur
      return Array.isArray(cur) ? textOf(cur) : textOf(cur && cur.parts)
    }
    default:
      return ""
  }
}

// head 把人设放在宿主前面。人设为空时返回宿主本身。
function head(persona, host) {
  if (!persona) return host || ""
  return host ? persona + SEP + host : persona
}

// strictText 是 strict 留下的那一点上下文:工作目录。网关知道就带上。
// 人设为空、cwd 也不知道时返回空串,调用方据此把系统提示词整个去掉。
function strictText(persona, cwd) {
  const dir = typeof cwd === "string" ? cwd.trim().replace(/\\/g, "/") : ""
  const where = dir ? `Current working directory: ${dir}` : ""
  if (!persona) return where
  return where ? persona + SEP + where : persona
}

// ---- 三种 API 各自的落点 ----
//
// 块结构尽量原地保留:Anthropic 的 system 可以是带 cache_control 的块数组,
// 拍平成字符串会让客户端自己的缓存断点失效,每一轮都重新计费。
//
// 人设为空时不塞空块/空消息:结果是空的就把那一处整个去掉。

function anthropicWrite(body, persona, mode, cwd) {
  const cur = body.system
  const blocks =
    typeof cur === "string"
      ? cur
        ? [{ type: "text", text: cur }]
        : []
      : Array.isArray(cur)
        ? cur.filter((b) => b && typeof b === "object").map((b) => ({ ...b }))
        : []

  if (mode === "strict") {
    const text = strictText(persona, cwd)
    if (!text) {
      delete body.system
      return { blocks: 0, dropped: true }
    }
    body.system = [{ type: "text", text }]
    return { blocks: 1 }
  }
  const next = persona ? [{ type: "text", text: persona }, ...blocks] : blocks
  if (next.length) body.system = next
  else delete body.system
  return { blocks: next.length, dropped: next.length === 0 }
}

function chatWrite(body, persona, mode, cwd) {
  if (!Array.isArray(body.messages)) body.messages = []
  const msgs = body.messages
  const isSys = (m) => m && (m.role === "system" || m.role === "developer")
  // strict 的承诺是"宿主文本整段丢掉":多段 system/developer 都得清,
  // 只处理第一条会把后面的宿主文本漏给上游。
  const sysIdx = []
  for (let j = 0; j < msgs.length; j++) if (isSys(msgs[j])) sysIdx.push(j)
  const i = sysIdx.length ? sysIdx[0] : -1

  if (mode === "strict") {
    const text = strictText(persona, cwd)
    // 从后往前删,下标不漂移
    for (let k = sysIdx.length - 1; k >= 1; k--) msgs.splice(sysIdx[k], 1)
    if (!text) {
      if (i >= 0) msgs.splice(i, 1)
      return { blocks: 0, dropped: true }
    }
    if (i >= 0) msgs[i] = { ...msgs[i], content: text }
    else msgs.unshift({ role: "system", content: text })
    return { blocks: 1 }
  }
  if (i < 0) {
    if (!persona) return { blocks: 0, dropped: true }
    msgs.unshift({ role: "system", content: persona })
    return { blocks: 1 }
  }
  const old = msgs[i].content
  // 块数组原地保留(同 anthropicWrite 的道理):拍平会把块上的
  // cache_control 丢掉,每一轮都重新计费。字符串走老路。
  if (Array.isArray(old)) {
    const blocks = old.filter((b) => b && typeof b === "object").map((b) => ({ ...b }))
    msgs[i] = { ...msgs[i], content: persona ? [{ type: "text", text: persona }, ...blocks] : blocks }
    return { blocks: (persona ? 1 : 0) + blocks.length }
  }
  msgs[i] = { ...msgs[i], content: head(persona, textOf(old)) }
  return { blocks: 1 }
}

function responsesWrite(body, persona, mode, cwd) {
  if (mode === "strict") {
    const text = strictText(persona, cwd)
    // 宿主的 system/developer 也可能躺在 input 里(magpie 的 responses 读取
    // 会把它们折进 system),strict 要整段清,不能只清 instructions
    if (Array.isArray(body.input)) {
      body.input = body.input.filter((it) => !it || (it.role !== "system" && it.role !== "developer"))
    }
    if (!text) {
      delete body.instructions
      return { blocks: 0, dropped: true }
    }
    body.instructions = text
    return { blocks: 1 }
  }
  const host = typeof body.instructions === "string" ? body.instructions : ""
  const text = head(persona, host)
  if (!text) {
    delete body.instructions
    return { blocks: 0, dropped: true }
  }
  body.instructions = text
  return { blocks: 1 }
}

function geminiWrite(body, persona, mode, cwd) {
  const key = body.systemInstruction ? "systemInstruction" : body.system_instruction ? "system_instruction" : "systemInstruction"
  const cur = body[key]
  // cur 可能是裸字符串、裸 parts 数组或 {parts} 对象(宿主 geminiText 三种都认)。
  // 裸数组不能当 base 展开:{...array, parts} 会把宿主 parts 全丢。
  const base = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {}
  const parts = Array.isArray(cur)
    ? cur.filter((p) => p && typeof p === "object").map((p) => ({ ...p }))
    : Array.isArray(cur && cur.parts)
      ? cur.parts.filter((p) => p && typeof p === "object").map((p) => ({ ...p }))
      : typeof cur === "string" && cur
        ? [{ text: cur }]
        : []

  if (mode === "strict") {
    const text = strictText(persona, cwd)
    if (!text) {
      delete body[key]
      return { blocks: 0, dropped: true }
    }
    body[key] = { parts: [{ text }] }
    return { blocks: 1 }
  }
  const next = persona ? [{ text: persona }, ...parts] : parts
  if (next.length) body[key] = { ...base, parts: next }
  else delete body[key]
  return { blocks: next.length, dropped: next.length === 0 }
}

const WRITE = {
  anthropic: anthropicWrite,
  chat: chatWrite,
  responses: responsesWrite,
  gemini: geminiWrite,
}

export function supported(protocol) {
  return Object.prototype.hasOwnProperty.call(WRITE, protocol)
}

// toolsCount 数这次请求带了几条工具。除了顶层 tools,还要数藏在消息里的:
// chat 的 mid-conversation 工具加在消息的 tools 字段上,responses 的
// additional_tools 是 input 里的一类条目 —— 宿主解析时才把它们并进 tools,
// 只数顶层会把带工具的真诚对话误判成旁路请求。
function toolsCount(body, protocol) {
  const tools = Array.isArray(body?.tools) ? body.tools : []
  if (protocol === "gemini") {
    // Gemini 把所有 functionDeclarations 包在同一个 tools 元素里
    // (宿主 gemini.go 的 gRequest 就是这个形状),顶层长度恒为 1。
    let n = 0
    for (const t of tools) {
      if (t && Array.isArray(t.functionDeclarations)) n += t.functionDeclarations.length
      else if (t) n++
    }
    return n
  }
  let n = tools.length
  if (protocol === "chat") {
    const msgs = Array.isArray(body?.messages) ? body.messages : []
    for (const m of msgs) if (m && Array.isArray(m.tools)) n += m.tools.length
  } else if (protocol === "responses") {
    const input = Array.isArray(body?.input) ? body.input : []
    for (const it of input) {
      if (it && it.type === "additional_tools" && Array.isArray(it.tools)) n += it.tools.length
    }
  }
  return n
}

// plan 是"这次请求会被怎么改"的完整答案,不改请求体。页面和测试都用它,
// 所以页面上看到的和网关真正做的不会分叉。
// resolved 传已解析好的人设(hook 每请求只解析一次);不传就自己解析。
export function plan(body, protocol, options, ctx = {}, resolved) {
  const o = options && typeof options === "object" ? options : {}
  const mode = modeOf(o)
  if (mode === "off") return { mode, act: false, why: "关着" }
  if (!supported(protocol)) return { mode, act: false, why: `不认的协议 ${protocol || "(空)"}` }

  // ctx 门禁:白名单里的 agent、带工具与环境的对话请求才接管。
  // 三条阈值(工具下限、query 与环境的跳过)页面可调,默认与旧行为一致。
  const gate = gateOf(o)
  const agent = typeof ctx.agent === "string" ? ctx.agent.trim() : ""
  if (!agent || !agentsAllowed(o, agent)) return { mode, act: false, why: "agent 不在白名单" }
  if (toolsCount(body, protocol) < gate.minTools) return { mode, act: false, why: "tools 不足,像旁路请求" }
  if (gate.skipNoQuery && !ctx.query) return { mode, act: false, why: "没有 query,像旁路请求" }
  if (gate.skipNoEnv && !ctx.cwd && !ctx.session) return { mode, act: false, why: "没有环境信息,像旁路请求" }

  const persona = resolved === undefined ? personaOf(o) : resolved
  // 人设可以为空,但只有 strict 有事可做(整段丢掉);append 没有人设就是没动作。
  if (mode === "append" && !persona) return { mode, act: false, why: "append 没有人设可加" }

  const host = systemTextOf(body, protocol)

  // 两层不重复动手:原生扩展(pi / omp)已经在进程内改过,网关再看一次时,
  // 系统提示词就是以人设开头的。认出来就让开,别把人设叠两遍。
  // (人设为空时这个判断不成立 —— startsWith("") 恒真,会误伤。)
  if (persona && host.trim().startsWith(persona)) {
    return { mode, act: false, why: "原生层已经改过了", already: true }
  }

  return {
    mode,
    act: true,
    hostChars: host.length,
    // 解析好的人设带上,rewrite / report 直接用,别再 trim 一遍 512KB
    persona,
  }
}

// rewrite 就地改写请求体,返回 plan 的说明。改不动就返回 act:false,调用方原样放行。
// p 传已算好的 plan(和 rewrite 自己算的一致):省掉每个请求跑两遍门禁。
export function rewrite(body, protocol, options, ctx = {}, p = plan(body, protocol, options, ctx)) {
  if (!p.act) return p

  const cwd = ctx && typeof ctx.cwd === "string" ? ctx.cwd : ""
  const wrote = WRITE[protocol](body, p.persona, p.mode, cwd)
  // 改完的系统提示词有多大。hostChars 是改之前的,这个是改之后的。
  const outChars = systemTextOf(body, protocol).length
  return { ...p, ...wrote, act: true, outChars }
}
