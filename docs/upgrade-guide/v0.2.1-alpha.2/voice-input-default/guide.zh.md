---
kind: upgrade-guide
description: "新建 Web 和桌面 Profile 默认启用语音输入并自动下载本地识别模型。"
---

# 自动准备语音模型

[English](guide.md) | 中文

## 变更

新建 Web 和桌面 Profile 默认选择语音输入 Bundle。其 SenseVoice Provider 设置 `autoPrepare: true`，启动时在后台下载缺失模型并加载识别器，复用已校验缓存。准备失败或取消后，需要在 Bundle 详情中手动重试。已有 Profile 的 Bundle 选择保持不变。

## 迁移

1. 已有 Profile 可在插件管理中启用“语音输入”，使用自动准备。
2. 如需保留手动准备，在 Profile 的 `cordis.patch.yml` 中覆盖 `speech-to-text-sensevoice` 条目，提供完整 Provider 配置，包含 `autoPrepare: false` 和原有绝对路径 `dataRoot`。配置覆盖会替换整个 config。
3. 重启应用，在语音输入详情中检查准备状态。就绪后点击麦克风并授予权限，再开始录音。
