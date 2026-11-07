// 已废弃:writeStatus(把状态写回 plugins.json)已删。
//
// 为什么删:宿主盯着 plugins.json 的 mtime(internal/plugin 的 checkList →
// hostStale),每改一次就把整个 Bun 插件宿主拆掉重启;status.at 每请求都是新
// 时间戳,等于每个被改写的请求都重启一次宿主。页面也早已不读 status
// (page/migrate.js 把它当旧键清掉)。诊断挂 ctx.state 就够。
//
// 历史实现见 git 历史。此文件保留为空以占位;若确认无人引用,可直接删除。
