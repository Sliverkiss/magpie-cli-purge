// magpie-cli-purge 的网关 hook:经过网关的 agent 请求,系统提示词按人设与模式改写。
//
// 这是 magpie 的异步 gateway request hook(Bun,每请求一次),不是中间件:
//   - 中间件跑在 moejs 里,没有 fs、没有 fetch,而且拿不到 cwd;
//   - hook 有 fs 和网络,能拿到 ctx.cwd —— strict 模式要靠它补上工作目录;
//   - hook 才能装原生扩展(第二层)。
//
// 两层:
//   网关层(本文件)  所有经过网关的 agent,识别靠 ctx 字段(agent 白名单 + tools/query/环境)
//   原生层(lib/native.mjs)  pi / omp 的进程内扩展
//
// 两层的开关、模式、人设是同一份:页面改的是插件的 options,本文件每次请求把它
// 镜像到 ~/.magpie-cli-purge/purge.json,原生扩展读那一份。所以换人设不用重启任何东西。
//
// 全部 fail-open:改不动就原样放行,绝不把 agent 的请求弄挂。

import { plan, rewrite } from "./lib/purge.mjs"
import { personaOf } from "./lib/groups.mjs"
import { ensure, writeState } from "./lib/native.mjs"

// settle 是"把 options 镜像到磁盘"的那些事:状态文件、原生扩展。
// 每请求都跑:writeState 内容没变就不写盘,ensure 内容一致就不写文件,
// 成本是一次小文件读 + 几次 stat —— 换来的是外部删掉扩展、agent 后装、
// 上次写盘失败这几种情况都会在下一个请求自愈,不需要等 options 再变一次。
function settle(o, persona) {
  const notes = []
  try {
    const w = writeState(o, persona)
    notes.push({ state: w.path, wrote: !!w.wrote, ...(w.error ? { error: true } : {}) })
  } catch (e) {
    notes.push({ state: "failed", why: String(e && e.message ? e.message : e) })
  }
  // 原生层:装了 pi / omp 就装扩展,关掉或 native:false 就摘掉。
  // 这里必须每次都调 —— native:false 也要能摘掉已经装上的那一个。
  for (const agent of ["pi"]) {
    try {
      notes.push(ensure(agent, o))
    } catch (e) {
      notes.push({ agent, action: "failed", why: String(e && e.message ? e.message : e) })
    }
  }
  return notes
}

/** magpie 每请求调一次:返回对象 = 用改过的请求,返回 undefined = 原样放行。 */
export async function onRequest(body, ctx) {
  try {
    if (!body || typeof body !== "object") return
    const o = ctx && ctx.options && typeof ctx.options === "object" ? ctx.options : {}
    // 人设每请求只解析一次:settle 写状态、plan 做门禁都要它
    const persona = personaOf(o)

    // options 变了才落盘 / 装扩展;每请求只走一次比较
    const notes = settle(o, persona)

    if (o.enabled !== true) {
      ctx?.report?.("skipped", 0)
      return
    }

    // 先看它打算做什么,再动手 —— plan 与页面用的是同一个函数
    const before = plan(body, ctx.protocol, o, ctx, persona)
    if (!before.act) {
      ctx?.report?.("skipped", 0)
      return
    }

    // plan 传给 rewrite:门禁不用每个请求跑两遍(hook 预算 1s)
    const done = rewrite(body, ctx.protocol, o, ctx, before)

    // report 报的是改写注入的正文大小。宿主的 count 上限 32768,超了会记成 0,
    // 所以先钳一下(人设上限 512K,不钳的话大 persona 的诊断会是 0)。
    ctx?.report?.("ready", Math.min(32768, before.persona.length))

    // 诊断挂在这次请求自己的 state 上就够(宿主 gatewayFinish 会转给
    // onResponse)。别写 plugins.json:宿主看着它的 mtime,每请求改一次
    // 都会把整个 Bun 宿主拆掉重启(internal/plugin 的 checkList/hostStale),
    // 页面也早已不读 status(migrate.js 当旧键清掉)。
    if (ctx && ctx.state && typeof ctx.state === "object") {
      ctx.state.purge = {
        at: new Date().toISOString(),
        agent: ctx.agent || "",
        protocol: ctx.protocol || "",
        model: ctx.model || "",
        mode: done.mode,
        why: done.why,
        hostChars: done.hostChars || 0,
        outChars: done.outChars || 0,
        native: notes,
      }
    }

    return body
  } catch (e) {
    // fail-open:改不动就原样放行
    try {
      ctx?.report?.("invalid", 0)
    } catch {
      /* report 自己失败也不能影响放行 */
    }
  }
}
