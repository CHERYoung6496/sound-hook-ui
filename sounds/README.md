# 音效目录说明

## `starter/` —— 内置启动音效

`sounds/starter/` 下的 6 个 WAV 文件（`start-chime`、`input-blip`、`done-fanfare`、`question-ding`、`end-chime`、`error-buzz`）是用 ffmpeg 程序合成的**原创音效**（正弦波叠加 + 淡入淡出），不含任何第三方素材，与代码一样以 MIT 许可证发布，可随意使用、修改、再分发。

## 如何添加自己的音效

1. 在 `sounds/` 下新建一个目录作为专辑，例如 `sounds/MyPack/`。
2. 把 `.wav` 文件放进去（建议 44.1kHz 16bit，时长几秒以内）。
3. 双击 `音效管理.bat`（或 `sound-manager.bat`）打开管理器，点击事件卡片上的「＋ 添加音效」，在对应专辑中挑选即可。

> 只有 `.wav` 文件能被播放（Windows `SoundPlayer` 只支持 WAV）。mp3 等其他格式请先用 ffmpeg 转码：
>
> ```
> ffmpeg -i input.mp3 -ar 44100 -ac 2 -c:a pcm_s16le output.wav
> ```

## 版权注意

- 从素材网站（効果音ラボ、Mixkit、Pixabay 等）下载的音效归各自作者/站点所有，请遵守其许可条款。
- 尤其注意：効果音ラボ的素材**禁止再分发**——请勿把下载的素材提交进 git 或上传公开仓库（本仓库的 `.gitignore` 已默认排除 `sounds/Anime/`）。
