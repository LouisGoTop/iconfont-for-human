# iconfont-for-human README

[![版本](https://img.shields.io/badge/version-0.0.1-blue.svg)](https://marketplace.visualstudio.com/items?itemName=your-publisher-id.iconfont-for-human) <!-- 请替换 your-publisher-id -->

让你的 Iconfont 图标在 VS Code 中变得生动起来！ `iconfont-for-human` 旨在增强使用 [iconfont.cn](https://www.iconfont.cn/) 项目时的开发体验。

## 主要功能 ✨

本插件会自动检测你项目中的 `iconfont.css` 和 `iconfont.js` 文件，并提供以下实用功能：

1.  **CSS 图标预览 (Gutter):**
    *   在 CSS、SCSS、Less、Stylus 文件中，当你定义 `content` 属性时，会在行号旁边（Gutter 区域）显示对应图标的 SVG 预览。
    *   ![CSS Gutter 预览](placeholder.png) <!-- 建议替换为实际截图 -->

2.  **代码内联图标预览:**
    *   在 JavaScript (.js, .jsx)、TypeScript (.ts, .tsx) 和 HTML 文件中：
        *   直接渲染 `name="icon-xxx"` (或其他前缀如 `1-`、`1.5-`) 属性值旁边的图标。
        *   直接渲染 `&#xe600;` 这样的 HTML 实体字符旁边的图标。
    *   ![内联图标预览](placeholder.png) <!-- 建议替换为实际截图 -->

3.  **丰富的悬停提示:**
    *   当鼠标悬停在代码中的内联图标（`name="icon-xxx"` 或 `&#xeabc;`）上时：
        *   显示一个**更大**的图标预览图。
        *   展示图标的名称 (`icon-xxx`) 和对应的 HTML 实体代码 (`&#xeabc;`)。
        *   提供**一键复制**命令：
            *   🚀 复制图标名称
            *   🚀 复制 React/Vue 组件代码片段 (`<Icon name="icon-xxx" />`)
            *   ~~复制 HTML 实体 Code~~ (即将废弃)
        *   提供**一键转换**命令 (当悬停在 HTML 实体上时):
            *   🚀🚀 **一键转换组件 name**: 将 `code="&#xeabc;"` 替换为 `name="icon-xxx"`。
            *   🚀🚀🚀 **一键转换为 Icon 组件**: 将 `&#xeabc;` 替换为 `<Icon name="icon-xxx" />`。
    *   ![悬停提示](placeholder.png) <!-- 建议替换为实际截图 -->

4.  **CSS 右键快捷操作:**
    *   在 CSS 类文件中，右键点击 `content` 属性所在行的行号：
        *   快速复制图标名称 (`icon-xxx`)。
        *   快速复制图标的 HTML 实体 (`&#xeabc;`)。

5.  **字体文件预览器:**
    *   直接在 VS Code 中打开 `.ttf`, `.otf`, `.woff`, `.woff2`, `.eot` 字体文件。
    *   预览器会显示字体包含的所有字形 (Glyph) 及其 Unicode 和名称。
    *   ![字体预览](placeholder.png) <!-- 建议替换为实际截图 -->

6.  **自动更新:**
    *   实时监听 `iconfont.css` 和 `iconfont.js` 文件的变化，自动重新解析并更新预览。
    *   当 VS Code 主题更改时，也会尝试更新图标颜色以适应新主题。

## 使用要求 📋

*   项目中需要包含从 iconfont.cn 下载的 `iconfont.css` 文件。
*   项目中需要包含从 iconfont.cn 下载的 `iconfont.js` 文件 (包含 SVG symbol 定义)。

## 已知问题 🤔

*   暂无

## 发布日志 🚀

### 0.0.1

*   初始版本发布，包含上述主要功能。

---

**请享受使用！ 👍**
