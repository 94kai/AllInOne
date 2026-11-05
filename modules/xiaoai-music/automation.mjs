import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const phraseKey = value => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '');
export class MusicAutomation {
  constructor(owner) {
    this.owner = owner;
    this.file = path.join(owner.dataDir, 'automation.json');
    this.data = { revision: '', playlists: [], rules: [] };
    this.writes = Promise.resolve();
  }
  async initialize() {
    try { this.data = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') { this.error = '自动播放配置读取失败，请检查 automation.json'; console.error(this.error, error.message); } }
  }
  async update(input) {
    const operation = this.writes.catch(() => {}).then(async () => {
      if (this.error) throw Object.assign(new Error(this.error), { status: 503 });
      if (!input || typeof input !== 'object') fail('配置格式无效');
      if (input.revision !== this.data.revision) throw Object.assign(new Error('配置已在其他页面修改，请刷新后再保存'), { status: 409 });
      if (!Array.isArray(input.playlists) || input.playlists.length > 30 || !Array.isArray(input.rules) || input.rules.length > 50) fail('最多 30 个歌单、50 条规则');
      const ids = new Set();
      const playlists = input.playlists.map(item => {
        const id = String(item.id || crypto.randomUUID());
        const profile = this.owner.profile(item.profileId);
        const name = String(item.name || '').trim();
        if (!profile || !name || name.length > 40 || ids.has(id) || !/^[\w-]{1,64}$/.test(id)) fail('歌单名称、音箱或标识无效');
        ids.add(id);
        if (!Array.isArray(item.songs) || item.songs.length > 100) fail('每个歌单最多 100 首');
        const songs = []; this.owner.addSongs(songs, item.songs, profile);
        return { id, profileId: profile.id, name, songs };
      });
      const phrases = new Set(), times = new Set(), ruleIds = new Set();
      const rules = input.rules.map(item => {
        const id = String(item.id || crypto.randomUUID());
        const playlist = playlists.find(list => list.id === item.playlistId);
        const time = String(item.time || '');
        const phrase = String(item.phrase || '').trim();
        const repeat = Number(item.repeat ?? 1);
        if (!playlist || playlist.profileId !== item.profileId || !/^[\w-]{1,64}$/.test(id) || ruleIds.has(id)) fail('规则音箱与歌单不匹配');
        ruleIds.add(id);
        if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('时间格式应为 HH:mm');
        if ((!time && !phrase) || phrase.length > 80 || (phrase && !phraseKey(phrase)) || !Number.isInteger(repeat) || repeat < 1 || repeat > 20) fail('请填写每日时间或提示词，循环轮数为 1–20');
        const profile = this.owner.profile(item.profileId);
        if (phrase && [...profile.stopKeywords, ...profile.refreshKeywords, ...profile.randomKeywords].some(word => phraseKey(word) === phraseKey(phrase))) fail('提示词不能与停止、刷新或随机播放指令重复');
        const enabled = item.enabled !== false;
        if (enabled && !playlist.songs.length) fail('启用规则前请向歌单添加歌曲');
        for (const [value, seen] of [[phrase && phraseKey(phrase), phrases], [time, times]]) {
          const key = `${item.profileId}:${value}`;
          if (enabled && value && seen.has(key)) fail('同一音箱不能配置重复的启用时间或提示词');
          if (enabled && value) seen.add(key);
        }
        return { id, profileId: playlist.profileId, playlistId: playlist.id, enabled, time, phrase, repeat };
      });
      const next = { revision: crypto.randomUUID(), playlists, rules };
      await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2), 'utf8');
      await rename(`${this.file}.tmp`, this.file); this.data = next;
      return next;
    });
    this.writes = operation; return operation;
  }
}
