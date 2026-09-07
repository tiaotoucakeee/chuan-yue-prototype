# 穿·越 · 越剧文化 H5 原型

浙江省清越剧团「穿·越」移动端 H5 原型：探索、大师、市集、宝藏、AI 实验室、小三嬝数字人对话、3D 数字展览馆。

## 本地运行

1. 安装 [Node.js](https://nodejs.org)
2. 双击 **`启动穿·越.bat`**（或手动）：
   - 静态页：`npx serve . -p 3456` → http://localhost:3456
   - Kimi 代理：`cd kimi-proxy && npm install && npm start` → http://localhost:8787
3. **不要**双击 `index.html`（`file://` 无法加载 Unity / 视频）

### 大资源（需本地自备，不进 Git）

| 目录 | 说明 |
|------|------|
| `museum/` | Unity WebGL 3D 展馆（约 300MB） |
| `assets/videos/` | 独家授权视频素材 |
| `game-museum/` | 旧打包目录，可删，以 `museum/` 为准 |

从 zip 解压后放进对应目录即可本地体验。

### Kimi 对话

复制 `kimi-proxy/.env.example` → `kimi-proxy/.env`，填入 `KIMI_API_KEY`。  
模型默认 `kimi-k2.6`（见 `.env`）。

## 线上部署（推荐）

| 部分 | 托管方式 |
|------|----------|
| 页面代码 | **GitHub Pages**（本仓库） |
| 3D 展馆 + 大视频 | **OSS / CDN**（阿里云、Cloudflare R2 等） |
| 小三嬝对话 | **Render** 部署 `kimi-proxy` |

1. 将 `museum/`、`assets/videos/` 上传到 OSS  
2. 在 `assets-config.js` 填写 `cdnBase`  
3. Render 新建 Web Service，Root Directory：`kimi-proxy`，环境变量 `KIMI_API_KEY`  
4. GitHub Pages 开启：Settings → Pages → Source: GitHub Actions  

## 协作

- 代码、JSON、小图片：直接 PR / push  
- 大文件：上传 OSS 后改 `assets-config.js` 或 `data/treasure-items.json` 中的 URL  
- **切勿**提交 `.env` 或 API Key  

## 仓库结构

```
figma-mobile-prototype/
├── index.html          # 主页面
├── data/               # 宝藏 JSON + file:// 备用 JS
├── assets/             # 图片等小资源
├── assets-config.js    # CDN 根地址
├── museum/             # （本地/OSS）Unity 展馆
├── kimi-proxy/         # Kimi API 代理
├── 启动穿·越.bat
└── README.md
```
