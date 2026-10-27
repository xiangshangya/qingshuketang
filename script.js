// ==UserScript==
// @name         <湘裳>青书学堂自动刷课v2.1
// @namespace    https://github.com/xiangshangya/qingshuketang
// @version      2.1.1
// @description  青书学堂自动刷课增强版｜非视频自动跳过｜手动暂停保持(30分钟兜底恢复)｜单节点1.5小时自动下一节｜空节点重试5次后跳过｜默认2倍速可持久化｜最高16倍速
// @author       湘裳
// @match        *://*.qingshuxuetang.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=degree.qingshuxuetang.com
// @run-at       document-end
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/xiangshangya/qingshuketang
// ==/UserScript==

;(function () {
  'use strict'

  if (window.__QS_AUTO_STUDY_V2__) return
  window.__QS_AUTO_STUDY_V2__ = true

  /* ======================= 配置区 ======================= */
  const CFG = {
    version: '2.1.1',
    rateList: [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16],
    userRateDefault: 2,          // 默认倍速（只有手动调节才会持久化改变）
    mute: true,                  // 自动静音

    probeTimeout: 10000,         // 判定"本节无内容"前最多等多久
    probeExtend: 30000,          // 检测到 loading 时延长到多久
    emptyRetryMax: 5,            // 空节点/播放失败重试次数，超过则跳过本节
    emptyRetryDelay: 1500,       // 空节点每次重试前等待
    errorGraceMs: 3000,          // 出现"播放失败"文案后给站点的自救宽限
    errorRetryDelay: 800,        // 播放失败时重试前的等待（比空节点快）

    pauseAutoResume: 30 * 60 * 1000,  // 手动暂停超过 30 分钟 → 兜底恢复播放
    pauseCheckTick: 1000,

    nodeMaxMs: 90 * 60 * 1000,   // 同一节点停留 1.5 小时 → 自动下一节

    menuTimeout: 12000,
    nonVideoDelay: 900,
    jumpDelay: 300,
    endDelay: 1000,
    tick: 1000,
    stallMs: 8000,
    autoClickDialogs: true,
  }

  const K = {
    userRate: 'qsAutoStudy.userRate',
    cycle: 'qsAutoStudy.cycle.',
    enterAt: 'qsAutoStudy.enterAt',
    lastNode: 'qsAutoStudy.lastNode',
    retry: 'qsAutoStudy.retry.',
    skip: 'qsAutoStudy.skip',
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v) } catch (e) { return d } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} },
    sget(k, d) { try { const v = sessionStorage.getItem(k); return v === null ? d : JSON.parse(v) } catch (e) { return d } },
    sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)) } catch (e) {} },
    sdel(k) { try { sessionStorage.removeItem(k) } catch (e) {} },
  }

  const S = {
    mode: 'init',        // init | video | nonvideo | empty | idle
    nodeId: '',
    nodes: [],
    cycle: 1,
    userRate: CFG.userRateDefault,  // 用户设定的倍速（持久化）
    rate: CFG.userRateDefault,      // 当前运行倍速（卡顿时会临时下调）
    video: null,
    lastTime: 0,
    lastMoveAt: 0,
    lastSeen: 0,
    lastWaitingAt: 0,
    stallFixes: 0,
    ended: false,
    jumping: false,
    paused: false,          // 面板"暂停自动"
    userPaused: false,      // 用户手动暂停（保持暂停，30 分钟兜底）
    pauseStartAt: 0,
    nodeStartAt: 0,
    retryCleared: '',
    lastSweep: 0,
    attached: new WeakSet(),
  }

  const log = function () {
    try { console.log.apply(console, ['%c[青书自动刷课]', 'color:#e91e63;font-weight:bold'].concat([].slice.call(arguments))) } catch (e) {}
  }
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  function fmt(s) {
    if (!isFinite(s) || s < 0) return '--:--'
    s = Math.floor(s)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = s % 60
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0')
    return m + ':' + String(ss).padStart(2, '0')
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
    if (h > 0) return h + '小时' + m + '分'
    if (m > 0) return m + '分' + ss + '秒'
    return ss + '秒'
  }

  /* ======================= 界面 ======================= */
  const UI = (function () {
    let root, elState, elProg, elNext, elCycle, elRate, btnPause, built = false
    const css = [
      '#qs-auto-widget{position:fixed;top:10px;right:10px;z-index:2147483000;width:258px;',
      'font:12px/1.65 "Microsoft YaHei",Arial,sans-serif;color:#e8eefc;background:rgba(18,22,32,.93);',
      'border:1px solid rgba(110,150,255,.45);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.4);',
      'overflow:hidden;user-select:none}',
      '#qs-auto-widget .qs-hd{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;',
      'background:linear-gradient(90deg,rgba(80,120,255,.35),rgba(80,120,255,.10));cursor:pointer}',
      '#qs-auto-widget .qs-hd b{font-size:12px}',
      '#qs-auto-widget .qs-hd i{font-style:normal;opacity:.75;font-size:11px}',
      '#qs-auto-widget .qs-bd{padding:8px 10px}',
      '#qs-auto-widget.qs-collapsed .qs-bd{display:none}',
      '#qs-auto-widget .qs-row{display:flex;gap:4px;margin:1px 0;white-space:nowrap;overflow:hidden}',
      '#qs-auto-widget .qs-k{color:#8fa3c4;flex:none}',
      '#qs-auto-widget .qs-v{color:#7fe3b4;overflow:hidden;text-overflow:ellipsis}',
      '#qs-auto-widget .qs-ops{display:flex;gap:6px;margin-top:7px}',
      '#qs-auto-widget button,#qs-auto-widget select{flex:1;background:#2b3552;color:#e8eefc;',
      'border:1px solid rgba(110,150,255,.4);border-radius:6px;padding:3px 4px;font-size:12px;cursor:pointer;outline:none}',
      '#qs-auto-widget button:hover,#qs-auto-widget select:hover{border-color:#7ea6ff}',
      '#qs-auto-widget button.qs-off{background:#5a2b33;border-color:#c05070}',
    ].join('')
    function build() {
      if (built) return
      built = true
      const st = document.createElement('style'); st.textContent = css
      ;(document.head || document.documentElement).appendChild(st)
      root = document.createElement('div'); root.id = 'qs-auto-widget'
      root.innerHTML =
        '<div class="qs-hd"><b>青书自动刷课 v' + CFG.version + '</b><i data-fold>收起</i></div>' +
        '<div class="qs-bd">' +
        '  <div class="qs-row"><span class="qs-k">状态</span><span class="qs-v" data-state>初始化…</span></div>' +
        '  <div class="qs-row"><span class="qs-k">进度</span><span class="qs-v" data-prog>—</span></div>' +
        '  <div class="qs-row"><span class="qs-k">下一节</span><span class="qs-v" data-next>—</span></div>' +
        '  <div class="qs-row"><span class="qs-k">循环</span><span class="qs-v" data-cycle>—</span></div>' +
        '  <div class="qs-row"><span class="qs-k">本节</span><span class="qs-v" data-elapsed>—</span></div>' +
        '  <div class="qs-ops"><select data-rate></select><button data-pause>暂停自动</button></div>' +
        '</div>'
      ;(document.body || document.documentElement).appendChild(root)
      elState = root.querySelector('[data-state]')
      elProg = root.querySelector('[data-prog]')
      elNext = root.querySelector('[data-next]')
      elCycle = root.querySelector('[data-cycle]')
      elRate = root.querySelector('[data-rate]')
      btnPause = root.querySelector('[data-pause]')

      elRate.innerHTML = CFG.rateList.map(function (r) { return '<option value="' + r + '">' + r + 'x</option>' }).join('')
      elRate.value = String(S.userRate)
      elRate.addEventListener('change', function () {
        const v = parseFloat(elRate.value)
        if (!v) return
        S.userRate = v
        S.rate = v
        store.set(K.userRate, v)   // 只有手动调节才写入持久化
        applyRate(true)
        UI.state('已手动切换到 ' + v + 'x（已记住）')
      })

      btnPause.addEventListener('click', function () {
        S.paused = !S.paused
        btnPause.textContent = S.paused ? '继续自动' : '暂停自动'
        if (S.paused) btnPause.classList.add('qs-off'); else btnPause.classList.remove('qs-off')
        UI.state(S.paused ? '已暂停自动（可手动操作）' : '已恢复自动')
        if (!S.paused) ensurePlaying()
      })

      root.querySelector('[data-fold]').addEventListener('click', function () {
        root.classList.toggle('qs-collapsed')
        this.textContent = root.classList.contains('qs-collapsed') ? '展开' : '收起'
      })
    }
    return {
      init: build,
      state: function (t) { if (elState) elState.textContent = t },
      progress: function (cur, dur) {
        if (!elProg) return
        if (!isFinite(dur) || dur <= 0) { elProg.textContent = fmt(cur) + ' / --:--'; return }
        elProg.textContent = fmt(cur) + ' / ' + fmt(dur) + ' ' + Math.min(100, Math.floor(cur / dur * 100)) + '%'
      },
      next: function (t) { if (elNext) elNext.textContent = t || '—' },
      cycle: function (n) { if (elCycle) elCycle.textContent = '第 ' + n + ' 次' },
      rate: function (r) { if (elRate) elRate.value = String(r) },
      elapsed: function (ms) {
        const el = root && root.querySelector('[data-elapsed]')
        if (el) el.textContent = fmtDur(ms)
      },
      collapse: function (tip) {
        if (!root) return
        root.classList.add('qs-collapsed')
        const f = root.querySelector('[data-fold]')
        if (f) f.textContent = '展开'
        if (tip && elState) elState.textContent = tip
      },
    }
  })()

  /* ======================= DOM 探测 ======================= */

  function nodeIdOf(a) {
    if (!a) return ''
    const id = a.id || ''
    if (id.indexOf('courseware-') === 0) return id.slice('courseware-'.length)
    const m = (a.getAttribute('href') || '').match(/onMenuClick\(\s*['"]([^'"]+)['"]\s*\)/)
    return m ? m[1] : ''
  }

  function listNodes() {
    const out = []
    const seen = {}
    let anchors = document.querySelectorAll('#lessonMenu a[id^="courseware-"]')
    if (!anchors.length) anchors = document.querySelectorAll('a[id^="courseware-"]')
    ;[].forEach.call(anchors, function (a) {
      const id = nodeIdOf(a)
      if (!id || seen[id]) return
      seen[id] = 1
      out.push({ id: id, title: (a.textContent || '').replace(/\s+/g, ' ').trim(), el: a })
    })
    return out
  }

  function currentNodeId() {
    const m = location.href.match(/[?&]nodeId=([^&#]+)/)
    if (!m) return ''
    try { return decodeURIComponent(m[1]) } catch (e) { return m[1] }
  }

  function courseKey() {
    const m = location.href.match(/[?&]courseId=([^&#]+)/)
    return m ? m[1] : 'default'
  }

  function videoEl() {
    const list = document.querySelectorAll('#playerContainer video')
    for (let i = 0; i < list.length; i++) {
      const v = list[i]
      if (v.offsetWidth > 0 || v.offsetHeight > 0 || v.currentSrc) return v
    }
    const all = document.querySelectorAll('video')
    for (let i = 0; i < all.length; i++) {
      if (all[i].offsetWidth > 0 && all[i].offsetHeight > 0) return all[i]
    }
    return null
  }

  function detectMode() {
    const pc = document.querySelector('#playerContainer')
    if (!pc) return 'unknown'
    if (pc.querySelector('.video-js') || pc.querySelector('video.vjs-tech')) return 'video'
    if (pc.querySelector('iframe')) return 'nonvideo'
    if (pc.querySelector('video')) return 'video'
    return 'unknown'
  }

  function hasLoading() {
    const sels = ['.loading', '.spinner', '[class*="loading"]', '.el-loading-mask', '.blockUI', '[class*="mask"]']
    for (let i = 0; i < sels.length; i++) {
      const el = document.querySelector(sels[i])
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return true
    }
    return false
  }

  // 播放器区域里出现"播放失败"类文案 → 该节点没有可用视频源
  const ERR_WORDS = [
    '不支持当前视频格式', '视频播放失败', '视频加载失败', '视频不存在',
    '无法播放', '资源不存在', '播放出错', '暂不可用',
  ]
  function playbackErrorText() {
    const pc = document.querySelector('#playerContainer')
    if (!pc) return ''
    const t = (pc.innerText || '').replace(/\s+/g, '')
    if (!t || t.length > 200) return ''   // 容器里塞了正常内容时不误判
    for (let i = 0; i < ERR_WORDS.length; i++) {
      if (t.indexOf(ERR_WORDS[i]) >= 0) return ERR_WORDS[i]
    }
    return ''
  }

  function waitFor(fn, timeout, step) {
    return new Promise(function (resolve) {
      const t0 = Date.now()
      ;(function loop() {
        let v = null
        try { v = fn() } catch (e) { v = null }
        if (v) return resolve(v)
        if (Date.now() - t0 > timeout) return resolve(null)
        setTimeout(loop, step || 300)
      })()
    })
  }

  /* ======================= 跳过名单 / 重试计数 ======================= */

  function loadSkip() {
    const a = store.sget(K.skip, [])
    return Array.isArray(a) ? a : []
  }
  function markSkip(id) {
    const a = loadSkip()
    if (a.indexOf(id) < 0) a.push(id)
    store.sset(K.skip, a)
  }
  function isSkipped(id) { return loadSkip().indexOf(id) >= 0 }

  function retryKey(id) { return K.retry + id }
  function clearRetry(id) { store.sdel(retryKey(id)) }
  function bumpRetry(id) {
    const n = Number(store.sget(retryKey(id), 0) || 0) + 1
    store.sset(retryKey(id), n)
    return n
  }

  /* ======================= 播放控制 ======================= */

  function applyRate(force) {
    const v = S.video || videoEl()
    if (!v) return
    if (!force && Math.abs(v.playbackRate - S.rate) < 0.05) return
    try { v.defaultPlaybackRate = S.rate; v.playbackRate = S.rate } catch (e) {}
  }

  function ensurePlaying() {
    const v = S.video || videoEl()
    if (!v) return
    S.video = v
    if (CFG.mute) { try { v.muted = true } catch (e) {} }
    if (v.paused && !v.ended) {
      S.userPaused = false
      S.pauseStartAt = 0
      try { const p = v.play(); if (p && p.catch) p.catch(function () {}) } catch (e) {}
    }
    applyRate(true)
  }

  function attach(v) {
    if (!v || S.attached.has(v)) return
    S.attached.add(v)

    v.addEventListener('ended', function () { onEnded('ended 事件') })

    v.addEventListener('play', function () {
      S.userPaused = false
      S.pauseStartAt = 0
      S.lastMoveAt = Date.now()
    })

    v.addEventListener('pause', function () {
      if (S.ended) return
      S.pauseStartAt = Date.now()
      // 判断这次暂停是"用户点的"还是"播放器/缓冲异常"
      const abnormal = (Date.now() - S.lastWaitingAt < 3000) || v.readyState < 3 || !!v.error
      S.userPaused = !abnormal
      if (!abnormal) {
        log('用户手动暂停，保持暂停（30 分钟后兜底恢复）')
        return
      }
      if (S.paused) return
      setTimeout(function () {
        if (S.paused || S.ended) return
        if (v.paused && !v.ended && !S.userPaused) {
          try { const p = v.play(); if (p && p.catch) p.catch(function () {}) } catch (e) {}
        }
      }, 600)
    })

    v.addEventListener('waiting', function () { S.lastWaitingAt = Date.now() })
    v.addEventListener('stalled', function () { S.lastWaitingAt = Date.now() })
    v.addEventListener('playing', function () { S.lastMoveAt = Date.now() })
    v.addEventListener('error', function () {
      log('视频元素报错', v.error && v.error.code)
      S.lastWaitingAt = Date.now()
      setTimeout(function () { try { v.load(); v.play() } catch (e) {} }, 1200)
    })

    log('已绑定视频元素:', v.id || '(no id)', '时长', v.duration)
  }

  function startVideo() {
    S.mode = 'video'
    const v = videoEl()
    if (v) {
      S.video = v
      attach(v)
      S.lastTime = v.currentTime || 0
      S.lastMoveAt = Date.now()
      S.lastSeen = Date.now()
      if (v.duration) UI.progress(v.currentTime, v.duration)
    }
    ensurePlaying()
    UI.state('视频播放中 · ' + S.rate + 'x')
    log('进入视频模式', S.nodeId, '倍速', S.rate)
  }

  function startNonVideo() {
    S.mode = 'nonvideo'
    clearRetry(S.nodeId)
    UI.state('非视频课件，即将跳过')
    log('非视频节点 → 跳过', S.nodeId)
    setTimeout(function () {
      if (S.paused) return
      jumpNext('跳过非视频')
    }, CFG.nonVideoDelay)
  }

  // 本节没有任何可播放内容：重试 N 次后跳过
  function handleEmpty(reason) {
    S.mode = 'empty'
    const isErr = reason === 'error'
    const n = bumpRetry(S.nodeId)
    if (n <= CFG.emptyRetryMax) {
      UI.state((isErr ? '本节视频加载失败' : '本节无视频内容') + '，第 ' + n + '/' + CFG.emptyRetryMax + ' 次重试')
      log(isErr ? '播放失败重试' : '空节点重试', n, '/', CFG.emptyRetryMax, S.nodeId)
      setTimeout(function () {
        if (S.paused) return
        try { location.reload() } catch (e) {}
      }, isErr ? CFG.errorRetryDelay : CFG.emptyRetryDelay)
    } else {
      clearRetry(S.nodeId)
      markSkip(S.nodeId)
      UI.state('重试 ' + CFG.emptyRetryMax + ' 次仍无内容，跳过本节')
      log('空节点重试超限，标记跳过', S.nodeId)
      setTimeout(function () {
        if (S.paused) return
        jumpNext('节点无内容')
      }, 1200)
    }
  }

  function onEnded(reason) {
    if (S.ended || S.jumping || S.paused || S.userPaused) return
    S.ended = true
    UI.state('本节播放完成（' + reason + '）')
    log('本节完成:', S.nodeId)
    setTimeout(function () { jumpNext('播放完成') }, CFG.endDelay)
  }

  // 卡死分级修复：恢复播放 → 微调进度 → 临时降速 → 推片尾 → 跳过
  function fixStall(v) {
    S.stallFixes += 1
    S.lastMoveAt = Date.now()
    const lv = S.stallFixes
    log('播放停滞，修复级别 L' + lv)

    if (lv === 1) {
      UI.state('检测到卡顿，尝试恢复')
      try { const p = v.play(); if (p && p.catch) p.catch(function () {}) } catch (e) {}
    } else if (lv === 2) {
      UI.state('仍未推进，微调进度重试')
      try { v.currentTime = Math.min((isFinite(v.duration) ? v.duration : 1e9) - 1, v.currentTime + 2) } catch (e) {}
      try { const p = v.play(); if (p && p.catch) p.catch(function () {}) } catch (e) {}
    } else if (lv === 3) {
      if (S.rate > 8) {
        // 只临时降速，不覆盖用户设定的持久化倍速
        S.rate = Math.max(4, Math.round(S.rate / 2))
        UI.rate(S.rate)
        UI.state('多次卡顿，临时降速到 ' + S.rate + 'x（下次进入仍按 ' + S.userRate + 'x）')
        applyRate(true)
      } else {
        UI.state('重新加载媒体')
        try { v.load(); const p = v.play(); if (p && p.catch) p.catch(function () {}) } catch (e) {}
      }
    } else if (lv === 4) {
      if (isFinite(v.duration) && v.duration > 1) {
        UI.state('仍无法推进，直接推到片尾')
        try { v.currentTime = Math.max(0, v.duration - 0.4) } catch (e) {}
        try { const p = v.play(); if (p && p.catch) p.catch(function () {}) } catch (e) {}
      }
    } else {
      UI.state('本节无法正常播放，跳过')
      jumpNext('视频异常跳过')
    }
  }

  function sweepDialogs() {
    if (!CFG.autoClickDialogs) return
    if (S.mode !== 'video') return
    const v = S.video
    if (v && !v.paused && !v.ended) return
    const WORDS = ['继续学习', '继续观看', '继续播放', '我知道了', '知道了', '我还在']
    const list = document.querySelectorAll('a,button,span,div')
    for (let i = 0; i < list.length; i++) {
      const el = list[i]
      const t = (el.textContent || '').trim()
      if (WORDS.indexOf(t) < 0) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      try { el.click() } catch (e) { continue }
      log('自动点击弹窗按钮:', t)
      UI.state('已自动确认挂机弹窗')
      return
    }
  }

  /* ======================= 跳转 ======================= */

  function jumpNext(reason) {
    if (S.jumping) return
    const nodes = S.nodes.length ? S.nodes : listNodes()
    if (!nodes.length) { UI.state('课程目录为空，无法跳转'); return }

    let idx = -1
    const cur = S.nodeId || currentNodeId()
    for (let i = 0; i < nodes.length; i++) { if (nodes[i].id === cur) { idx = i; break } }
    if (idx < 0) {
      UI.state('未在目录中定位到当前节点，已停止自动跳转')
      log('定位失败。当前 nodeId =', cur)
      S.paused = true
      return
    }

    // 跳过被标记为"无内容"的节点
    let i = idx + 1
    let guard = 0
    while (i < nodes.length && isSkipped(nodes[i].id) && guard++ < nodes.length) i++

    if (i < nodes.length) {
      doJump(nodes[i], reason)
      return
    }

    // 已到末尾：回到第一个未被跳过的节点
    let j = 0
    while (j < nodes.length && isSkipped(nodes[j].id) && guard++ < nodes.length * 2) j++
    if (j >= nodes.length) {
      store.sdel(K.skip)
      j = 0
      UI.state('全部节点都被标记跳过，已重置跳过名单')
    }
    S.cycle += 1
    store.set(K.cycle + courseKey(), S.cycle)
    UI.cycle(S.cycle)
    doJump(nodes[j], reason + '｜已是最后一节，回到第一节')
  }

  function doJump(node, reason) {
    S.jumping = true
    UI.state(reason + ' → ' + node.title)
    UI.next(node.title)
    log('跳转 →', node.id, node.title)
    setTimeout(function () {
      try {
        const u = new URL(location.href)
        u.searchParams.set('nodeId', node.id)
        location.replace(u.toString())
      } catch (e) { log('跳转失败', e) }
    }, CFG.jumpDelay)
  }

  /* ======================= 节点计时 ======================= */

  // 同一节点连续访问（含刷新）累计时间；换节点则重置
  function enterNode(nodeId) {
    const last = store.sget(K.lastNode, '')
    const now = Date.now()
    if (last === nodeId) {
      S.nodeStartAt = Number(store.sget(K.enterAt, 0)) || now
    } else {
      S.nodeStartAt = now
      store.sset(K.enterAt, now)
    }
    store.sset(K.lastNode, nodeId)
  }

  /* ======================= 主循环 ======================= */

  function syncNode() {
    const cur = currentNodeId()
    if (!cur || cur === S.nodeId) return
    log('检测到节点切换', S.nodeId, '→', cur)
    S.nodeId = cur
    S.ended = false
    S.jumping = false
    S.stallFixes = 0
    S.lastTime = 0
    S.lastMoveAt = Date.now()
    S.lastSeen = Date.now()
    S.userPaused = false
    S.pauseStartAt = 0
    S.mode = 'init'
    enterNode(cur)
    const idx = S.nodes.findIndex(function (n) { return n.id === cur })
    UI.next(idx >= 0 && idx + 1 < S.nodes.length ? S.nodes[idx + 1].title : '末节｜结束后回到第一节')
    setTimeout(function () {
      if (S.paused) return
      const m = detectMode()
      if (m === 'video') startVideo()
      else if (m === 'nonvideo') startNonVideo()
    }, 800)
  }

  function tick() {
    if (S.paused) return
    syncNode()
    if (S.mode === 'nonvideo' || S.mode === 'empty') return

    if (S.mode !== 'video') {
      if (!document.querySelector('#playerContainer')) return
      if (detectMode() === 'video' || videoEl()) startVideo()
      return
    }

    const v = videoEl()
    if (!v) {
      if (playbackErrorText()) { handleEmpty('error'); return }
      if (Date.now() - S.lastSeen > 15000) {
        const m = detectMode()
        if (m === 'nonvideo') { S.mode = 'nonvideo'; startNonVideo(); return }
        if (m === 'unknown') { handleEmpty('empty'); return }
        S.mode = 'init'
        UI.state('播放器丢失，重新探测…')
      }
      return
    }

    if (v !== S.video) {
      S.video = v
      attach(v)
      S.lastTime = v.currentTime || 0
      S.lastMoveAt = Date.now()
    }
    S.lastSeen = Date.now()

    // 单节点停留超时 → 下一节
    if (S.nodeStartAt && Date.now() - S.nodeStartAt > CFG.nodeMaxMs) {
      UI.state('本节停留超过 ' + fmtDur(CFG.nodeMaxMs) + '，自动下一节')
      log('节点超时', S.nodeId)
      jumpNext('节点超时')
      return
    }

    UI.elapsed(Date.now() - S.nodeStartAt)

    if (CFG.mute && !v.muted) { try { v.muted = true } catch (e) {} }
    if (Math.abs(v.playbackRate - S.rate) > 0.05) applyRate(false)

    // 暂停处理
    if (v.paused && !v.ended) {
      if (S.userPaused) {
        const ms = Date.now() - S.pauseStartAt
        const left = CFG.pauseAutoResume - ms
        UI.state('已手动暂停 ' + fmtDur(ms) + (left > 0 ? '（' + fmtDur(left) + '后兜底恢复）' : ''))
        sweepDialogs()
        if (ms >= CFG.pauseAutoResume) {
          log('暂停超过 30 分钟，兜底恢复播放')
          S.userPaused = false
          S.pauseStartAt = 0
          try { const p = v.play(); if (p && p.catch) p.catch(function () {}) } catch (e) {}
          UI.state('暂停超过 ' + fmtDur(CFG.pauseAutoResume) + '，已恢复播放')
        }
        return    // 暂停期间不做卡死判定
      }
      try { const p = v.play(); if (p && p.catch) p.catch(function () {}) } catch (e) {}
    }

    // 进度 / 卡死
    if (v.currentTime > S.lastTime + 0.02) {
      S.lastTime = v.currentTime
      S.lastMoveAt = Date.now()
      S.stallFixes = 0
      UI.progress(v.currentTime, v.duration)
      if (!S.userPaused) UI.state('播放中 · ' + S.rate + 'x')
      if (S.retryCleared !== S.nodeId) { clearRetry(S.nodeId); S.retryCleared = S.nodeId }
    } else if (Date.now() - S.lastMoveAt > CFG.stallMs) {
      fixStall(v)
    }

    if (v.ended) { onEnded('ended'); return }
    if (isFinite(v.duration) && v.duration > 1 && v.currentTime >= v.duration - 0.3 && !v.seeking) {
      onEnded('播放至片尾')
      return
    }

    if (Date.now() - S.lastSweep > 5000) {
      S.lastSweep = Date.now()
      sweepDialogs()
    }
  }

  async function waitForMode() {
    const t0 = Date.now()
    let limit = CFG.probeTimeout
    let errAt = 0
    while (Date.now() - t0 < limit) {
      // 站点自己的"播放失败"提示：给 3 秒自救宽限，仍失败就判定本节没有可用视频
      if (playbackErrorText()) {
        if (!errAt) errAt = Date.now()
        else if (Date.now() - errAt > CFG.errorGraceMs) return 'error'
      } else {
        errAt = 0
      }
      const m = detectMode()
      if (m === 'video' && videoEl()) return 'video'
      if (m === 'nonvideo') return 'nonvideo'
      if (hasLoading()) limit = Math.max(limit, CFG.probeExtend)
      await sleep(300)
    }
    if (playbackErrorText()) return 'error'
    const m = detectMode()
    if (m === 'video' && videoEl()) return 'video'
    if (m === 'nonvideo') return 'nonvideo'
    return 'empty'
  }

  async function boot() {
    const saved = Number(store.get(K.userRate, CFG.userRateDefault))
    S.userRate = CFG.rateList.indexOf(saved) >= 0 ? saved : CFG.userRateDefault
    S.rate = S.userRate
    S.cycle = Number(store.get(K.cycle + courseKey(), 1)) || 1
    S.nodeId = currentNodeId()
    if (S.nodeId) enterNode(S.nodeId)

    UI.init()
    UI.rate(S.userRate)
    UI.cycle(S.cycle)
    UI.state('等待课件加载…')

    const nodes = await waitFor(function () { const n = listNodes(); return n.length ? n : null }, CFG.menuTimeout, 400)
    if (!nodes) {
      UI.collapse('非课件页，脚本待机')
      log('未找到 #lessonMenu，脚本待机')
      return
    }
    S.nodes = nodes

    let idx = -1
    for (let i = 0; i < nodes.length; i++) { if (nodes[i].id === S.nodeId) { idx = i; break } }
    if (idx >= 0) {
      let nxt = idx + 1
      while (nxt < nodes.length && isSkipped(nodes[nxt].id)) nxt++
      UI.next(nxt < nodes.length ? nodes[nxt].title : '末节｜结束后回到第一节')
    } else if (S.nodeId) {
      UI.next('未匹配到当前节点')
    } else {
      UI.next(nodes[0] ? nodes[0].title : '—')
    }
    log('当前节点', S.nodeId || '(无)', '目录索引', idx, '共', nodes.length, '个节点', '用户倍速', S.userRate)

    const mode = await waitForMode()
    if (S.paused) return

    if (mode === 'video') {
      clearRetry(S.nodeId)
      startVideo()
    } else if (mode === 'nonvideo') {
      startNonVideo()
    } else if (mode === 'error') {
      handleEmpty('error')
    } else {
      handleEmpty('empty')
    }
  }

  // 调试句柄：__qsAuto.S 查看状态，__qsAuto.jumpNext() 手动下一节
  window.__qsAuto = {
    CFG: CFG, S: S, UI: UI, K: K,
    jumpNext: jumpNext, ensurePlaying: ensurePlaying,
    videoEl: videoEl, detectMode: detectMode, listNodes: listNodes,
    loadSkip: loadSkip, markSkip: markSkip, playbackErrorText: playbackErrorText,
  }

  boot()
  setInterval(tick, CFG.tick)
})()
