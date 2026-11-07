// 人设文件格式 —— 页面这一份。
//
// 和 lib/persona.mjs 是同一套规则的两份实现:页面是沙箱里的普通脚本,读不到 ESM 模块,
// 所以只能复制一份。两份不许分叉,由 test/persona.test.mjs 逐条比对(同一批输入,
// 两份的输出必须完全一样)。改这里就要改那边,反之亦然。
//
// 格式见 lib/persona.mjs 顶部的说明。
;(function () {
  var FRONT = /^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

  function stripBom(text) {
    return String(text == null ? "" : text).replace(/^\uFEFF/, "")
  }

  function unquote(v) {
    var s = String(v == null ? "" : v).trim()
    if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
      return s.slice(1, -1).trim()
    }
    return s
  }

  function nameFromPath(file) {
    var base = String(file == null ? "" : file).replace(/\\/g, "/").split("/").pop() || ""
    return base.replace(/\.[^.]+$/, "").trim()
  }

  function parsePersona(text, file) {
    var raw = stripBom(text)
    var fallbackName = nameFromPath(file) || "persona"

    if (!raw.trim()) {
      return { name: fallbackName, description: "", body: "", ok: false, error: "文件是空的" }
    }

    var name = ""
    var description = ""
    var body = raw

    var m = FRONT.exec(raw)
    if (m) {
      body = raw.slice(m[0].length)
      var lines = m[1].split(/\r?\n/)
      for (var i = 0; i < lines.length; i++) {
        var at = lines[i].indexOf(":")
        if (at <= 0) continue
        var key = lines[i].slice(0, at).trim().toLowerCase()
        var value = unquote(lines[i].slice(at + 1))
        if (key === "name") name = value
        else if (key === "description" || key === "desc") description = value
      }
    }

    var trimmed = body.trim()
    if (!trimmed) {
      return { name: name || fallbackName, description: description, body: "", ok: false, error: "正文是空的(只有 frontmatter?)" }
    }

    return { name: name || fallbackName, description: description, body: trimmed, ok: true, error: "" }
  }

  window.__PERSONA__ = { parsePersona: parsePersona }
})()
