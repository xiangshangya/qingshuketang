# 使用说明

1. 使用 Chrome、Chrome 内核浏览器或 Edge
2. 下载油猴应用（Tampermonkey）
3. 打开油猴插件，新建脚本，将 `scripts.user.js` 中的所有内容复制到编辑器中并保存
4. 进入“青书学堂” → 选择一门课程 → 进入视频播放页面
5. 脚本会自动运行，请勿关闭页面

> **注意**：需要开启开发者模式，并允许用户脚本。

## 尝试点击安装？
> 需要先安装 Tampermonkey 插件

[点击这里安装脚本](https://raw.githubusercontent.com/xiangshangya/qingshuketang/main/script.user.js)

---

## 更新日志

### v1.0
- 青书学堂自动刷课
- 最高支持视频 16 倍速调节

### v1.1
- 新增非视频等待 3 秒自动跳转下一节
- 最后一节返回第一节循环播放，并显示循环次数

> 基本上够用了，开四个窗口挂着就行，不需要手动操作。

`scripts.user.js`和`scripts.js`没有任何不同，`scripts.user.js`仅仅是为了实现点击自动安装而复制改了文件名
