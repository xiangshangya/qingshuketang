// ==UserScript==
// @name         <湘裳>青书学堂自动刷课（最高16倍速播放视频）
// @version      1.0
// @description  青书学堂自动刷课，最高支持视频16倍速调节。
// @match        https://*.qingshuxuetang.com/*/*/CourseShow*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=degree.qingshuxuetang.com
// @run-at       document-end
// @grant        none
// @license      MIT
// ==/UserScript==

;(function () {
  'use strict'

  const message = document.createElement('div')
  const urlParams = new URLSearchParams(window.location.search)
  const currentNodeId = urlParams.get('nodeId')
  let nextNode
  let findCoursesTimer
  let findVideoTimer

  message.style = 'display:inline-block;color:red;font-size:18px;'
  const playerHeader = document.querySelector('.player-header')
  playerHeader.parentNode.insertBefore(message, playerHeader)

  if (currentNodeId.includes('jbxx')) {
    message.innerText = '[湘裳自动刷课] ⚠ 只有视频课程才能自动刷课'
    return
  }

  const findCourses = () => {
    const list = document.querySelectorAll('#lessonMenu li a[id]')
    if (list && list.length > 0) clearInterval(findCoursesTimer)
    const nodeArray = []
    list.forEach(item => {
      if (item.id.includes('jbxx')) return
      nodeArray.push({
        id: item.id.split('-')[1],
        title: item.text
      })
    })
    window.sss = nodeArray
    nextNode = nodeArray[nodeArray.findIndex(o => o.id === currentNodeId) + 1]
    if (nextNode) message.innerText = `[湘裳自动刷课] 下一节课：${nextNode.title}`
    else message.innerText = '[湘裳自动刷课] ⚠ 目前最后一节课了'
  }
  findCoursesTimer = setInterval(findCourses, 1000)

  const findVideo = () => {
    const player = window.CoursewarePlayer
    if (player) {
      clearInterval(findVideoTimer)
      player.videoPlayer.player.muted(true)
      player.seek(0)
      player.play()
      player.videoPlayer.player.playbackRate(2)//默认倍速
      // 倍速控制
      const speedControl = document.createElement('select')
      speedControl.innerHTML = `
        <option value="1">1x</option>
        <option value="2" selected>2x</option>
        <option value="3">3x</option>
        <option value="4">4x</option>
        <option value="5">5x</option>
        <option value="8">8x</option>
        <option value="10">10x</option>
        <option value="16">16x</option>
      `
      speedControl.style = 'position:absolute;top:10px;right:10px;z-index:9999;font-size:14px;'
      document.body.appendChild(speedControl)
      speedControl.addEventListener('change', function () {
        player.videoPlayer.player.playbackRate(parseFloat(this.value))
      })

      player.addListener('ended', function () {
        if (!nextNode) return
        urlParams.set('nodeId', nextNode.id)
        location.replace(window.location.pathname + '?' + urlParams.toString())
      })
    }
  }
  findVideoTimer = setInterval(findVideo, 1000)
})()
