"""将现有 open-xiaoai 设备驱动接入 Allinone 管理接口。"""
import argparse
import asyncio
import json
import os
import signal
import sys
import threading
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


def load_config(path):
    with open(path, "r", encoding="utf-8") as file_obj:
        return json.load(file_obj)


parser = argparse.ArgumentParser()
parser.add_argument("--config", required=True)
args = parser.parse_args()
PROFILE = load_config(args.config)

# 音乐核心和小爱协议实现均来自当前模块，不依赖外部项目目录。
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "runtime"))
os.environ["XIAOAI_WS_PORT"] = str(PROFILE["ws_port"])
config_module = types.ModuleType("config")
config_module.MUSIC_CONFIG = PROFILE["music"]
sys.modules["config"] = config_module

import open_xiaoai_server  # noqa: E402
from main import App, on_event_callback  # noqa: E402
from player_control import set_volume  # noqa: E402


class Runtime:
    loop = None
    listener_task = None
    listener_enabled = False
    api_server = None
    stopping = False

    @classmethod
    async def set_listener(cls, enabled):
        cls.listener_enabled = bool(enabled)
        if cls.listener_enabled:
            open_xiaoai_server.register_fn("on_event", on_event_callback)
        else:
            open_xiaoai_server.unregister_fn("on_event")
        # 播放、暂停和音量控制也复用这条 WebSocket，因此关闭语音识别时仍保持连接。
        if not cls.listener_task or cls.listener_task.done():
            cls.listener_task = open_xiaoai_server.start_server()

    @classmethod
    async def stop_connection(cls):
        if cls.listener_task:
            cls.listener_task.cancel()
            try:
                await cls.listener_task
            except asyncio.CancelledError:
                pass
            cls.listener_task = None

    @classmethod
    def status(cls):
        current = App.current_song
        queue = []
        if current:
            queue.append({"name": current.name, "path": current.path, "durationSec": current.duration_sec, "current": True})
        queue.extend({"name": song.name, "path": song.path, "durationSec": song.duration_sec, "current": False} for song in App.play_queue[:99])
        return {
            "id": PROFILE["id"],
            "name": PROFILE["name"],
            "listenerEnabled": cls.listener_enabled,
            "speakerConnected": open_xiaoai_server.is_connected(),
            "librarySize": App.searcher.index_size(),
            "refreshing": App.index_refresh_lock.locked(),
            "currentSong": current.name if current else None,
            "queueSize": len(App.play_queue),
            "queue": queue,
            "wsPort": PROFILE["ws_port"],
            "httpPort": PROFILE["music"]["http"]["port"],
        }

    @classmethod
    def search(cls, keyword):
        key = keyword.strip().lower()
        if not key:
            return []
        with App.searcher._lock:
            songs = App.searcher._songs[:]
        result = []
        for song in songs:
            if key not in (song.name_lower, song.title_lower, song.artist_lower, song.album_lower) and not any(
                key in value for value in (song.name_lower, song.title_lower, song.artist_lower, song.album_lower)
            ):
                continue
            result.append({
                "path": song.path,
                "name": os.path.basename(song.path),
                "title": song.title_lower,
                "artist": song.artist_lower,
                "album": song.album_lower,
                "size": song.size,
            })
            if len(result) >= 100:
                break
        return result

    @classmethod
    async def play_path(cls, path, repeat=1):
        with App.searcher._lock:
            allowed = any(song.path == path for song in App.searcher._songs)
        if not allowed:
            raise ValueError("歌曲不在当前曲库索引中")
        songs = await asyncio.to_thread(App._build_song_items, [path], App.music_server)
        if not songs:
            raise ValueError("无法读取歌曲时长")
        repeat = max(1, min(20, int(repeat)))
        songs *= repeat
        await App.clear_queue(stop_device=True)
        async with App.local_music_lock:
            App.play_queue = songs
            first_song = App.play_queue.pop(0)
            await App._start_song_unlocked(first_song, trigger="网页播放")

    @classmethod
    async def play_paths(cls, paths, repeat=1):
        clean_paths = list(dict.fromkeys(str(item) for item in paths if str(item)))[:500]
        if not clean_paths:
            raise ValueError("播放列表不能为空")
        with App.searcher._lock:
            allowed = {song.path for song in App.searcher._songs}
        if any(item not in allowed for item in clean_paths):
            raise ValueError("播放列表包含不在当前曲库中的歌曲")
        songs = await asyncio.to_thread(App._build_song_items, clean_paths, App.music_server)
        if not songs:
            raise ValueError("播放列表中没有可播放的歌曲")
        repeat = max(1, min(20, int(repeat)))
        if len(songs) * repeat > 2000:
            raise ValueError("循环后的播放队列不能超过 2000 首")
        songs *= repeat
        await App.clear_queue(stop_device=True)
        async with App.local_music_lock:
            App.play_queue = songs
            first_song = App.play_queue.pop(0)
            await App._start_song_unlocked(first_song, trigger="网页播放列表")

    @classmethod
    async def jump_queue(cls, index):
        position = int(index)
        async with App.local_music_lock:
            queue = ([App.current_song] if App.current_song else []) + list(App.play_queue)
            if position < 0 or position >= len(queue):
                raise ValueError("待播歌曲位置无效")
            if position == 0 and App.current_song:
                return
            target = queue[position]
            await App._cancel_timer_unlocked()
            App.play_queue = queue[position + 1:]
            await App._start_song_unlocked(target, trigger="网页队列切歌")


def run_async(coro, timeout=120):
    future = asyncio.run_coroutine_threadsafe(coro, Runtime.loop)
    return future.result(timeout=timeout)


class ApiHandler(BaseHTTPRequestHandler):
    def send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size > 64 * 1024:
            raise ValueError("请求内容过大")
        return json.loads(self.rfile.read(size) or b"{}")

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/status":
                return self.send_json(200, Runtime.status())
            if parsed.path == "/search":
                keyword = parse_qs(parsed.query).get("q", [""])[0]
                return self.send_json(200, {"items": Runtime.search(keyword)})
            self.send_json(404, {"error": "接口不存在"})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def do_POST(self):
        try:
            body = self.read_json()
            if self.path == "/play":
                run_async(Runtime.play_path(str(body.get("path", "")), body.get("repeat", 1)))
            elif self.path == "/queue/play":
                run_async(Runtime.play_paths(body.get("paths", []), body.get("repeat", 1)))
            elif self.path == "/queue/jump":
                run_async(Runtime.jump_queue(body.get("index", -1)))
            elif self.path == "/play-search":
                run_async(App.play_local_music_by_keyword(str(body.get("keyword", "")).strip()))
            elif self.path == "/random":
                run_async(App.play_random_music(body.get("repeat", 1)))
            elif self.path == "/stop":
                run_async(App.stop_music())
            elif self.path == "/refresh":
                total, cost_ms = run_async(App.refresh_music_index("网页刷新"), 600)
                return self.send_json(200, {"success": True, "total": total, "costMs": cost_ms})
            elif self.path == "/listener":
                run_async(Runtime.set_listener(bool(body.get("enabled"))))
            elif self.path == "/volume":
                volume = max(0, min(100, int(body.get("volume", 0))))
                run_async(set_volume(volume))
                return self.send_json(200, {"success": True, "volume": volume})
            elif self.path == "/speak":
                text = str(body.get("text", "")).strip()
                if not text:
                    raise ValueError("请输入要播报的文字")
                if len(text) > 500:
                    raise ValueError("播报文字不能超过 500 个字符")
                if any(ord(char) < 32 and char not in "\n\r\t" for char in text):
                    raise ValueError("播报文字包含不支持的控制字符")
                run_async(App._speak_text(text), 30)
            else:
                return self.send_json(404, {"error": "接口不存在"})
            self.send_json(200, {"success": True})
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def log_message(self, fmt, *args):
        return


async def main():
    Runtime.loop = asyncio.get_running_loop()
    App.loop = Runtime.loop
    App._ensure_ffprobe_available()
    from music_service import build_music_server
    App.music_server = build_music_server(PROFILE["music"].get("http", {}))
    App.music_server.start()
    Runtime.api_server = ThreadingHTTPServer(("127.0.0.1", PROFILE["api_port"]), ApiHandler)
    threading.Thread(target=Runtime.api_server.serve_forever, daemon=True).start()
    await Runtime.set_listener(PROFILE.get("listener_enabled", True))
    await App.refresh_music_index("启动刷新")
    if App.refresh_interval_sec > 0:
        App.index_refresh_task = asyncio.create_task(App.run_index_refresh_loop())
    stop_event = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        Runtime.loop.add_signal_handler(sig, stop_event.set)
    await stop_event.wait()
    await Runtime.stop_connection()
    if App.index_refresh_task:
        App.index_refresh_task.cancel()
    Runtime.api_server.shutdown()
    App.music_server.stop()


asyncio.run(main())
