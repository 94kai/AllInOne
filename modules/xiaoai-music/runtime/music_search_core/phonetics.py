from __future__ import annotations

from functools import lru_cache
import logging
import re
import unicodedata

try:
    from pypinyin import lazy_pinyin, load_phrases_dict
except ImportError:
    lazy_pinyin = None
    logging.getLogger(__name__).warning(
        "未安装 pypinyin，语音同音字匹配不可用；请按 README 安装小爱音乐依赖，文字搜索仍可用"
    )


if lazy_pinyin is not None:
    # 专辑专名采用“停泊”的读音，避免通用词典默认将“泊”读作 po。
    load_phrases_dict({"安泊猜想": [["ān"], ["bó"], ["cāi"], ["xiǎng"]]})


PINYIN_VERSION = 2


@lru_cache(maxsize=16384)
def phonetic_key(text: str) -> str:
    if lazy_pinyin is None:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    # 空格保留音节边界，避免把“西安”的 xi an 误当成“先”的 xian。
    tokens = lazy_pinyin(text, errors=lambda value: re.findall(r"[^\W_]+", value))
    return " ".join(tokens)


def has_chinese(text: str) -> bool:
    return any("\u3400" <= char <= "\u9fff" or "\U00020000" <= char <= "\U000323af" for char in text)
