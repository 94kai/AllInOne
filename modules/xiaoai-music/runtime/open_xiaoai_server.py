"""open-xiaoai 的轻量 WebSocket/RPC 服务端，无第三方依赖。"""
import asyncio
import base64
import hashlib
import json
import os
import struct
import uuid


_callbacks = {}
_pending = {}
_connections = set()
_active_writer = None


def register_fn(key, function):
    _callbacks[key] = function


def unregister_fn(key):
    _callbacks.pop(key, None)


def is_connected():
    return bool(_active_writer and not _active_writer.is_closing())


async def _read_frame(reader):
    header = await reader.readexactly(2)
    first, second = header
    fin = bool(first & 0x80)
    opcode = first & 0x0F
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    if length > 16 * 1024 * 1024:
        raise ValueError("WebSocket 消息超过 16 MB")
    mask = await reader.readexactly(4) if second & 0x80 else None
    payload = await reader.readexactly(length)
    if mask:
        payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    return fin, opcode, payload


async def _write_frame(writer, opcode, payload=b""):
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    length = len(payload)
    header = bytes([0x80 | opcode])
    if length < 126:
        header += bytes([length])
    elif length <= 65535:
        header += bytes([126]) + struct.pack("!H", length)
    else:
        header += bytes([127]) + struct.pack("!Q", length)
    writer.write(header + payload)
    await writer.drain()


async def _handshake(reader, writer):
    raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
    if len(raw) > 16 * 1024:
        raise ValueError("WebSocket 握手内容过大")
    lines = raw.decode("latin1").split("\r\n")
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            name, value = line.split(":", 1)
            headers[name.strip().lower()] = value.strip()
    key = headers.get("sec-websocket-key")
    if not key:
        raise ValueError("缺少 WebSocket Key")
    accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").encode("ascii"))
    await writer.drain()


async def _send_message(kind, data):
    if _active_writer is None or _active_writer.is_closing():
        raise RuntimeError("小爱音箱尚未连接")
    await _write_frame(_active_writer, 0x1, json.dumps({kind: data}, ensure_ascii=False, separators=(",", ":")))


async def _handle_text(text):
    message = json.loads(text)
    if "Response" in message:
        response = message["Response"]
        future = _pending.pop(str(response.get("id", "")), None)
        if future and not future.done():
            future.set_result(response)
        return
    if "Event" in message:
        callback = _callbacks.get("on_event")
        if callback:
            callback(json.dumps(message["Event"], ensure_ascii=False))
        return
    if "Request" in message:
        request = message["Request"]
        response = {"id": request.get("id", "0")}
        if request.get("command") == "get_version":
            response["data"] = "1.0.0"
        else:
            response.update({"code": -1, "msg": "command not found"})
        await _send_message("Response", response)


async def _handle_connection(reader, writer):
    global _active_writer
    _connections.add(writer)
    try:
        await _handshake(reader, writer)
        if _active_writer and _active_writer is not writer:
            _active_writer.close()
        _active_writer = writer
        print("✅ 小爱音箱已连接", flush=True)
        fragments = bytearray()
        fragment_opcode = None
        while True:
            fin, opcode, payload = await _read_frame(reader)
            if opcode == 0x8:
                break
            if opcode == 0x9:
                await _write_frame(writer, 0xA, payload)
                continue
            if opcode in (0x1, 0x2):
                fragment_opcode = opcode
                fragments = bytearray(payload)
            elif opcode == 0x0 and fragment_opcode:
                fragments.extend(payload)
            else:
                continue
            if not fin:
                continue
            if fragment_opcode == 0x1:
                await _handle_text(fragments.decode("utf-8"))
            fragment_opcode = None
            fragments.clear()
    except (asyncio.IncompleteReadError, ConnectionError, asyncio.CancelledError):
        pass
    except Exception as exc:
        print(f"小爱连接处理异常: {exc}", flush=True)
    finally:
        if _active_writer is writer:
            _active_writer = None
        _connections.discard(writer)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        print("小爱音箱已断开", flush=True)


async def _run_server():
    port = int(os.environ.get("XIAOAI_WS_PORT", "4399"))
    server = await asyncio.start_server(_handle_connection, "0.0.0.0", port)
    print(f"✅ 小爱监听已启动: 0.0.0.0:{port}", flush=True)
    try:
        async with server:
            await server.serve_forever()
    finally:
        server.close()
        await server.wait_closed()
        for writer in list(_connections):
            writer.close()
        _connections.clear()


def start_server():
    return asyncio.create_task(_run_server())


async def run_shell(script, timeout_millis=10000):
    request_id = str(uuid.uuid4())
    future = asyncio.get_running_loop().create_future()
    _pending[request_id] = future
    await _send_message("Request", {"id": request_id, "command": "run_shell", "payload": script})
    try:
        response = await asyncio.wait_for(future, timeout=max(float(timeout_millis) / 1000, 0.1))
    finally:
        _pending.pop(request_id, None)
    if response.get("code") not in (None, 0):
        return json.dumps({"error": response.get("msg") or "run_shell error"}, ensure_ascii=False)
    return json.dumps(response.get("data"), ensure_ascii=False)
