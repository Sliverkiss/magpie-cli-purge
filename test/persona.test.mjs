// 人设文件格式,以及两份实现的一致性。
//
// 格式由 lib/persona.mjs 定义;页面里有一份复制品(page/persona.js),因为页面
// 是沙箱里的普通脚本,读不到 ESM 模块。两份不许分叉,所以这里用同一批输入跑两边,
// 逐字段比对。

import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { parsePersona, describePersona } from "../lib/persona.mjs"

// 页面那一份:在假 window 上求值,取出它挂的函数
const win = {}
new Function("window", readFileSync(join(new URL("..", import.meta.url).pathname, "page", "persona.js"), "utf8"))(win)
const pageParse = win.__PERSONA__.parsePersona

// ---- 格式 ----

test("带 frontmatter:名字、说明、正文都读出来", () => {
  const r = parsePersona("---\nname: my-assistant\ndescription: 一句话说明\n---\n正文第一行\n正文第二行\n", "x.md")
  assert.equal(r.ok, true)
  assert.equal(r.name, "my-assistant")
  assert.equal(r.description, "一句话说明")
  assert.equal(r.body, "正文第一行\n正文第二行")
})

test("不带 frontmatter:整个文件是正文,名字取文件名", () => {
  const r = parsePersona("You are a plain assistant.\n", "/home/me/prompts/cool-guy.md")
  assert.equal(r.ok, true)
  assert.equal(r.name, "cool-guy")
  assert.equal(r.description, "")
  assert.equal(r.body, "You are a plain assistant.")
})

test("frontmatter 里没有 name:名字仍然取文件名", () => {
  const r = parsePersona("---\ndescription: 只有说明\n---\n正文\n", "a/b/my-file.md")
  assert.equal(r.name, "my-file")
  assert.equal(r.description, "只有说明")
  assert.equal(r.body, "正文")
})

test("不认得的键忽略掉,不报错", () => {
  const r = parsePersona("---\nname: n\norder: 3\nharness: pi\nmodel: x\n---\n正文\n", "f.md")
  assert.equal(r.ok, true)
  assert.equal(r.name, "n")
  assert.equal(r.body, "正文")
})

test("desc 是 description 的别名", () => {
  assert.equal(parsePersona("---\ndesc: 短说明\n---\n正文\n").description, "短说明")
})

test("值两侧的引号去掉", () => {
  assert.equal(parsePersona('---\nname: "带 空格"\n---\n正文\n').name, "带 空格")
  assert.equal(parsePersona("---\nname: 'x'\n---\n正文\n").name, "x")
  assert.equal(parsePersona('---\nname: 没有收尾引号"\n---\n正文\n').name, '没有收尾引号"')
})

test("CRLF 和 BOM 都认", () => {
  const crlf = parsePersona("﻿---\r\nname: n\r\n---\r\n正文\r\n第二行\r\n", "f.md")
  assert.equal(crlf.ok, true)
  assert.equal(crlf.name, "n")
  assert.equal(crlf.body, "正文\r\n第二行")
})

test("正文首尾空白收掉", () => {
  assert.equal(parsePersona("\n\n  正文  \n\n").body, "正文")
})

test("--- 在正文中间不算 frontmatter", () => {
  const text = "第一行\n\n---\n\n后面\n"
  const r = parsePersona(text, "f.md")
  assert.equal(r.body, text.trim(), "整个文件都是正文")
})

test("空文件被拒", () => {
  const r = parsePersona("   \n\n  ", "f.md")
  assert.equal(r.ok, false)
  assert.match(r.error, /空的/)
  assert.equal(r.body, "")
})

test("只有 frontmatter、正文为空,被拒", () => {
  const r = parsePersona("---\nname: n\n---\n\n", "f.md")
  assert.equal(r.ok, false)
  assert.match(r.error, /正文是空的/)
  assert.equal(r.name, "n", "名字还是读出来了,好让报错说得出是谁")
})

test("文件名没有扩展名 / 没有文件名时,名字兜底", () => {
  assert.equal(parsePersona("正文", "noext").name, "noext")
  assert.equal(parsePersona("正文", "").name, "persona")
})

test("正文里的 --- 不会被再解析一次", () => {
  const r = parsePersona("---\nname: n\n---\n正文\n---\n还在正文里\n", "f.md")
  assert.equal(r.body, "正文\n---\n还在正文里")
})

test("describePersona 拼出页面那一行摘要", () => {
  assert.equal(describePersona("n", "d", "12345"), "n · d · 5 字")
  assert.equal(describePersona("n", "", "12345"), "n · 5 字")
  assert.equal(describePersona("n", "", ""), "n · 空")
})

// ---- 两份实现不许分叉 ----

const CASES = [
  ["---\nname: a\ndescription: d\n---\nbody\n", "f.md"],
  ["just a body", "/x/y/z.md"],
  ["---\ndescription: only\n---\nbody", "n.md"],
  ["---\nname: 'q'\n---\nbody", ""],
  ["", "e.md"],
  ["---\nname: n\n---\n", "e.md"],
  ["﻿---\r\nname: b\r\n---\r\nbody\r\n", "w.md"],
  ["第一行\n---\n第二行", "m.md"],
  ["---\nname: n\norder: 1\n---\nbody\n---\nmore", "m.md"],
  ["   \n\n  ", "s.md"],
]

test("页面那一份和 ESM 那一份,同一批输入结果完全一样", () => {
  for (const [text, file] of CASES) {
    const a = parsePersona(text, file)
    const b = pageParse(text, file)
    assert.deepEqual(b, a, `不一致,输入 ${JSON.stringify(text.slice(0, 30))} / ${file}`)
  }
})
