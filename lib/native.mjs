// 原生扩展层:把一份小扩展装进 agent 自己的扩展目录。
//
// 为什么需要这一层:网关层只能改请求体里的文本,而 pi-purge 证明了一个更好的位置
// ——agent 进程内的 before_agent_start,拿到的是拼好的最终提示词,返回的就是替换品。
// 网关拿不到那个位置;原生扩展拿得到。
//
// 扩展文件由本模块生成,文件头写着"别手改",改了下次请求会被覆盖。
//
// 状态放在 ~/.magpie-cli-purge/purge.json,由网关 hook 每次请求镜像一次(options 是
// 唯一真相,页面改的就是它)。原生扩展读这个文件,所以换人设不用重启 agent —— 下一个
// 请求就换。
//
// pi 和 omp 共用一套扩展 API(omp 是 pi 的改名版,靠 piConfig.name / configDir 区分),
// 所以同一个文件两边都能用。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

import { DEFAULT_MODE, personaOf } from "./groups.mjs"

// homeDir 取用户目录:直接读 process.env.HOME 而不是 homedir(),
// 因为 Bun 的 homedir() 不跟随运行时的 HOME 变化(测试需要切换 HOME)。
// isAbsolute 认得 Windows 的 C:\...(startsWith("/") 在 win32 上不成立)。
function homeDir() {
  const env = process.env.HOME?.trim()
  if (env && isAbsolute(env)) return env
  return homedir()
}

// 这一层实现到哪几家。没实现的不写进表,免得声称了做不到。
// dirs 用 getter 惰性取:扩展目录跟随调用时的 HOME。
export const NATIVE = {
  pi: {
    // pi 与 omp 都从这里读扩展
    get dirs() {
      return [join(homeDir(), ".pi", "agent", "extensions"), join(homeDir(), ".omp", "agent", "extensions")]
    },
    file: "magpie-cli-purge.ts",
  },
}

export function statePath() {
  const home = process.env.MAGPIE_CLI_PURGE_HOME?.trim()
  const dir = home && isAbsolute(home) ? home : join(homeDir(), ".magpie-cli-purge")
  return join(dir, "purge.json")
}

// writeState 把 options 镜像成原生扩展读的那份状态。内容没变就不写盘。
// persona 传已解析好的人设(hook 每请求只解析一次);不传就自己解析。
export function writeState(options, persona) {
  const p = statePath()
  const body = {
    enabled: options && options.enabled === true,
    mode: typeof (options && options.mode) === "string" ? options.mode : DEFAULT_MODE,
    persona: persona === undefined ? personaOf(options) : persona,
    at: new Date().toISOString(),
  }
  // 比对不带 at(它每次都是新时间戳,带着比永远不等),写盘才带上
  const flat = (o) => JSON.stringify({ ...o, at: "" }, null, 2) + "\n"
  const text = JSON.stringify(body, null, 2) + "\n"
  try {
    if (existsSync(p)) {
      try {
        if (flat(JSON.parse(readFileSync(p, "utf8"))) === flat(body)) return { path: p, wrote: false }
      } catch {
        /* 旧文件读不出来就重写 */
      }
    }
    mkdirSync(join(p, ".."), { recursive: true })
    writeFileSync(p, text)
    return { path: p, wrote: true }
  } catch {
    return { path: p, wrote: false, error: true }
  }
}

// render 生成扩展源码:off/append/strict 三档,人设替换,不猜宿主文本边界。
export function render() {
  return `// 由 magpie-cli-purge 生成 —— 别手改。改了会在下次请求时被覆盖。
//
// 位置:agent 进程内、before_agent_start,拿到拼好的最终系统提示词,返回替换品。
// 这和 pi-purge 是同一个位置,所以效果一样:不是把宿主身份压住,是清掉。
//
// 状态读 ${statePath()},由 magpie-cli-purge 的网关 hook 每次请求镜像一次。
// 关掉(magpie 插件里那个开关)之后,这个文件不再生效,agent 恢复原样。
import { readFileSync } from "node:fs"

const STATE = ${JSON.stringify(statePath())}

// 每次直接读:文件只有几百字节,而 mtime+size 的缓存键会在
// "同尺寸、同毫秒"重写时读到上一个人设(mtime 刻度粗的文件系统上会这样)。
function state() {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"))
  } catch {
    return null
  }
}

export default function (pi) {
  pi.on("before_agent_start", async function (event) {
    const st = state()
    if (!st || st.enabled !== true) return
    const mode = st.mode === "off" ? "off" : st.mode
    if (mode === "off") return

    // 人设可以为空:strict 空人设 = 整段丢掉;append 空人设 = 没事可做
    const persona = String(st.persona || "").trim()
    const host = String((event && event.systemPrompt) || "")
    const cwd = event && event.systemPromptOptions && event.systemPromptOptions.cwd
      ? String(event.systemPromptOptions.cwd).replace(/\\\\/g, "/")
      : ""
    const where = cwd ? "Current working directory: " + cwd : ""

    if (mode === "strict") {
      const text = persona ? (where ? persona + "\\n\\n" + where : persona) : where
      return { systemPrompt: text }
    }

    // append:空人设没事可做;网关层已改过的不再叠一遍
    if (!persona) return
    if (host.trim().startsWith(persona)) return
    return { systemPrompt: host ? persona + "\\n\\n" + host : persona }
  })
}
`
}

// ensure 按开关装或卸原生扩展,返回做了什么。
//
// 原生层不读 agents 白名单和门禁三项:pi / omp 进程内的 before_agent_start
// 没有网关那种旁路调用(标题、审批),请求都是真对话,白名单在那里没有意义。
// 这是两层语义的差异,不是遗漏。
//
// 装是幂等的:内容一致就不写盘。卸只删自己生成的那一个文件,别的一律不碰。
//
// native:false 也要走到这里(而不是提前 return),否则已经装上的扩展摘不掉,
// 关了 native 却还在 agent 进程里生效。
export function ensure(agent, options) {
  const spec = NATIVE[agent]
  if (!spec) return { agent, action: "none", why: "这一家没有原生扩展点" }

  const on =
    options &&
    options.enabled === true &&
    options.mode !== "off" &&
    options.native !== false
  const body = render()

  const done = []
  for (const dir of spec.dirs) {
    const file = join(dir, spec.file)
    try {
      if (!on) {
        if (existsSync(file)) {
          rmSync(file)
          done.push({ dir, action: "removed" })
        }
        continue
      }
      // 目录不存在说明这台机器没装这一家,不替它造目录
      if (!existsSync(dir)) continue
      if (existsSync(file) && readFileSync(file, "utf8") === body) {
        done.push({ dir, action: "kept" })
        continue
      }
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, body)
      done.push({ dir, action: "wrote" })
    } catch (e) {
      done.push({ dir, action: "failed", why: String(e && e.message ? e.message : e) })
    }
  }
  return { agent, action: on ? "install" : "remove", dirs: done }
}
