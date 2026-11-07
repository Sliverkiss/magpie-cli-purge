// options 迁移:宿主 options.set 是整对象替换,旧键不清就会每次保存原样回灌。
// 启动读回 options 后跑一次:旧人设搬进 library,其余旧键删掉。
// 纯函数:不碰入参,返回 { options, changed };重跑一次 changed=false。
;(function (root) {
  // 这些键新版不读;留在 options 里只会被保存原样写回去。
  // (learn/native 是有效选项,native/learn 不清理;agents 是白名单,不清理。)
  var LEGACY_KEYS = [
    "agentOrder",
    "groups",
    "personaName",
    "personaFile",
    "personaDescription",
    "personas",
    "replacements",
    "notes",
    "fingerprints",
    "status",
  ]

  function isObj(v) {
    return v && typeof v === "object" && !Array.isArray(v)
  }

  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k)
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(isObj(v) ? v : {}))
  }

  function migrateOptions(raw) {
    var src = isObj(raw) ? raw : {}
    var out = clone(src)
    var changed = false

    // 顶层 personas 合并进 library;同 id 以 library 为准。
    if (isObj(src.personas)) {
      if (!isObj(out.library)) out.library = {}
      if (!isObj(out.library.personas)) out.library.personas = {}
      for (var pid in src.personas) {
        if (!has(src.personas, pid) || has(out.library.personas, pid)) continue
        out.library.personas[pid] = clone(src.personas[pid])
      }
      changed = true
    }

    // library.replacements 是失效配置(替换词已移除):整块删掉。
    if (isObj(out.library) && has(out.library, "replacements")) {
      delete out.library.replacements
      changed = true
    }
    if (isObj(out.library) && has(out.library, "replacementSets")) {
      delete out.library.replacementSets
      changed = true
    }
    // library.scenes 是失效配置:删掉。
    if (isObj(out.library) && has(out.library, "scenes")) {
      delete out.library.scenes
      changed = true
    }

    for (var i = 0; i < LEGACY_KEYS.length; i++) {
      if (!has(src, LEGACY_KEYS[i])) continue
      delete out[LEGACY_KEYS[i]]
      changed = true
    }

    return { options: out, changed: changed }
  }

  root.__MIGRATE__ = { migrateOptions: migrateOptions }
})(typeof window !== "undefined" ? window : globalThis)
