---
kind: upgrade-guide
description: "New Web and Desktop profiles enable voice input and download local recognition models automatically."
---

# Automatic voice preparation

English | [中文](guide.zh.md)

## Change

New Web and Desktop profiles select the voice-input bundle. Its SenseVoice provider sets `autoPrepare: true`, downloading missing model files and loading the recognizer in the background at startup. Verified caches are reused. A failed or cancelled preparation requires an explicit retry in the bundle details. Existing profile bundle selections remain unchanged.

## Migration

1. On existing profiles, enable Voice Input in Plugins to use automatic preparation.
2. To retain manual preparation, override the `speech-to-text-sensevoice` row in the profile's `cordis.patch.yml` with the complete provider config, including `autoPrepare: false` and the existing absolute `dataRoot`. Config overrides replace the whole config.
3. Restart the application and check preparation status in Voice Input details. When ready, click the microphone and grant microphone access before recording.
