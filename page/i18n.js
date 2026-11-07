// The page's words, keyed by the English string, as magpie's own i18n.js does:
// a language without a key falls back to English, so a half-done language
// still works.
//
// The page is in the window's language: magpie gives it the window's language
// in the theme and tells it when that changes.
;(function () {
  var TABLE = {
    en: {
      "Purge": "Purge",
      "Off": "Off",
      "On": "On",
      "Append": "Append",
      "Strict": "Strict",
      "Mode": "Mode",
      "The persona in front, the harness prompt untouched": "The persona in front, the harness prompt untouched",
      "Requests go to agents as they are": "Requests go to agents as they are",
      "off — the request is left alone": "off — the request is left alone",
      "append — the persona in front, the harness prompt untouched": "append — the persona in front, the harness prompt untouched",
      "strict — the harness prompt dropped whole; the tools may get dumber": "strict — the harness prompt dropped whole; the tools may get dumber",
      "Agents": "Agents",
      "Agents in the list are rewritten; the rest pass through untouched": "Agents in the list are rewritten; the rest pass through untouched",
      "Recognize this agent": "Recognize this agent",
      // Agents 列表的折叠按钮:英文与中文都照宿主侧边栏(app.js 的 agent-more)
      // 逐字抄,连 {n} 的位置都一样。
      "Show {n} more": "Show {n} more",
      "Show all {n} agents": "Show all {n} agents",
      "Show less": "Show less",
      "Not set up": "Not set up",
      "Basics": "Basics",
      "Switch and mode": "Switch and mode",
      "Minimum tools": "Minimum tools",
      "Rewrite only when a request carries at least this many tools; bypass calls (titles, approvals) carry few.": "Rewrite only when a request carries at least this many tools; bypass calls (titles, approvals) carry few.",
      "Skip when there is no user query": "Skip when there is no user query",
      "A request with no user text is a side call, not a turn. Turn off to rewrite those too.": "A request with no user text is a side call, not a turn. Turn off to rewrite those too.",
      "Skip when there is no working directory or session": "Skip when there is no working directory or session",
      "A request with no cwd and no session is not a real turn. Turn off to rewrite those too.": "A request with no cwd and no session is not a real turn. Turn off to rewrite those too.",
      "tools": "tools",

      "Library": "Library",
      "Imported once, every agent can pick it.": "Imported once, every agent can pick it.",
      "Import once, every agent can pick it.": "Import once, every agent can pick it.",
      "Personas": "Personas",
      "in the library": "in the library",
      "No personas yet — import one below.": "No personas yet — import one below.",
      "Name": "Name",
      "Use this persona": "Use this persona",
      "In use — click to stop using it": "In use — click to stop using it",
      "Import a file…": "Import a file…",
      "Imported": "Imported",
      "That file has no body — only frontmatter. Nothing was imported.": "That file has no body — only frontmatter. Nothing was imported.",
      "That file is empty. Nothing was imported.": "That file is empty. Nothing was imported.",
      "Could not read that file.": "Could not read that file.",
      "That persona is too large (max 256KB).": "That persona is too large (max 256KB).",

      "Remove": "Remove",
      "Add": "Add",
      "Cancel": "Cancel",
      "Save": "Save",
      "Not saved yet": "Not saved yet",
      "Discard changes": "Discard changes",
      "Saved.": "Saved.",
      "Could not save. The gateway did not accept it.": "Could not save. The gateway did not accept it.",
      "Could not load the settings. The page is read-only; it retries when you come back.": "Could not load the settings. The page is read-only; it retries when you come back.",
    },
    zh: {
      "Purge": "破限",
      "Off": "关",
      "On": "开",
      "Append": "追加",
      "Strict": "严格",
      "Mode": "模式",
      "The persona in front, the harness prompt untouched": "人设挂在最前,宿主提示词原样",
      "Requests go to agents as they are": "请求原样发给 agent",
      "off — the request is left alone": "off —— 请求原样放行",
      "append — the persona in front, the harness prompt untouched": "append —— 人设挂在最前,宿主提示词原样",
      "strict — the harness prompt dropped whole; the tools may get dumber": "strict —— 宿主提示词整段丢掉;工具说明一起没了,harness 可能变笨",
      "Agents": "Agents",
      "Agents in the list are rewritten; the rest pass through untouched": "名单里的 agent 会被改写,其余原样放行",
      "Recognize this agent": "改写这个 agent",
      "Show {n} more": "显示其余 {n} 个",
      "Show all {n} agents": "显示全部 {n} 个 Agent",
      "Show less": "收起",
      "Not set up": "未设置",
      "Basics": "基础设置",
      "Switch and mode": "总闸与模式",
      "Minimum tools": "工具数下限",
      "Rewrite only when a request carries at least this many tools; bypass calls (titles, approvals) carry few.": "请求至少带这么多工具才改写;旁路调用(标题、审批)带的很少。",
      "Skip when there is no user query": "没有用户输入时跳过",
      "A request with no user text is a side call, not a turn. Turn off to rewrite those too.": "没有用户文本的请求是旁路调用,不是一次对话。关掉它则这些也改写。",
      "Skip when there is no working directory or session": "没有工作目录或会话时跳过",
      "A request with no cwd and no session is not a real turn. Turn off to rewrite those too.": "既无 cwd 又无 session 的请求不是真对话。关掉它则这些也改写。",
      "tools": "个工具",

      "Library": "资源库",
      "Imported once, every agent can pick it.": "导入一次,各 agent 共用。",
      "Import once, every agent can pick it.": "导入一次,每个 agent 都能选。",
      "Personas": "人设库",
      "in the library": "条在库里",
      "No personas yet — import one below.": "还没有人设 —— 从下面导入一个。",
      "Name": "名字",
      "Use this persona": "选为全局人设",
      "In use — click to stop using it": "使用中 —— 点击停用",
      "Import a file…": "导入文件…",
      "Imported": "已导入",
      "That file has no body — only frontmatter. Nothing was imported.":
        "那个文件没有正文,只有 frontmatter。没有导入任何东西。",
      "That file is empty. Nothing was imported.": "那个文件是空的。没有导入任何东西。",
      "Could not read that file.": "读不了那个文件。",
      "That persona is too large (max 256KB).": "这套人设太大了(上限 256KB)。",

      "Remove": "删除",
      "Add": "添加",
      "Cancel": "取消",
      "Save": "保存",
      "Not saved yet": "未保存",
      "Discard changes": "放弃修改",
      "Saved.": "已保存。",
      "Could not save. The gateway did not accept it.": "没存进去:网关没有接受,已把页面滚回原样。",
      "Could not load the settings. The page is read-only; it retries when you come back.": "设置读不出来,页面已只读;切回来时会自动重试。",
    },
    // zh-TW / ja / de 三张旧残表已删:只剩几个对不上的死键(“Persona”/“What it saw”),
    // 留着只会让这几种语言一半英文一半旧译文。缺语言整页回落英文(本文件
    // 开头的宿主同款行为),有人补译整表即生效。
  }

  var lang = "en"

  // t(key, vars):vars 里的 {k} 按值替换(宿主 i18n.js 的 t 同一套)。
  // 单参调用走原路径,48 个旧调用点一个字节都不变。
  function t(key, vars) {
    var table = TABLE[lang] || {}
    var out = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key
    if (!vars) return out
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) out = out.split("{" + k + "}").join(vars[k])
    }
    return out
  }

  window.__I18N__ = {
    get lang() {
      return lang
    },
    setLang: function (next) {
      var want = String(next || "en")
      // 繁体地区归 zh-TW,不落回简体表(宿主 i18n.js:18398 sysLocale)
      if (/^zh-(tw|hk|mo|hant)\b/i.test(want)) want = "zh-TW"
      if (!TABLE[want]) {
        // zh-TW 表暂缺:整页回落英文(比拿简体表凑数强),补译即生效
        var short = want === "zh-TW" ? "" : want.split("-")[0]
        want = TABLE[short] ? short : "en"
      }
      lang = want
      try { document.documentElement.lang = want } catch (e) {}
    },
    table: function (which) {
      return TABLE[which]
    },
    t: t,
  }
  window.t = t
})()
