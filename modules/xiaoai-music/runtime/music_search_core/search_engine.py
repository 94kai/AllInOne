from __future__ import annotations

import random

from music_search_core.models import IndexedSong
from music_search_core.phonetics import has_chinese, phonetic_key


class MusicSearchEngine:
    def search_phonetic_with_count(self, songs: list[IndexedSong], keyword: str, limit: int) -> tuple[int, list[str]]:
        if not has_chinese(keyword):
            return 0, []
        key = phonetic_key(keyword)
        if not key:
            return 0, []
        groups: list[list[str]] = [[], [], [], [], [], []]
        for song in songs:
            names = (song.title_pinyin, song.name_pinyin)
            if key in names:
                rank = 0
            elif any(f" {key} " in f" {name} " for name in names):
                rank = 1
            elif key == song.artist_pinyin:
                rank = 2
            elif f" {key} " in f" {song.artist_pinyin} ":
                rank = 3
            elif key == song.album_pinyin:
                rank = 4
            elif f" {key} " in f" {song.album_pinyin} ":
                rank = 5
            else:
                continue
            groups[rank].append(song.path)
        for group in groups:
            random.shuffle(group)
        matched = [path for group in groups for path in group]
        return len(matched), matched[:max(0, limit)]

    def search_with_count(self, songs: list[IndexedSong], keyword_lower: str, limit: int) -> tuple[int, list[str]]:
        if not keyword_lower:
            return 0, []
        if limit <= 0:
            total = sum(1 for song in songs if self._is_match(song, keyword_lower))
            return total, []
        matched = []
        for song in songs:
            if self._is_match(song, keyword_lower):
                matched.append(song.path)
        total = len(matched)
        random.shuffle(matched)
        return total, matched[:limit]

    def search(self, songs: list[IndexedSong], keyword_lower: str, limit: int) -> list[str]:
        _, selected = self.search_with_count(songs, keyword_lower, limit)
        return selected

    def random_pick(self, songs: list[IndexedSong], limit: int) -> list[str]:
        if limit <= 0 or not songs:
            return []
        paths = [item.path for item in songs]
        random.shuffle(paths)
        return paths[:limit]

    def _is_match(self, song: IndexedSong, keyword_lower: str) -> bool:
        return (
            keyword_lower in song.name_lower
            or keyword_lower in song.title_lower
            or keyword_lower in song.artist_lower
            or keyword_lower in song.search_album
        )
