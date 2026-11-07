// options 解析:一份模式、一个人设、agent 白名单。
// 未知键一律忽略,形状不对按默认值处理,绝不抛错。

export const MODES = ["off", "append", "strict"]
export const DEFAULT_MODE = "append"

// 人设正文上限(按 JS 字符串长度近似字节):超了当空串走 skip 路径,
// 不让一次超大粘贴吃掉 hook 的 1s 预算。
// 和页面导入的上限(page/app.js 的 PERSONA_MAX)、README 说的是同一个数 ——
// 两边不一致时,页面拦下的文件网关却认,或者反过来,人只会看到"没生效"。
const MAX_PERSONA_CHARS = 256 * 1024

function obj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {}
}

export function libraryOf(options) {
  const lib = obj(options && options.library)
  return { personas: obj(lib.personas) }
}

export function modeOf(options) {
  const m = options && options.mode
  return MODES.includes(m) ? m : DEFAULT_MODE
}

export function personaBody(options) {
  const p = options && libraryOf(options).personas[options.persona]
  if (!p || typeof p.body !== "string" || p.body.length > MAX_PERSONA_CHARS) return ""
  return p.body.trim()
}

// personaOf 兼容两种配置:库里的人设键,或直接写正文。
// 库里有这个键就按库取;库里没有就当字符串是正文。两条路都受上限保护。
export function personaOf(options) {
  const o = obj(options)
  const lib = libraryOf(o).personas
  if (typeof o.persona === "string" && Object.prototype.hasOwnProperty.call(lib, o.persona)) {
    return personaBody(o)
  }
  if (typeof o.persona !== "string" || o.persona.length > MAX_PERSONA_CHARS) return ""
  return o.persona.trim()
}

// agentsAllowed 读白名单:空 = 全部放行(老语义,配置缺键时行为不变);
// 非空 = 只有名单里的 ctx.agent 会被改。名单项按 trim 后比较(手改配置时
// 多打一个空格不该静默失效);agent 本身由 plan 先 trim。
export function agentsAllowed(options, agent) {
  const list = options && Array.isArray(options.agents) ? options.agents : []
  if (!list.length) return true
  return list.some((x) => typeof x === "string" && x.trim() === agent)
}

// 门禁默认值:tools 至少 3 条、没有 query 跳过、没有 cwd/session 跳过。
// 这三条都是用来滤掉旁路请求(intent/approval/title/compaction 那点调用),
// 页面可以逐项改。
export const MIN_TOOLS_DEFAULT = 3

// gateOf 读门禁形状:非法值一律回默认。minTools 取整数,负数按 0;
// 两个开关缺失按开(true = 保持跳过逻辑)。
export function gateOf(options) {
  const o = obj(options)
  let minTools = Number.isFinite(o.minTools) ? Math.floor(o.minTools) : MIN_TOOLS_DEFAULT
  if (minTools < 0) minTools = 0
  return {
    minTools,
    skipNoQuery: o.skipNoQuery !== false,
    skipNoEnv: o.skipNoEnv !== false,
  }
}
