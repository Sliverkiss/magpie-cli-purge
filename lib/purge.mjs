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

// geminiFilled 判一处 systemInstruction 有没有内容:裸串、裸 parts 数组、{parts} 都算。
function geminiFilled(v) {
  if (v == null) return false
  if (typeof v === "string") return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return typeof v === "object" ? Object.keys(v).length > 0 : false
}

// geminiKey 两个拼法都认,空的当没写 —— 否则 systemInstruction 里放个空对象
// 就把 system_instruction 里的宿主文本挡在外面:读不到,strict 也清不掉。
function geminiKey(body) {
  if (geminiFilled(body.systemInstruction)) return "systemInstruction"
  if (geminiFilled(body.system_instruction)) return "system_instruction"
  return body.systemInstruction === undefined && body.system_instruction !== undefined
    ? "system_instruction"
    : "systemInstruction"
}

// systemMsgs 是 messages 里的 system/developer 条目(可能有多段)。
function systemMsgs(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : []
  return msgs.filter((x) => x && (x.role === "system" || x.role === "developer"))
}

function geminiText(body) {
  const cur = body[geminiKey(body)]
  if (typeof cur === "string") return cur
  return Array.isArray(cur) ? textOf(cur) : textOf(cur && cur.parts)
}

// headTextOf 是请求里排在最前面的那份系统文本 —— 原生层改完,它一定以人设开头。
// 别拿 systemTextOf 判"已经改过":那份是给诊断用的拼接串,自己拼出来的分隔符
// 会骗自己(人设 + messages 里的宿主文本,看起来正好是"人设 + 空行 + 宿主")。
function headTextOf(body, protocol) {
  if (!body || typeof body !== "object") return ""
  switch (protocol) {
    case "anthropic":
      return textOf(body.system)
    case "chat": {
      const m = systemMsgs(body)[0]
      return m ? textOf(m.content) : ""
    }
    case "responses":
      return typeof body.instructions === "string" ? body.instructions : ""
    case "gemini":
      return geminiText(body)
    default:
      return ""
  }
}

// systemTextOf 是这次请求里所有系统提示词文本拼在一起,诊断用。
// anthropic 的宿主文本可能同时躺在 body.system 和 messages 里,两处都算。
export function systemTextOf(body, protocol) {
  if (!body || typeof body !== "object") return ""
  switch (protocol) {
    case "anthropic":
      return [textOf(body.system), ...systemMsgs(body).map((m) => textOf(m.content))].filter(Boolean).join(SEP)
    case "chat":
      return systemMsgs(body)
        .map((m) => textOf(m.content))
        .join(SEP)
    case "responses":
      return typeof body.instructions === "string" ? body.instructions : ""
    case "gemini":
      return geminiText(body)
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

// dedupeSystem 丢掉已经被 hostText 覆盖的 system/developer 条目:客户端把同一份
// 宿主文本同时发在两处时,append 也只该留一份(每次省几 k token)。
// 认不出重复的一律留着 —— 宁可多花 token,不能丢宿主内容。
function dedupeSystem(list, hostText) {
  if (!Array.isArray(list)) return list
  const host = String(hostText || "").trim()
  if (!host) return list
  return list.filter((m) => {
    if (!m || (m.role !== "system" && m.role !== "developer")) return true
    const t = textOf(m.content).trim()
    return !t || !host.includes(t)
  })
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
    // 宿主系统提示词可能同时躺在 messages 里(Claude Desktop / Code 会发两份),
    // 只清 body.system,上游仍看得到那一份大的,人设等于白挂。
    if (Array.isArray(body.messages)) {
      body.messages = body.messages.filter((m) => !(m && (m.role === "system" || m.role === "developer")))
    }
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
  // append 也去重:宿主文本同时躺在 messages 里时只留 body.system 这一份
  if (Array.isArray(body.messages)) body.messages = dedupeSystem(body.messages, textOf(next))
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
  // append 也去重:input 里的 system/developer 条目若与 instructions 重复就删掉
  if (Array.isArray(body.input)) body.input = dedupeSystem(body.input, text)
  return { blocks: 1 }
}

function geminiWrite(body, persona, mode, cwd) {
  const key = geminiKey(body)
  // 另一种拼法要是空的就顺手清掉,别让它留在请求里冒充"没有系统提示词"
  const alias = key === "systemInstruction" ? "system_instruction" : "systemInstruction"
  if (body[alias] !== undefined && !geminiFilled(body[alias])) delete body[alias]
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
  const top = headTextOf(body, protocol).trim()

  // 两层不重复动手:原生扩展(pi / omp)已经在进程内改过,网关再看一次时,
  // 系统提示词就是"人设 + 空行 + 宿主"(strict 无 cwd 时只有人设)。
  // 不能只判 startsWith(persona):人设恰好是宿主提示词开头时会误判成"改过了",
  // 整段跳过 —— 人设静默不生效,日志里只有一句 already。
  // strict 例外:别处(messages)还藏着宿主文本时要照常清,那不是"已经改过"。
  if (persona) {
    const ours = top === persona || top.startsWith(persona + SEP)
    const extras = host.trim() !== top
    if (ours && !(mode === "strict" && extras)) {
      return { mode, act: false, why: "原生层已经改过了", already: true }
    }
  }

  return {
    mode,
    act: true,
    hostChars: host.length,
    // 解析好的人设带上,rewrite / report 直接用,别再 trim 一遍 256KB
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
