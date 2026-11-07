// 页面烟测:整套 page/*.js 在一个最小 DOM 壳里真的跑一遍。
//
// 为什么必须有:页面是纯 IIFE 脚本,node --check 只看语法。上次 sed 裁替换词
// 时把夹在中间的 drawPolicy/emptyNote 一起裁掉了,启动即 ReferenceError,
// 宿主判页死("此页面停止工作")—— 82 个测试全绿也照样没测出来。
// 这个壳不测样式、不测布局,只钉一件事:启动路径不炸、核心节点被填上。

import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const PAGE = join(new URL("..", import.meta.url).pathname, "page")
const read = (f) => readFileSync(join(PAGE, f), "utf8")

// ---- 最小 DOM ----
// 只实现 app.js 用到的那几样;够跑就行,不是浏览器。
// shortcut:offsetParent 恒 null(段控滑块动画自动跳过),布局坏了这里测不出来,
// 但"页面起不来"测得出来 —— 而那正是这次要防的。

const NODE_IDS = [
  "load-error", "switch-segs", "enabled-name", "enabled-sub", "base-head", "base-note",
  "policy", "gate", "agents", "agents-head", "agents-note", "library-head", "library-note",
  "personas", "persona-rows", "personas-head", "personas-note",
  "persona-import", "persona-file", "persona-msg", "foot", "saved",
  "savebar", "savebar-note", "savebar-discard", "savebar-save",
]

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: { setProperty() {} },
    dataset: {},
    hidden: false,
    disabled: false,
    _set: new Set(),
    setAttribute() {},
    getAttribute() {
      return null
    },
    append(...ns) {
      el._text = null
      for (const n of ns) if (n) el.children.push(n)
    },
    replaceWith() {},
    addEventListener() {},
    animate() {},
    getBoundingClientRect: () => ({ left: 0 }),
    offsetParent: null,
    focus() {},
    click() {
      el.onclick && el.onclick({})
    },
  }
  el.classList = el._set
  Object.defineProperty(el, "className", {
    get() {
      return [...el._set].join(" ")
    },
    set(v) {
      el._set = new Set(String(v).split(/\s+/).filter(Boolean))
    },
  })
  Object.defineProperty(el, "textContent", {
    get() {
      if (el._text != null) return el._text
      return el.children.map((c) => c.textContent).join("")
    },
    set(v) {
      el._text = String(v)
      el.children = []
    },
  })
  el.classList = {
    add: (...c) => c.forEach((x) => el._set.add(x)),
    remove: (...c) => c.forEach((x) => el._set.delete(x)),
    toggle: (c, force) => {
      const on = force === undefined ? !el._set.has(c) : !!force
      if (on) el._set.add(c)
      else el._set.delete(c)
      return on
    },
    contains: (c) => el._set.has(c),
  }
  return el
}

function boot(options, opts = {}) {
  const byId = new Map()
  for (const id of NODE_IDS) {
    const n = makeEl("div")
    n.id = id
    byId.set(id, n)
  }

  const document = {
    title: "",
    visibilityState: "visible",
    documentElement: { lang: "" },
    createElement: makeEl,
    createElementNS: (_ns, t) => makeEl(t),
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: makeEl("body"),
  }
  document.body.append(...byId.values())

  const bridge = {
    written: undefined,
    ready: Promise.resolve(),
    theme: { lang: opts.lang || "en" },
    options: {
      get: () =>
        opts.getFails
          ? Promise.reject(new Error("host down"))
          : Promise.resolve(JSON.parse(JSON.stringify(options))),
      set: (o) => {
        bridge.written = JSON.parse(JSON.stringify(o))
        return Promise.resolve(bridge.written)
      },
    },
    onTheme: null,
    onVisibility: null,
  }
  const win = { document, Image: function () { return {} }, listeners: {} }
  win.window = win
  win.setTimeout = (fn) => 0
  win.clearTimeout = () => {}
  win.addEventListener = (name, fn) => {
    win.listeners[name] = fn
  }
  // bridge 替身里 onTheme 是 app.js `typeof magpie.onTheme === "function"` 要探的
  const magpie = {
    ready: bridge.ready,
    theme: bridge.theme,
    options: bridge.options,
    onTheme(fn) {
      bridge.onTheme = fn
    },
    onVisibility(fn) {
      bridge.onVisibility = fn
    },
  }

  // 脚本顺序照 index.html(bridge.js 是宿主注入的,测不到,替身上面已给)
  const run = (file) =>
    new Function("window", "magpie", "document", "setTimeout", "Image", "FileReader", read(file))(
      win, magpie, document, win.setTimeout, win.Image, undefined,
    )
  run("i18n.js")
  run("persona.js")
  run("groups.js")
  run("migrate.js")
  run("app.js")
  return { win, byId, bridge, magpie }
}

// app.js 的启动体是 async IIFE:转一圈微任务,draw 才跑完
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

// Agents 列表的行:名单里的在顶层,名单外的在折叠区里(宿主侧边栏同款)
function agentRows(byId) {
  const out = []
  for (const c of byId.get("agents").children) {
    if (c.className.includes("row")) out.push(c)
    else if (c.className.includes("agent-fold")) {
      for (const r of c.children[0].children) if (r.className.includes("row")) out.push(r)
    }
  }
  return out
}

test("启动不炸:模式行、78 家 agent、门禁三项、人设空态都画出来", async () => {
  const { byId, win } = boot({ enabled: true, mode: "append", agents: ["pi"] })
  await settle()

  const policy = byId.get("policy").textContent
  assert.match(policy, /Mode/, "模式行该在(drawPolicy 没定义时这里整页已死)")
  assert.match(policy, /Append/, "当前档")

  // 候选表来自宿主源码的权威注册表(78 家),不是手抄的 12 家
  assert.ok(win.__GROUPS__.CLIS.length >= 60, "注册表该是宿主全量")
  const agentRowEls = agentRows(byId)
  assert.equal(win.__GROUPS__.CLIS.length, agentRowEls.length, "agent 行该画全(名单里的 + 折着的)")

  // 显示名取宿主的名字,不是 id 原文:cursor-local 显示 "Cursor Private Inference"
  const names = agentRowEls.map((r) => r.children[1].textContent)
  assert.ok(names.includes("Cursor Private Inference"), "该用宿主显示名,不是裸 id cursor-local")
  assert.ok(names.includes("Grok Build"), "grok 的宿主名是 Grok Build")
  assert.ok(!names.includes("cursor-local"), "裸 id 不该出现在名字里")

  // 图标:彩色 + mask 内联之外,注册表里有图标的行必须真画出图标节点
  const first = agentRowEls[0]
  assert.ok(first.children[0], "行首该有图标")

  // 门禁三项:步进 + 两个开关
  const gate = byId.get("gate")
  assert.ok(gate.textContent.includes("Minimum tools") || gate.textContent.includes("工具数下限"))
  assert.ok(gate.textContent.includes("3"), "默认下限 3")

  // 空库的空态就是 emptyNote —— 上次它也被裁掉了
  const rows = byId.get("persona-rows")
  assert.equal(rows.children.length, 1, "空库该画一条空态")
  assert.match(rows.children[0].textContent, /No personas yet/, "空态文案")
})

test("Agents 列表:名单里的常驻,名单外的折起来,按钮能展开收起", async () => {
  const { byId, win } = boot({ enabled: true, agents: ["pi"] })
  await settle()
  const box = byId.get("agents")
  const more = box.children[box.children.length - 2]
  const fold = box.children[box.children.length - 1]
  assert.equal(more.className, "agent-more", "该有那个折叠按钮")
  assert.ok(fold.className.includes("agent-fold"), "该有折叠区")
  assert.ok(!fold.className.includes("open"), "默认折着")

  // 名单里的那一个留在外面,其余全在折叠区里
  const inner = fold.children[0]
  const offRows = inner.children.filter((r) => r.className.includes("row"))
  assert.equal(offRows.length, win.__GROUPS__.CLIS.length - 1, "折着的正好是名单外的")
  assert.equal(inner.children[0].className, "agent-fold-cap", "折叠区头上有分组标题")
  assert.equal(inner.inert, true, "折着的时候里面的行不该能点")

  // 按钮上的字:宿主侧边栏同款
  assert.equal(more.children[0].textContent, `Show ${offRows.length} more`)
  more.onclick({})
  assert.ok(fold.className.includes("open"), "点一下展开")
  assert.equal(inner.inert, false, "展开了就能点")
  assert.equal(more.children[0].textContent, "Show less")
  more.onclick({})
  assert.ok(!fold.className.includes("open"), "再点一下收起")
  assert.equal(inner.inert, true, "收起后里面的行不该能点")
})

test("空名单 = 全部放行:全画成开,关掉一个落成白名单(不是空)", async () => {
  // 网关的语义:空名单 = 所有 agent 都改写。页面必须画成全开,
  // 而且关掉一个要落成"其余全部",写 [] 会让网关反而全开
  const { byId, win, bridge } = boot({ enabled: true, agents: [] })
  await settle()
  const ids = win.__GROUPS__.CLIS
  const rows = agentRows(byId)
  assert.equal(rows.length, ids.length, "空名单:全部常驻")
  const box = byId.get("agents")
  assert.ok(!box.children.some((c) => c.className.includes("agent-fold")), "不该有折叠区")

  rows[0].children[2].onclick({})
  await settle()
  byId.get("savebar-save").onclick({})
  await settle()
  assert.ok(Array.isArray(bridge.written.agents), "关一个要落成白名单")
  assert.equal(bridge.written.agents.length, ids.length - 1)
  assert.ok(!bridge.written.agents.includes(ids[0]), "关掉的那个不在名单里")
  assert.ok(bridge.written.agents.includes(ids[1]), "其余全部还在")
})

test("门禁控件:加号改 minTools,开关改 skip,写盘带上新键", async () => {
  const { byId, bridge } = boot({ enabled: true })
  await settle()
  const gate = byId.get("gate")
  // 标题行已删,门禁控件从 0 开始:步进行 > who + val > step > minus/num/plus
  const step = gate.children[0].children[1].children[0]
  step.children[2].onclick({}) // +
  await settle()
  // 第三个开关行(skipNoEnv)关掉
  const envSw = gate.children[2].children[1].children[0]
  envSw.onclick({})
  await settle()
  byId.get("savebar-save").onclick({})
  await settle()
  assert.equal(bridge.written.minTools, 4, "+ 一次到 4")
  assert.equal(bridge.written.skipNoEnv, false, "环境开关关掉写 false")
  assert.notEqual(bridge.written.skipNoQuery, false, "没动的不写 false(gateOf 缺省即 true)")
})

test("中文主题推送:整页跟语言走", async () => {
  const { byId, bridge, magpie } = boot({ enabled: false })
  await settle()
  assert.match(byId.get("base-head").textContent, /Basics/)

  // 宿主推 zh:app.js 挂的 onTheme 回调该整页重画
  assert.ok(bridge.onTheme, "onTheme 该挂上")
  bridge.onTheme({ lang: "zh" })
  await settle()
  assert.match(byId.get("base-head").textContent, /基础/, "中文词条该生效")
  assert.match(byId.get("policy").textContent, /模式/)
})

test("点 Strict 段控:改草稿不写盘,savebar 露出", async () => {
  const { byId, bridge } = boot({ enabled: true, mode: "append" })
  await settle()

  // policy 里:row > val > segs 盒子 > thumb + 3 个按钮
  const segsBox = byId.get("policy").children[0].children[1].children[0]
  const strict = segsBox.children.find((b) => b.textContent === "Strict")
  assert.ok(strict, "Strict 段控该在")
  strict.onclick({})
  await settle()

  assert.equal(bridge.written, undefined, "没点保存之前一个字都不该写盘")
  assert.equal(byId.get("savebar").hidden, false, "草稿脏了 savebar 该可见")
  assert.match(byId.get("policy").textContent, /dropped whole/, "副文案跟着档位走")

  // 手动保存才写盘
  byId.get("savebar-save").onclick({})
  await settle()
  assert.equal(bridge.written.mode, "strict", "写盘的草稿带上新模式")
})

test("人设导入:onchange 走 parsePersona,画进库、可被选中", async () => {
  const { byId, bridge } = boot({ enabled: true })
  await settle()

  const fileNode = byId.get("persona-file")
  fileNode.files = [{ name: "my-prompt.md", text: () => Promise.resolve("You are a test persona.\n") }]
  fileNode.onchange()
  await settle()
  await settle()

  const rows = byId.get("persona-rows")
  assert.equal(rows.children.length, 1, "导入后一行,不是空态")
  assert.match(rows.children[0].textContent, /my-prompt/, "名字取文件名")

  // 点行 = 设为全局人设
  rows.children[0].onclick({})
  await settle()
  byId.get("savebar-save").onclick({})
  await settle()
  assert.equal(bridge.written.persona, "my-prompt", "persona 写进 options")
})

test("options.get 失败:只读报错态,不把空基线存回去", async () => {
  const failing = boot({}, { getFails: true })
  await settle()
  assert.equal(failing.byId.get("load-error").hidden, false, "报错条该可见")
  failing.byId.get("savebar-save").onclick({})
  await settle()
  assert.equal(failing.bridge.written, undefined, "报错态下点保存一个字都不该写")
})
