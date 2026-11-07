// options 解析:模式、人设键、agent 白名单。页面 Library 写进 options 的东西,
// 网关侧必须按同一套语义读回来。

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DEFAULT_MODE,
  agentsAllowed,
  libraryOf,
  modeOf,
  personaOf,
} from "../lib/groups.mjs"

const lib = (personas = {}) => ({ personas })

test("人在库里:persona 是键,取 body", () => {
  const o = { persona: "terse", library: lib({ terse: { body: "You are terse." } }) }
  assert.equal(personaOf(o), "You are terse.")
})

test("老配置:库里没有这个键时,persona 当正文", () => {
  assert.equal(personaOf({ persona: "  You are old.  " }), "You are old.")
  assert.equal(personaOf({ persona: "" }), "")
  assert.equal(personaOf({}), "")
  // 裸字符串这条老路同样受上限保护,不然每请求 trim 一个超大串
  assert.equal(personaOf({ persona: "x".repeat(512 * 1024 + 1) }), "")
})

test("库里的人设正文超上限按空处理", () => {
  const big = "x".repeat(512 * 1024 + 1)
  assert.equal(personaOf({ persona: "big", library: lib({ big: { body: big } }) }), "")
})

test("modeOf:认得的模式原样,不认得的按默认", () => {
  assert.equal(modeOf({ mode: "strict" }), "strict")
  assert.equal(modeOf({ mode: "append" }), "append")
  assert.equal(modeOf({ mode: "off" }), "off")
  assert.equal(modeOf({ mode: "replace" }), DEFAULT_MODE, "replace 已移除,按默认档")
  assert.equal(modeOf({}), DEFAULT_MODE)
  assert.equal(DEFAULT_MODE, "append")
})

test("libraryOf:形状不对按空处理,不抛", () => {
  assert.deepEqual(libraryOf({}), { personas: {} })
  assert.deepEqual(libraryOf({ library: "junk" }), { personas: {} })
  assert.deepEqual(libraryOf({ library: { personas: { a: { body: "b" } } } }), { personas: { a: { body: "b" } } })
})

test("agentsAllowed:空名单 = 全部,非空 = 白名单", () => {
  assert.equal(agentsAllowed({ agents: [] }, "claude"), true)
  assert.equal(agentsAllowed({}, "claude"), true)
  assert.equal(agentsAllowed(undefined, "claude"), true)
  assert.equal(agentsAllowed({ agents: ["claude"] }, "claude"), true)
  assert.equal(agentsAllowed({ agents: ["codex"] }, "claude"), false)
})

// ---- 门禁(gateOf):页面三项 ↔ 网关一条,默认不分叉 ----

import { gateOf, MIN_TOOLS_DEFAULT } from "../lib/groups.mjs"

test("gateOf:缺省与 plan 旧行为一致", () => {
  assert.deepEqual(gateOf({}), { minTools: 3, skipNoQuery: true, skipNoEnv: true })
  assert.equal(MIN_TOOLS_DEFAULT, 3)
})

test("gateOf:minTools 非法值回默认,负数按 0,小数取整", () => {
  assert.equal(gateOf({ minTools: "x" }).minTools, 3)
  assert.equal(gateOf({ minTools: null }).minTools, 3)
  assert.equal(gateOf({ minTools: -5 }).minTools, 0)
  assert.equal(gateOf({ minTools: 2.9 }).minTools, 2)
})

test("gateOf:开关只有显式 false 才关", () => {
  assert.equal(gateOf({ skipNoQuery: false }).skipNoQuery, false)
  assert.equal(gateOf({ skipNoQuery: true }).skipNoQuery, true)
  assert.equal(gateOf({ skipNoQuery: "yes" }).skipNoQuery, true)
  assert.equal(gateOf({ skipNoEnv: undefined }).skipNoEnv, true)
})
