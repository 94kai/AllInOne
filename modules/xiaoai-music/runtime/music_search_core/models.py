from __future__ import annotations

from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import replace
import os
import re

from music_search_core.phonetics import PINYIN_VERSION, lazy_pinyin, phonetic_key


@dataclass(frozen=True)
class SongMetadata:
    title: str = ""
    artist: str = ""
    album: str = ""


@dataclass(frozen=True)
class IndexedSong:
    path: str
    name_lower: str
    title_lower: str = ""
    artist_lower: str = ""
    album_lower: str = ""
    size: int = 0
    mtime_ns: int = 0
    name_pinyin: str = ""
    title_pinyin: str = ""
    artist_pinyin: str = ""
    album_pinyin: str = ""
    pinyin_version: int = 0

    @property
    def search_album(self) -> str:
        # 仅在标签缺失时用直接父目录兜底，不改写文件中的专辑标签。
        return self.album_lower.strip() or os.path.basename(os.path.dirname(self.path)).lower()

    def with_pinyin(self) -> "IndexedSong":
        if self.pinyin_version == PINYIN_VERSION or lazy_pinyin is None:
            return self
        name = os.path.splitext(self.name_lower)[0]
        name = re.sub(r"^\d+[\s._-]+", "", name)
        return replace(
            self,
            name_pinyin=phonetic_key(name),
            title_pinyin=phonetic_key(self.title_lower),
            artist_pinyin=phonetic_key(self.artist_lower),
            album_pinyin=phonetic_key(self.search_album),
            pinyin_version=PINYIN_VERSION,
        )

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict) -> "IndexedSong":
        size = data.get("size", 0)
        mtime_ns = data.get("mtime_ns", 0)
        try:
            size = int(size)
        except Exception:
            size = 0
        try:
            mtime_ns = int(mtime_ns)
        except Exception:
            mtime_ns = 0
        return IndexedSong(
            path=str(data.get("path", "")),
            name_lower=str(data.get("name_lower", "")),
            title_lower=str(data.get("title_lower", "")),
            artist_lower=str(data.get("artist_lower", "")),
            album_lower=str(data.get("album_lower", "")),
            size=size,
            mtime_ns=mtime_ns,
            name_pinyin=str(data.get("name_pinyin") or ""),
            title_pinyin=str(data.get("title_pinyin") or ""),
            artist_pinyin=str(data.get("artist_pinyin") or ""),
            album_pinyin=str(data.get("album_pinyin") or ""),
            pinyin_version=data.get("pinyin_version", 0),
        ).with_pinyin()
