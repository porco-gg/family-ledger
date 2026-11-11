# 家庭账本

给家里两个人用的记账 PWA。首页只有一个大数字：**这个月共同池还能花多少**。

- 打开：https://porco-gg.github.io/family-ledger/
- 数据存在一个**私有**仓库里，这个仓库只放代码
- 前后端都没有服务器：静态页面由 GitHub Pages 托管，数据读写走 GitHub API

## 自己部署

1. 建一个公开仓库放这些文件，Settings → Pages → Deploy from a branch → main /(root)
2. 建一个私有仓库放数据（config.json + tx/年份.json）
3. 创建一个只给数据仓库 Contents 读写权限的 fine-grained token
4. 打开页面，填用户名、数据仓库名、token，选「我是谁」，连接

## 本地开发

    node serve.mjs      # http://localhost:8787

无构建、无依赖，改完刷新就生效。
