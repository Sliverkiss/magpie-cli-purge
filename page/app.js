// 页面:破限(总闸 + 全局模式 / 人设)+ Library(共享资源)。
// 全局一套策略,对所有对话请求生效;没有模型组、没有按 CLI 区分。
//
// 页面是沙箱:没有 fetch、读不到磁盘,能读的只有 magpie.options。
// 配置写回 options —— 网关 hook 每次请求读的就是它。

;(function () {
  var t = window.t || function (s) {
    return s
  }
  var opts = {}
  // 上次成功持久化的快照;opts 是内存草稿,两者不同就是 dirty。
  var saved = null
  var writing = false
  var dirtyFlag = false
  // 失败重试间隔;宿主 options.set 限频 1 次/秒。
  var RETRY_MS = 1200
  var MAX_RETRIES = 2
  var retryTimer = null
  var retriesLeft = MAX_RETRIES
  // 写入期间又来了新编辑:写完再补一次,别让新草稿等下一次点击。
  var pendingFlush = false
  // options.get 失败 → 整页只读的报错态:commit/persist/discard 全部拒绝,
  // 不拿空缺省画假页面;重试挂在 magpie.onVisibility 的 show 上。
  var loadFailed = false

  function $(id) {
    return document.getElementById(id)
  }

  function copy(o) {
    return JSON.parse(JSON.stringify(o && typeof o === "object" ? o : {}))
  }

  // shallow 只拷一层:改一个开关不该把整库人设正文再 JSON 走一遍
  // (一页 256KB 的人设,旧写法每次点击都要 stringify/parse 两次,手感就是这样卡的)。
  function shallow(o) {
    var n = {}
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n[k] = o[k]
    return n
  }

  // 每个取回来的元素都要先验存在 —— 沙箱里少一个 id 不该拖死整页。
  function set(id, text) {
    var n = $(id)
    if (n) n.textContent = text
  }

  function list(field) {
    return opts[field] && Array.isArray(opts[field]) ? opts[field] : []
  }

  var MODES = ["off", "append", "strict"]

  // ---- options 的读取(view-only;真正的解释在 lib/groups.mjs) ----
  function library() {
    var l = opts.library && typeof opts.library === "object" ? opts.library : {}
    return {
      personas: l.personas && typeof l.personas === "object" ? l.personas : {},
    }
  }

  // 写回时用的 library 外壳:只拷一层,里面要改的 map 再各自拷。
  function libShell() {
    return shallow(opts.library && typeof opts.library === "object" ? opts.library : {})
  }

  // editLibrary 改库里的一个 map(人设),返回新的 options。
  // map 与要改的那一项都只拷一层 —— 人设正文可能有 256KB,不该每次点击都
  // JSON 往返一遍(那是旧 copy(opts) 卡手的原因)。
  function editLibrary(key, edit) {
    var next = shallow(opts)
    var lib = libShell()
    var map = shallow(lib[key] && typeof lib[key] === "object" ? lib[key] : {})
    lib[key] = edit(map) || map
    next.library = lib
    return next
  }

  // ---- 造元素的小件 ----
  // segs 造宿主那种分段控件:pill 底、白 thumb 滑到选中的那格。
  function segs(items, current, onPick) {
    var box = document.createElement("div")
    box.className = "segs"
    var th = document.createElement("span")
    th.className = "thumb"
    box.append(th)
    var btns = []
    for (var i = 0; i < items.length; i++) {
      ;(function (item) {
        var b = document.createElement("button")
        b.type = "button"
        b.className = "opt" + (item.id === current ? " on" : "")
        b._id = item.id
        b.textContent = item.name
        b.setAttribute("aria-pressed", String(item.id === current))
        b.onclick = function () {
          for (var j = 0; j < btns.length; j++) {
            btns[j].classList.toggle("on", btns[j] === b)
            btns[j].setAttribute("aria-pressed", String(btns[j] === b))
          }
          slideThumb(box, th, b)
          onPick(item.id)
        }
        btns.push(b)
        box.append(b)
      })(items[i])
    }
    th.style.opacity = "0"
    setTimeout(function () {
      var on = null
      for (var j = 0; j < btns.length; j++) if (btns[j].classList.contains("on")) on = btns[j]
      if (on) placeThumb(th, on)
      th.style.opacity = ""
    }, 0)
    return box
  }

  function placeThumb(th, on) {
    if (!on || !on.offsetParent) return false
    th.style.width = on.offsetWidth + "px"
    th.style.transform = "translateX(" + on.offsetLeft + "px)"
    return true
  }

  function slideThumb(box, th, on) {
    if (!placeThumb(th, on)) return
    var from = th.getBoundingClientRect()
    var to = on.getBoundingClientRect()
    if (Math.abs(from.left - to.left) > 1) {
      th.animate(
        [{ transform: "translateX(" + (from.left - box.getBoundingClientRect().left - 2) + "px)" }, { transform: "translateX(" + (to.left - box.getBoundingClientRect().left - 2) + "px)" }],
        { duration: 220, easing: "cubic-bezier(.2, .8, .2, 1)" },
      )
    }
  }

  var CHECK_PATH = "m3.5 8.5 3 3 6-7"
  var CHEV_PATH = "M6 3.5 10.5 8 6 12.5"
  // 朝下的箭头:宿主 app.js 的 CHEV(app.css .agent-more 上那枚),逐字抄
  var CHEV_DOWN_PATH = "m5.5 6.5 2.5 2.5 2.5-2.5"

  // svg 造宿主那种 16 格 icon:1.6 细线,stroke 可调(删除这类小图标用 1.4)
  // 路径属性照宿主 app.js svg():fill/stroke 写在 path 上,没有 CSS 兜底的
  // 调用点才不至于画成实心黑块。
  function svg(path, size, stroke) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    s.setAttribute("viewBox", "0 0 16 16")
    if (size) {
      s.setAttribute("width", size)
      s.setAttribute("height", size)
    }
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path")
    p.setAttribute("d", path)
    p.setAttribute("fill", "none")
    p.setAttribute("stroke", "currentColor")
    p.setAttribute("stroke-width", String(stroke || 1.6))
    p.setAttribute("stroke-linecap", "round")
    p.setAttribute("stroke-linejoin", "round")
    s.append(p)
    return s
  }

  function textBtn(label, cls, onClick) {
    var b = document.createElement("button")
    b.type = "button"
    b.className = "text" + (cls ? " " + cls : "")
    b.textContent = label
    b.onclick = onClick
    return b
  }

  // 库卡片的行壳:人设 / 替换词两处同形(row > who > name)。
  // who 只包住名字;名字上的 dblclick 是改名,不能冒泡到行上的展开。
  function libRow(open, nameCls) {
    var row = document.createElement("div")
    row.className = "row lib-row click lib-set" + (open ? " open" : "")
    var who = document.createElement("div")
    who.className = "who"
    who.onclick = function (e) {
      if (e && e.stopPropagation) e.stopPropagation()
    }
    who.ondblclick = function (e) {
      if (e && e.stopPropagation) e.stopPropagation()
    }
    var name = document.createElement("div")
    name.className = nameCls || "name"
    who.append(name)
    return { row: row, who: who, name: name }
  }

  // 行右的选中勾(人设选中共用)。
  function checkMark(on, title) {
    var check = document.createElement("span")
    check.className = "lib-check"
    if (on) check.append(svg(CHECK_PATH, 13, 2.2))
    check.title = title
    check.setAttribute("role", "radio")
    check.setAttribute("aria-checked", String(on))
    check.setAttribute("aria-label", title)
    return check
  }

  // 行末开关(替换词共用)。
  function libSwitch(on, label) {
    var sw = document.createElement("button")
    sw.type = "button"
    sw.className = "lib-switch" + (on ? " on" : "")
    sw.append(document.createElement("i"))
    sw.setAttribute("role", "switch")
    sw.setAttribute("aria-checked", String(on))
    sw.setAttribute("aria-label", label)
    return sw
  }

  // renameIn 照宿主同名实现:把 at 原地换成一个输入框,Enter 保存(变了才调
  // save),Escape 原样收场,blur = 保存。清空的输入不算改名 —— 原样收场。
  function renameIn(at, own, hint, onSave) {
    var i = document.createElement("input")
    i.type = "text"
    i.value = own || ""
    i.placeholder = hint || ""
    i.spellcheck = false
    i.autocomplete = "off"
    i.className = "rename-in"
    var over = false
    var done = function (ok) {
      if (over) return
      over = true
      var v = String(i.value).trim()
      if (ok && v && v !== (own || "")) onSave(v)
      else draw()
    }
    i.onkeydown = function (e) {
      if (e.key === "Enter") done(true)
      else if (e.key === "Escape") done(false)
    }
    i.onblur = function () {
      done(true)
    }
    at.replaceWith(i)
    if (i.focus) i.focus()
    return i
  }


  // ---- 整个页面 ----

  // draw 只重画被改动的那几节 —— 每次点击都整页重建是页面卡手的另一半原因。
  // 不传 scope = 全部重画(启动、切语言、写失败回滚)。
  function draw(scope) {
    var all = !scope
    var on = opts.enabled === true
    document.title = "CLI Purge"

    if (all || scope.indexOf("gate") >= 0) {
      var switchBox = $("switch-segs")
      if (switchBox) {
        switchBox.textContent = ""
        switchBox.append(
          segs(
            [
              { id: "off", name: t("Off") },
              { id: "on", name: t("On") },
            ],
            on ? "on" : "off",
            function (v) {
              setKey("enabled", v === "on")
            },
          ),
        )
      }
      set("enabled-name", "CLI Purge")
      set("enabled-sub", on ? t("The persona in front, the harness prompt untouched") : t("Requests go to agents as they are"))
      set("base-head", t("Basics"))
      set("base-note", t("Switch and mode"))
      drawPolicy()
      drawGate()
    }

    // Agents 列表有自己的 scope:改门禁数字不该把 78 行图标表拆了重画
    if (all || scope.indexOf("agents") >= 0) drawAgents()

    if (all || scope.indexOf("personas") >= 0) {
      set("library-head", t("Library"))
      set("library-note", t("Imported once, every agent can pick it."))
      drawPersonas()
    }

    // 截断的小节说明给全名 tooltip(宿主 library/client.js:896 同法)
    var headNotes = document.querySelectorAll(".row-head .note")
    for (var hi = 0; hi < headNotes.length; hi++) headNotes[hi].title = headNotes[hi].textContent

    // 「已保存」文案在真正写入后由 showSaved 设置,别在这里覆盖失败提示。
    updateSavebar()
  }

  // ---- Library:人设 ----

  function personaIds() {
    var out = []
    var p = library().personas
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) out.push(k)
    return out
  }

  function drawPersonas() {
    var box = $("persona-rows")
    if (!box) return
    box.textContent = ""
    set("personas-head", t("Personas"))
    var p = library().personas
    var ids = personaIds()
    set("personas-note", ids.length ? ids.length + " " + t("in the library") : t("Import once, every agent can pick it."))
    if (!ids.length) {
      box.append(emptyNote(t("No personas yet — import one below.")))
      return
    }
    for (var i = 0; i < ids.length; i++) {
      ;(function (id) {
        var item = p[id] || {}
        var on = opts.persona === id
        // 点这一行就是选这套人设为全局人设;打勾在行右(宿主 .acc .dot 的形状)
        var card = libRow(on)
        var row = card.row, who = card.who, name = card.name
        name.textContent = String(item.name || id)
        name.title = name.textContent // 名字被截断时给全名(style.css .row .name)
        // 名称双击改名(回车保存),点行仍是选人设
        name.ondblclick = function (e) {
          if (e && e.stopPropagation) e.stopPropagation()
          renameIn(name, String(item.name || ""), t("Name"), function (v) {
            renamePersona(id, v || String(item.name || id))
          })
        }
        if (item.description) {
          var sub = document.createElement("div")
          sub.className = "sub"
          sub.textContent = String(item.description)
          who.append(sub)
        }
        // 右侧:删除(文字按钮,悬停才现)+ 打勾,选中行才有勾
        var del = textBtn(t("Remove"), "quiet lib-rm", function (e) {
          if (e && e.stopPropagation) e.stopPropagation()
          removePersona(id)
        })
        var check = checkMark(on, on ? t("In use — click to stop using it") : t("Use this persona"))
        row.append(who, del, check)
        row.onclick = function () {
          setKey("persona", on ? "" : id)
        }
        box.append(row)
      })(ids[i])
    }
  }

  function removePersona(id) {
    var next = editLibrary("personas", function (map) {
      delete map[id]
      return map
    })
    // 全局引用:删掉的这个人设正被选用就收回
    if (opts.persona === id) next.persona = ""
    commit(next, ["personas"])
  }

  function renamePersona(id, v) {
    if (!v) return
    commit(
      editLibrary("personas", function (map) {
        if (map[id]) map[id] = { ...map[id], name: v }
        return map
      }),
      ["personas"],
    )
  }

  // emptyNote:库卡片空态那一行(sed 裁剪时丢了,页面启动即 ReferenceError)
  function emptyNote(text) {
    var d = document.createElement("div")
    d.className = "lib-none"
    d.textContent = text
    return d
  }

  // drawPolicy:模式行(Off/Append/Strict 段控)。缺省与 lib/groups.mjs 的
  // modeOf 对齐:mode 缺失按 append。
  function drawPolicy() {
    var box = $("policy")
    if (!box) return
    box.textContent = ""
    var cur = MODES.indexOf(opts.mode) >= 0 ? opts.mode : "append"
    var labels = { off: "Off", append: "Append", strict: "Strict" }
    var notes = {
      off: "off — the request is left alone",
      append: "append — the persona in front, the harness prompt untouched",
      strict: "strict — the harness prompt dropped whole; the tools may get dumber",
    }
    var row = document.createElement("div")
    row.className = "row pref"
    var who = document.createElement("div")
    who.className = "who"
    var name = document.createElement("div")
    name.className = "name"
    name.textContent = t("Mode")
    var sub = document.createElement("div")
    sub.className = "sub"
    sub.textContent = t(notes[cur])
    who.append(name, sub)
    var val = document.createElement("div")
    val.className = "val"
    val.append(
      segs(
        MODES.map(function (id) { return { id: id, name: t(labels[id]) } }),
        cur,
        function (v) { setKey("mode", v) },
      ),
    )
    row.append(who, val)
    box.append(row)
  }


  // ---- 接管条件(网关门禁)----
  //
  // 网关只改"像一次真对话"的请求:agent 在白名单里,且请求带够工具、有用户
  // 输入、有环境信息 —— 旁路调用(标题、审批、意图、压缩)缺这些。下面三项
  // 控制后两条的门槛。gateVal 和 lib/groups.mjs 的 gateOf 是同一套默认值,
  // 页面上看到的和网关真正做的不分叉(test/groups.test.mjs 钉着)。
  var GATE_MIN_TOOLS_DEFAULT = 3

  function gateVal(key) {
    if (key === "minTools") {
      var n = opts.minTools
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : GATE_MIN_TOOLS_DEFAULT
    }
    if (key === "skipNoQuery") return opts.skipNoQuery !== false
    return opts.skipNoEnv !== false
  }

  function gateRow(title, sub) {
    var row = document.createElement("div")
    row.className = "row pref"
    var who = document.createElement("div")
    who.className = "who"
    var name = document.createElement("div")
    name.className = "name"
    name.textContent = title
    var s = document.createElement("div")
    s.className = "sub"
    s.textContent = sub
    who.append(name, s)
    var val = document.createElement("div")
    val.className = "val"
    row.append(who, val)
    return { row: row, val: val }
  }

  function drawGate() {
    var box = $("gate")
    if (!box) return
    box.textContent = ""

    // 工具数下限:− / + 步进。shortcut: 上限拍 50,真对话请求都带几十条工具,
    // 超过 50 没有意义;哪天需要更大再放开。
    var minN = gateVal("minTools")
    var r1 = gateRow(t("Minimum tools"), t("Rewrite only when a request carries at least this many tools; bypass calls (titles, approvals) carry few."))
    var step = document.createElement("div")
    step.className = "gate-step"
    var minus = textBtn("−", "quiet", function () { setKey("minTools", Math.max(0, minN - 1)) })
    var num = document.createElement("span")
    num.className = "gate-num"
    num.textContent = minN + " " + t("tools")
    var plus = textBtn("+", "quiet", function () { setKey("minTools", Math.min(50, minN + 1)) })
    step.append(minus, num, plus)
    r1.val.append(step)
    box.append(r1.row)

    var r2 = gateRow(t("Skip when there is no user query"), t("A request with no user text is a side call, not a turn. Turn off to rewrite those too."))
    var on2 = gateVal("skipNoQuery")
    var sw2 = libSwitch(on2, t("Skip when there is no user query"))
    sw2.onclick = function () { setKey("skipNoQuery", !on2) }
    r2.val.append(sw2)
    box.append(r2.row)

    var r3 = gateRow(t("Skip when there is no working directory or session"), t("A request with no cwd and no session is not a real turn. Turn off to rewrite those too."))
    var on3 = gateVal("skipNoEnv")
    var sw3 = libSwitch(on3, t("Skip when there is no working directory or session"))
    sw3.onclick = function () { setKey("skipNoEnv", !on3) }
    r3.val.append(sw3)
    box.append(r3.row)
  }

  // ---- Agents 白名单 ----
  //
  // 每行 = 图标 + 名字 + 开关。id 与名字都来自 window.__GROUPS__:那是从
  // magpie 宿主源码 (internal/agent/*.go) 提取的权威表 —— id 就是网关
  // ctx.agent 的真实取值,名字是宿主 UI 显示的名字,不猜。
  // 图标是宿主 icons 的副本(page/icons/)。单色 mask 图标的 data: URI 在
  // __GROUPS__.MASK_DATA 里内联:宿主把页面装在 sandbox(allow-scripts) 帧里,
  // origin 不透明,mask-image 的外链子资源带 Origin: null 被 CORS 掐死;彩色
  // 图标走 <img>(no-cors)不受影响。CSP img-src 允许 data:。
  // 加 agent 或换图标:重新从宿主源码生成 page/groups.js,这里不用动。
  function agentMeta(id) {
    var g = window.__GROUPS__ || {}
    var file = g.ICONS && g.ICONS[id]
    if (!file) return null
    return { file: file, mask: (g.MASKS || []).indexOf(file) >= 0 }
  }

  function agentName(id) {
    var g = window.__GROUPS__ || {}
    return (g.NAMES && g.NAMES[id]) || id
  }

  // icon 复刻宿主 app.js 的 icon():彩色图标用 img,单色用 mask(currentColor);
  // 图片加载失败退回 generic(宿主同款的菱形 svg)。
  function agentIcon(id) {
    var meta = agentMeta(id)
    var e = document.createElement("span")
    e.className = "ic"
    e.dataset.icon = id
    if (!meta) {
      e.classList.add("generic")
      e.append(svg("M8 2.2 13.2 5.1v5.8L8 13.8 2.8 10.9V5.1Z M8 8v5.8 M2.8 5.1 8 8l5.2-2.9", 16, 1.4))
      return e
    }
    if (!meta.mask) {
      var img = document.createElement("img")
      img.src = "icons/" + meta.file
      img.alt = ""
      img.draggable = false
      img.onerror = function () { e.replaceWith(agentIcon("")) }
      e.append(img)
    } else {
      var m = document.createElement("span")
      m.className = "mask"
      var data = (window.__GROUPS__ && window.__GROUPS__.MASK_DATA) || {}
      if (data[meta.file]) {
        // data: 不发请求:真宿主的沙箱帧里 mask 图标的外链请求会被 CORS 掐死
        m.style.setProperty("--i", 'url("' + data[meta.file] + '")')
      } else {
        // 内联表漏了这一个:退回外链 + 探测,加载失败退 generic
        m.style.setProperty("--i", 'url("icons/' + meta.file + '")')
        var probe = new Image()
        probe.onerror = function () { e.replaceWith(agentIcon("")) }
        probe.src = "icons/" + meta.file
      }
      e.append(m)
    }
    return e
  }

  // 白名单语义:options.agents 含 id 即改写该 agent;空名单 = 全部放行改写
  function agentOn(id) {
    var a = opts.agents && Array.isArray(opts.agents) ? opts.agents : []
    return !a.length || a.indexOf(id) >= 0
  }

  // 候选表 ∪ 已写进 options 的自定义 id(不确定的值也留着,别丢配置)
  function allAgentIds() {
    var table = (window.__GROUPS__ && window.__GROUPS__.CLIS) || []
    var picked = opts.agents && Array.isArray(opts.agents) ? opts.agents : []
    var ids = table.slice()
    for (var j = 0; j < picked.length; j++) if (ids.indexOf(picked[j]) < 0) ids.push(picked[j])
    return ids
  }

  function toggleAgent(id, add) {
    var a = (opts.agents && Array.isArray(opts.agents) ? opts.agents : []).slice()
    // 空名单 = 全部放行(gateway 的语义):关掉一个就得把其余全部写进名单,
    // 否则写 [] 会让网关把所有 agent 都打开
    if (!a.length) {
      if (add) return
      a = allAgentIds().filter(function (x) { return x !== id })
    } else if (add) {
      if (a.indexOf(id) < 0) a.push(id)
    } else {
      var i = a.indexOf(id)
      if (i >= 0) a.splice(i, 1)
    }
    var next = shallow(opts)
    next.agents = a
    commit(next, ["agents"])
  }

  // 折叠区:名单里的 agent 常驻列表顶,名单外的折在按钮后面 —— 宿主侧边栏
  // Agents 列表同款(宿主 app.js 的 agent-fold / agent-more,样式见 style.css)。
  // 展开状态记在 showAllAgents 里:改开关会整节重画,状态不能跟着丢。
  var showAllAgents = false
  // 折起来的行照宿主那样逐行错开入场;行多了不逐行排,最多排 FOLD_STAGGER 级,
  // 后面的一起进(不然 80 行要等 4 秒才见底)。
  var FOLD_STAGGER = 12
  // 折叠区转场的兜底定时器:窗口藏起来时转场事件不来,软边会留着
  var foldSettle = null

  // 动效让位给「少动」偏好(宿主 app.js 的 calm())
  function calm() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  }

  function agentRow(id) {
    var isOn = agentOn(id)
    var row = document.createElement("div")
    row.className = "row lib-row"
    var who = document.createElement("div")
    who.className = "who"
    var name = document.createElement("div")
    name.className = "name"
    name.textContent = agentName(id)
    name.title = name.textContent // 名字被截断时给全名(style.css .row .name)
    who.append(name)
    var sw = libSwitch(isOn, t("Recognize this agent") + ": " + name.textContent)
    sw.onclick = function () {
      toggleAgent(id, !isOn)
    }
    row.append(agentIcon(id), who, sw)
    return row
  }

  function drawAgents() {
    var box = $("agents")
    if (!box) return
    // 上一轮折叠区的兜底定时器还挂着的话,它清掉的是新那个(变量只有一份)
    if (foldSettle) {
      clearTimeout(foldSettle)
      foldSettle = null
    }
    box.textContent = ""
    set("agents-head", t("Agents"))
    set("agents-note", t("Agents in the list are rewritten; the rest pass through untouched"))
    // 名单里的在上,名单外的折起来(宿主侧边栏:在用的在上,其余折在按钮后面)
    var ids = allAgentIds()
    var on = []
    var off = []
    for (var i = 0; i < ids.length; i++) (agentOn(ids[i]) ? on : off).push(ids[i])
    for (var k = 0; k < on.length; k++) box.append(agentRow(on[k]))
    if (!off.length) return

    // 折叠区(宿主 app.css .agent-fold / .agent-fold-inner,逐字)
    var fold = document.createElement("div")
    fold.className = "agent-fold" + (showAllAgents ? " open" : "")
    fold.style.setProperty("--n", Math.min(off.length, FOLD_STAGGER + 1))
    var inner = document.createElement("div")
    inner.className = "agent-fold-inner"
    inner.inert = !showAllAgents
    var cap = document.createElement("div")
    cap.className = "agent-fold-cap"
    cap.textContent = t("Not set up")
    cap.style.setProperty("--i", "0")
    inner.append(cap)
    for (var m = 0; m < off.length; m++) {
      var r = agentRow(off[m])
      r.style.setProperty("--i", Math.min(m, FOLD_STAGGER))
      inner.append(r)
    }
    fold.append(inner)

    // 按钮在上、折叠区在下:展开的行从按钮下面长出来(宿主 list.append(more, fold))
    var more = document.createElement("button")
    more.type = "button"
    more.className = "agent-more"
    var label = document.createElement("span")
    var chev = document.createElement("span")
    chev.className = "chev"
    chev.append(svg(CHEV_DOWN_PATH, 10, 1.8))
    more.append(label, chev)
    var labelFor = function () {
      label.textContent = showAllAgents ? t("Show less")
        : !on.length ? t("Show all {n} agents", { n: off.length })
        : t("Show {n} more", { n: off.length })
      more.setAttribute("aria-expanded", String(showAllAgents))
    }
    labelFor()
    // 展开/收起时底下有一层软边(moving);转场结束就摘掉。
    // 宿主还有个 900ms 的兜底定时器:窗口藏起来时转场事件不来,边会留着。
    var settled = function () {
      if (foldSettle) {
        clearTimeout(foldSettle)
        foldSettle = null
      }
      fold.classList.remove("moving")
    }
    fold.addEventListener("transitionend", function (e) {
      if (e.target === fold) settled()
    })
    more.onclick = function () {
      showAllAgents = !showAllAgents
      fold.classList.add("moving")
      fold.classList.toggle("open", showAllAgents)
      inner.inert = !showAllAgents
      labelFor()
      if (!calm() && label.animate) {
        label.animate(
          [{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }],
          { duration: 260, easing: "cubic-bezier(.22, 1, .36, 1)" },
        )
      }
      foldSettle = setTimeout(settled, 900)
    }
    box.append(more)
    box.append(fold)
  }

  // ---- 保存 ----
  //
  // 草稿式:commit 只改内存并重画,保存按钮手动点。
  // 「放弃」= 回到上次成功写入的快照;只有写失败才自动重试。

  function clearTimers() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function setSaveButtons(on) {
    var saveBtn = $("savebar-save")
    var dropBtn = $("savebar-discard")
    if (saveBtn) saveBtn.disabled = !on
    if (dropBtn) dropBtn.disabled = !on
  }

  // scope 是这次改动影响的节(见 draw);不传 = 整页重画。
  function commit(next, scope) {
    // 只读报错态:任何编辑都不进草稿,免得把空基线存回去
    if (loadFailed) return
    opts = next
    // 已存的是另一个对象引用就算脏:一次改动换一次顶层引用,
    // 不用每次重画都把整库人设正文 JSON.stringify 一遍。
    dirtyFlag = true
    if (writing) pendingFlush = true
    retriesLeft = MAX_RETRIES
    draw(scope)
  }

  function dirty() {
    return dirtyFlag
  }

  // persist 是唯一写入口:手动保存、pagehide flush、失败重试都走这里。
  // manual=true 才弹「已保存」提示;自动重试静默,免得打断输入。
  function persist(manual) {
    if (loadFailed) return
    clearTimers()
    if (writing) {
      pendingFlush = true
      return
    }
    if (!dirty()) {
      updateSavebar()
      return
    }
    writing = true
    setSaveButtons(false)
    var sent = opts
    var req
    try {
      req = Promise.resolve(magpie.options.set(sent))
    } catch (e) {
      req = Promise.reject(e)
    }
    req.then(
      function (written) {
        var disk = copy(written && typeof written === "object" ? written : sent)
        saved = disk
        // 写回期间又改了:新草稿仍是脏的,马上再补写一次。
        // 宿主回写的是新对象,拿它替换草稿不等于用户改了东西,别拿引用判脏。
        if (opts === sent) {
          opts = written && typeof written === "object" ? written : sent
          dirtyFlag = false
        } else {
          dirtyFlag = true
          pendingFlush = true
        }
        writing = false
        retriesLeft = MAX_RETRIES
        setSaveButtons(true)
        updateSavebar()
        if (dirty() && pendingFlush) {
          pendingFlush = false
          // 补写也是用户那次点保存的一部分,成了要给那句「已保存」
          persist(manual)
          return
        }
        pendingFlush = false
        if (manual) showSaved()
      },
      function () {
        // 失败保留草稿(回滚会把用户刚改的东西吞掉),1200ms 后重试,最多 2 次。
        writing = false
        setSaveButtons(true)
        if (retriesLeft > 0) {
          retriesLeft--
          retryTimer = setTimeout(function () {
            retryTimer = null
            if (dirty() && !writing) persist(false)
          }, RETRY_MS)
        } else {
          flash(t("Could not save. The gateway did not accept it."), "saved")
        }
        updateSavebar()
      },
    )
  }

  var savedTimer = null
  var flashTimer = null

  function showSaved() {
    updateSavebar()
    var el = $("saved")
    if (!el) return
    el.textContent = t("Saved.")
    el.hidden = false
    // 旧消息自己的定时器还挂着会把新消息提前藏掉,先清掉;
    // 两条消息共用一个元素,失败提示的定时器也要清
    if (savedTimer) clearTimeout(savedTimer)
    if (flashTimer) {
      clearTimeout(flashTimer)
      flashTimer = null
    }
    savedTimer = setTimeout(function () {
      el.hidden = true
      savedTimer = null
    }, 1200)
  }

  function discard() {
    if (writing || loadFailed) return
    clearTimers()
    opts = copy(saved)
    dirtyFlag = false
    pendingFlush = false
    retriesLeft = MAX_RETRIES
    draw()
  }

  function updateSavebar() {
    var bar = $("savebar")
    if (!bar) return
    set("savebar-note", t("Not saved yet"))
    set("savebar-discard", t("Discard changes"))
    set("savebar-save", t("Save"))
    bar.hidden = !dirty()
  }

  // 离开页面/切到后台时把草稿立刻补写一次;失败会走 persist 的重试。
  function flush() {
    if (!dirty()) return
    persist(false)
  }

  // options.get 失败的只读报错态:一行 muted 文案,写路径由 commit/persist/
  // discard 各自把门;页面重新可见时 retryLoad 再试。
  function drawLoadError() {
    var el = $("load-error")
    if (!el) return
    el.textContent = t("Could not load the settings. The page is read-only; it retries when you come back.")
    el.hidden = !loadFailed
  }

  function retryLoad() {
    magpie.options.get().then(function (got2) {
      loadFailed = false
      drawLoadError()
      var mig2 = window.__MIGRATE__ ? window.__MIGRATE__.migrateOptions(got2) : { options: got2, changed: false }
      opts = mig2 && mig2.options && typeof mig2.options === "object" ? mig2.options : {}
      saved = copy(opts)
      dirtyFlag = !!(mig2 && mig2.changed)
      draw()
    }).catch(function () {
      // 重试失败:报错行还在,别无声吞掉
      drawLoadError()
    })
  }

  function setKey(key, value) {
    // 点的就是当前档:不改草稿,别把保存条骗出来
    if (opts[key] === value) return
    var next = shallow(opts)
    next[key] = value
    // 人设的选中态画在人设行上,改它把库卡片重画就够(模式行不读人设)
    commit(next, key === "persona" ? ["personas"] : ["gate"])
  }

  function flash(text, msgId) {
    var el = $(msgId || "persona-msg")
    if (!el) return
    el.textContent = text
    el.hidden = false
    // 失败提示和「Saved.」共用 #saved,两边的定时器都要清,不然旧的那个
    // 会把这条错误提前藏掉
    if (flashTimer) clearTimeout(flashTimer)
    if (savedTimer) {
      clearTimeout(savedTimer)
      savedTimer = null
    }
    flashTimer = setTimeout(function () {
      el.hidden = true
      flashTimer = null
    }, 4000)
  }

  // ---- 启动:读 options,绑导入按钮 ----

  function readFileText(f) {
    if (f.text) return f.text()
    return new Promise(function (res, rej) {
      var r = new FileReader()
      r.onload = function () {
        res(r.result)
      }
      r.onerror = rej
      r.readAsText(f)
    })
  }

  var PERSONA_MAX = 256 * 1024

  ;(async function () {
    // onTheme 先挂再等 ready:ready 应答前后宿主都可能推主题,挂晚了会漏。
    var booted = false
    // 老宿主没有 onTheme / onVisibility:少了它们只是不跟语言和侧栏走,不该整页起不来
    if (typeof magpie.onTheme === "function")
      magpie.onTheme(function (theme) {
        if (!window.__I18N__) return
        var lang = (theme && theme.lang) || "en"
        if (window.__I18N__.lang === lang) return
        window.__I18N__.setLang(lang)
        // options 还没到位时只记语言;draw 要等基线读出来才有东西画
        if (booted) draw()
      })

    await magpie.ready
    if (window.__I18N__) window.__I18N__.setLang((magpie.theme && magpie.theme.lang) || "en")

    var got = {}
    try {
      got = await magpie.options.get()
    } catch (e) {
      // 读失败:进只读报错态 —— 不拿空缺省画假页面,更不能把空基线存回去
      loadFailed = true
    }
    // 宿主 set 是整对象替换:旧键不清会每次保存原样回灌,启动先迁移一次。
    var mig = window.__MIGRATE__ ? window.__MIGRATE__.migrateOptions(got) : { options: got, changed: false }
    opts = mig && mig.options && typeof mig.options === "object" ? mig.options : {}
    // 迁移后的形状就是基线;按「放弃」不会把旧键请回来。
    saved = copy(opts)
    dirtyFlag = !!(mig && mig.changed)
    if (loadFailed) {
      opts = {}
      saved = null
      dirtyFlag = false
    }

    draw()
    drawLoadError()
    // 基线就位后才允许主题推送触发整页重画
    booted = true

    var saveBarBtn = $("savebar-save")
    if (saveBarBtn) saveBarBtn.onclick = function () { persist(true) }
    var discardBtn = $("savebar-discard")
    if (discardBtn) discardBtn.onclick = discard
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush()
    })
    // 宿主切侧栏不触发 visibilitychange(pagebridge.js:29-34),草稿补写
    // 挂 magpie.onVisibility;上面的 document 监听各自兜底。
    // 宿主 10 分钟后连帧都收走(pluginpages.js:24-25),这里只管收走前。
    if (typeof magpie.onVisibility === "function")
      magpie.onVisibility(function (visible) {
        if (visible) {
          if (loadFailed) retryLoad()
        } else {
          flush()
        }
      })

    var personaFile = $("persona-file")
    var importBtn = $("persona-import")
    if (importBtn && personaFile) {
      importBtn.textContent = "+ " + t("Import a file…")
      importBtn.onclick = function () {
        personaFile.value = ""
        personaFile.click()
      }
    }
    if (personaFile) {
      personaFile.onchange = function () {
        var f = personaFile.files && personaFile.files[0]
        if (!f) return
        if (loadFailed) {
          // 只读态:导不进去,别说完
          flash(t("Could not load the settings. The page is read-only; it retries when you come back."))
          return
        }
        readFileText(f)
          .then(function (text) {
            if (typeof text !== "string") {
              flash(t("Could not read that file."))
              return
            }
            var p = window.__PERSONA__.parsePersona(text, f.name)
            if (!p.ok) {
              flash(/正文/.test(p.error) ? t("That file has no body — only frontmatter. Nothing was imported.") : t("That file is empty. Nothing was imported."))
              return
            }
            if (p.body.length > PERSONA_MAX) {
              flash(t("That persona is too large (max 256KB)."))
              return
            }
            var base = String(p.name || f.name || "persona").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "persona"
            var id = base
            var n = 2
            while (library().personas[id]) id = base + "-" + n++
            commit(
              editLibrary("personas", function (map) {
                map[id] = { name: String(p.name || id), description: String(p.description || ""), body: p.body, file: f.name }
                return map
              }),
              ["personas"],
            )
            flash(t("Imported") + ": " + p.name)
          })
          .catch(function () {
            flash(t("Could not read that file."))
          })
      }
    }
  })()
})()
