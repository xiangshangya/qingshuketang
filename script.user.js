// ==UserScript==
// @name         <湘裳>青书学堂自动刷课（最高16倍速播放视频）
// @version      1.1
// @description  青书学堂自动刷课，最高支持视频16倍速调节；非视频等待3秒自动下一节；最后一节返回第一节循环播放，并显示循环次数。
// @match        *://*.qingshuxuetang.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=degree.qingshuxuetang.com
// @run-at       document-end
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/xiangshangya/qingshuketang
// ==/UserScript==

;(function () {
  'use strict'

  const message = document.createElement('div')
  const urlParams = new URLSearchParams(window.location.search)
  const currentNodeId = urlParams.get('nodeId')
  let nextNode
  let findCoursesTimer
  let findVideoTimer
  let courseNodeArray = [] // 保存全部课程节点（包含非视频）

  // 循环次数管理
  let cycleCount = parseInt(sessionStorage.getItem('cycleCount')) || 1
  const saveCycleCount = (count) => {
    cycleCount = count
    sessionStorage.setItem('cycleCount', count)
  }
  const getCycleText = () => ` (第${cycleCount}次循环)`
  const setMessage = (text) => {
    message.innerText = text + getCycleText()
  }

  message.style = 'display:inline-block;color:red;font-size:18px;'
  const playerHeader = document.querySelector('.player-header')
  playerHeader.parentNode.insertBefore(message, playerHeader)

  // ========== 非视频课程处理：等待3秒后自动跳转下一节 ==========
  if (currentNodeId.includes('jbxx')) {
    setMessage('[湘裳自动刷课] 非视频课程，3秒后自动进入下一节')

    const waitForCoursesAndNext = () => {
      const list = document.querySelectorAll('#lessonMenu li a[id]')
      if (list && list.length > 0) {
        const nodeArray = []
        list.forEach(item => {
          nodeArray.push({
            id: item.id.split('-')[1],
            title: item.text
          })
        })
        courseNodeArray = nodeArray
        const nextNode = nodeArray[nodeArray.findIndex(o => o.id === currentNodeId) + 1]
        if (nextNode) {
          setTimeout(() => {
            urlParams.set('nodeId', nextNode.id)
            location.replace(window.location.pathname + '?' + urlParams.toString())
          }, 3000)
        } else {
          // 已是最后一节，增加循环次数并跳转到第一节
          const newCycle = cycleCount + 1
          saveCycleCount(newCycle)
          setMessage(`[湘裳自动刷课] 已是最后一节，3秒后返回第一节 (第${newCycle}次循环)`)
          setTimeout(() => {
            const firstNode = courseNodeArray[0]
            if (firstNode) {
              urlParams.set('nodeId', firstNode.id)
              location.replace(window.location.pathname + '?' + urlParams.toString())
            }
          }, 3000)
        }
      } else {
        setTimeout(waitForCoursesAndNext, 500)
      }
    }
    waitForCoursesAndNext()
    return
  }

  // ========== 视频课程处理 ==========
  const findCourses = () => {
    const list = document.querySelectorAll('#lessonMenu li a[id]')
    if (list && list.length > 0) clearInterval(findCoursesTimer)
    const nodeArray = []
    list.forEach(item => {
      nodeArray.push({
        id: item.id.split('-')[1],
        title: item.text
      })
    })
    courseNodeArray = nodeArray
    window.sss = nodeArray
    nextNode = nodeArray[nodeArray.findIndex(o => o.id === currentNodeId) + 1]
    if (nextNode) {
      setMessage(`[湘裳自动刷课] 下一节课：${nextNode.title}`)
    } else {
      const firstNode = courseNodeArray[0]
      if (firstNode) {
        setMessage(`[湘裳自动刷课] 最后一节课，结束后将返回第一节：${firstNode.title}`)
      } else {
        setMessage('[湘裳自动刷课] 无法获取课程列表')
      }
    }
  }
  findCoursesTimer = setInterval(findCourses, 1000)

  const findVideo = () => {
    const player = window.CoursewarePlayer
    if (player) {
      clearInterval(findVideoTimer)
      player.videoPlayer.player.muted(true)
      player.seek(0)
      player.play()
      player.videoPlayer.player.playbackRate(2)
      // 倍速选择器
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
        if (nextNode) {
          urlParams.set('nodeId', nextNode.id)
          location.replace(window.location.pathname + '?' + urlParams.toString())
        } else {
          // 最后一节视频结束，增加循环次数并返回第一节
          const newCycle = cycleCount + 1
          saveCycleCount(newCycle)
          const firstNode = courseNodeArray[0]
          if (firstNode) {
            urlParams.set('nodeId', firstNode.id)
            location.replace(window.location.pathname + '?' + urlParams.toString())
          }
        }
      })
    }
  }
  findVideoTimer = setInterval(findVideo, 1000)
})()
