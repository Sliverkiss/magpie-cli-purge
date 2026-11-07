// 人设文件的格式。
//
// 人设是磁盘上的一个 Markdown 文件,不在插件里手打。格式只有一层可选的 frontmatter:
//
//   ---
//   name: my-assistant
//   description: 一句话说明,页面上显示的就是它
//   ---
//   正文。这一段会被放进系统提示词。
//
// 规则:
//   - frontmatter 可以完全不写。不写时正文就是整个文件,名字取文件名(去扩展名)。
//   - frontmatter 里认得的键只有 name 和 description,其余忽略(这样别人的文件
//     多带几个键也不会报错)。
//   - 值两侧的引号会去掉;一行一个键,不做列表、不做嵌套。
//   - 正文为空就是错的:一个没有正文的人设没有意义,导入时应当被拒。
//
// 为什么用 frontmatter:agent-purge 的人设也是这个形状,Markdown 生态里到处都是,
// 拿 VSCode / Obsidian 打开就能写,不需要学新东西。
//
// 这个文件是 CLI 和测试用的 ESM 版本;页面是沙箱里的普通脚本,读不到模块,
// 所以 page/persona.js 里有一份同样的实现,由 test/persona.test.mjs 逐条比对
// 两者结果一致 —— 两份不允许分叉。

const FRONT = /^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

// stripBom 去掉 UTF-8 BOM:Windows 上的编辑器常加,留着会让第一行的 --- 认不出来。
function stripBom(text) {
  return String(text ?? "").replace(/^\uFEFF/, "")
}

// unquote 去掉值两侧成对的引号。
function unquote(v) {
  const s = String(v ?? "").trim()
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1).trim()
  }
  return s
}

// nameFromPath 从文件名取一个名字:去目录、去扩展名。
function nameFromPath(file) {
  const base = String(file ?? "").replace(/\\/g, "/").split("/").pop() || ""
  return base.replace(/\.[^.]+$/, "").trim()
}

// parsePersona 把一份人设文件读成 { name, description, body, ok, error }。
//
// ok 为 false 时 error 说得清为什么(正文为空 / 整个文件为空),导入方应当拒收,
// 而不是把一个空人设塞进配置里 —— 那会让人以为导入成功了。
export function parsePersona(text, file = "") {
  const raw = stripBom(text)
  const fallbackName = nameFromPath(file) || "persona"

  if (!raw.trim()) {
    return { name: fallbackName, description: "", body: "", ok: false, error: "文件是空的" }
  }

  let name = ""
  let description = ""
  let body = raw

  const m = FRONT.exec(raw)
  if (m) {
    body = raw.slice(m[0].length)
    for (const line of m[1].split(/\r?\n/)) {
      const at = line.indexOf(":")
      if (at <= 0) continue
      const key = line.slice(0, at).trim().toLowerCase()
      const value = unquote(line.slice(at + 1))
      if (key === "name") name = value
      else if (key === "description" || key === "desc") description = value
    }
  }

  const trimmed = body.trim()
  if (!trimmed) {
    return { name: name || fallbackName, description, body: "", ok: false, error: "正文是空的(只有 frontmatter?)" }
  }

  return { name: name || fallbackName, description, body: trimmed, ok: true, error: "" }
}

// describe 是页面上那一行摘要:名字、说明、字数。
export function describePersona(name, description, body) {
  const parts = []
  if (name) parts.push(String(name))
  if (description) parts.push(String(description))
  const chars = String(body ?? "").length
  parts.push(chars ? `${chars} 字` : "空")
  return parts.join(" · ")
}
