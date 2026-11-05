import json
from pathlib import Path
import unicodedata


RULES = json.loads((Path(__file__).resolve().parent.parent / "stop-commands.json").read_text(encoding="utf-8"))


def command_key(text: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFKC", text).lower()
                   if not char.isspace() and not unicodedata.category(char).startswith("P"))


BUILTIN_COMMANDS = {command_key(text) for text in RULES["commands"]}


def is_stop_command(text: str, custom_keywords=None) -> bool:
    key = command_key(text)
    if not key:
        return False
    custom = {command_key(word) for word in (custom_keywords or [])}
    if key in custom:
        return True
    # 只剥离有限的称呼和语气词，保持整句匹配，避免“关灯”或“播放别放了”误停。
    for _ in range(4):
        if key in BUILTIN_COMMANDS:
            return True
        previous = key
        for prefix in RULES["prefixes"]:
            if key.startswith(prefix):
                key = key[len(prefix):]
                break
        for suffix in RULES["suffixes"]:
            if key.endswith(suffix):
                key = key[:-len(suffix)]
                break
        if key == previous:
            break
    return key in BUILTIN_COMMANDS
