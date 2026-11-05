import json

import open_xiaoai_server


def _escape_shell_single_quote(text: str) -> str:
    return text.replace("'", "'\"'\"'")


async def run_shell(script: str, timeout_ms: float = 10_000):
    result = await open_xiaoai_server.run_shell(script, timeout_ms)
    try:
        return json.loads(result)
    except Exception:
        return {"raw": result}


async def speak_text(text: str, resume_previous: bool = True):
    if not resume_previous:
        payload = _escape_shell_single_quote(json.dumps({"text": text, "save": 1}, ensure_ascii=False))
        # 只合成并播放本次提示，不执行固件 tts_play.sh 末尾的 mphelper play。
        script = """. /usr/share/libubox/jshn.sh
aio_tts_result=$(ubus call mibrain text_to_speech 'PAYLOAD') || exit 1
json_load "$aio_tts_result" || exit 1
json_get_var aio_tts_info info
json_load "$aio_tts_info" || exit 1
json_get_var aio_tts_path path
case "$aio_tts_path" in /tmp/tts/*) ;; *) exit 1 ;; esac
[ -f "$aio_tts_path" ] || exit 1
miplayer -f "$aio_tts_path"
aio_tts_code=$?
rm -f -- "$aio_tts_path"
exit "$aio_tts_code"
""".replace("PAYLOAD", payload)
        result = await run_shell(script, 30000)
        if not isinstance(result, dict) or result.get("error") or result.get("exit_code") != 0:
            raise RuntimeError("本地提示播报失败或被打断")
        return result
    escaped = _escape_shell_single_quote(text)
    script = f"/usr/sbin/tts_play.sh '{escaped}'"
    return await run_shell(script)


async def ask_xiaoai(text: str):
    payload = {"tts": 1, "nlp": 1, "nlp_text": text}
    script = f"ubus call mibrain ai_service '{json.dumps(payload, ensure_ascii=False)}'"
    return await run_shell(script)


async def play_music_url(url: str):
    payload = {"url": url, "type": 1}
    script = f"ubus call mediaplayer player_play_url '{json.dumps(payload)}'"
    return await run_shell(script)


async def stop_playback():
    return await run_shell("mphelper pause")


async def stop_cloud_music():
    # 接管本地音乐前停止云端歌曲；返回成功不代表云端语音播报已结束。
    result = await run_shell("ubus -t 3 call mediaplayer player_play_operation '{\"action\":\"stop\"}'", 5000)
    if not isinstance(result, dict) or result.get("error") or result.get("exit_code") != 0:
        raise RuntimeError("云端音乐停止指令执行失败")
    try:
        reply = json.loads(result.get("stdout", ""))
    except (ValueError, TypeError) as exc:
        raise RuntimeError("云端音乐停止指令返回格式异常") from exc
    if not isinstance(reply, dict) or reply.get("code") != 0:
        raise RuntimeError("播放器拒绝云端音乐停止指令")
    return result


async def set_volume(volume: int):
    value = max(0, min(100, int(volume)))
    payload = json.dumps({"volume": value})
    return await run_shell(f"ubus call mediaplayer player_set_volume '{payload}'")
