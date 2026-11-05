"""每台音箱独立执行定时与语音歌单规则，配置由模块管理接口原子保存。"""
import asyncio
import json
import logging
import os
import time
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)


def phrase_key(value):
    return ''.join(char for char in unicodedata.normalize('NFKC', value).lower()
                   if not char.isspace() and not unicodedata.category(char).startswith('P'))


class Automation:
    def __init__(self, profile, play, connected, arm, prepare_voice):
        self.profile = profile
        self.play = play
        self.connected = connected
        self.arm = arm
        self.prepare_voice = prepare_voice
        self.state = {'dates': {}, 'last': None}
        self.error = ''
        self.lock = asyncio.Lock()
        self.voice_times = {}
        self.tasks = set()
        self.timer = None
        try:
            with open(profile['automation_state_file'], encoding='utf-8') as handle:
                self.state = json.load(handle)
        except FileNotFoundError:
            pass
        except Exception as exc:
            self.error = '执行记录读取失败，自动播放已停用：' + str(exc)

    def config(self):
        try:
            with open(self.profile['automation_file'], encoding='utf-8') as handle:
                return json.load(handle)
        except FileNotFoundError:
            return {'rules': [], 'playlists': []}

    def save_state(self):
        filename = self.profile['automation_state_file']
        with open(filename + '.tmp', 'w', encoding='utf-8') as handle:
            json.dump(self.state, handle, ensure_ascii=False)
        os.replace(filename + '.tmp', filename)

    def status(self):
        return {'last': self.state.get('last'), 'error': self.error, 'timezone': 'Asia/Shanghai'}

    async def execute(self, rule, playlist, trigger, date=None):
        async with self.lock:
            if date and self.state['dates'].get(rule['id']) == date:
                return
            if date:
                self.state['dates'][rule['id']] = date
            self.state['last'] = {'ruleId': rule['id'], 'playlist': playlist['name'], 'trigger': trigger,
                                  'at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(), 'status': 'running', 'error': ''}
            try:
                # 播放前持久化当日标记，避免重启后在同一分钟重复触发。
                await asyncio.to_thread(self.save_state)
                if not self.connected():
                    raise ValueError('音箱未连接，本次未播放')
                if trigger == 'voice':
                    self.arm('语音歌单:' + playlist['name'])
                    await self.prepare_voice()
                await self.play([song['path'] for song in playlist['songs']], rule['repeat'])
                self.state['last']['status'] = 'success'
                logger.info('自动歌单播放请求已发送: 方式=%s 歌单=%s', trigger, playlist['name'])
            except Exception as exc:
                self.state['last']['status'] = 'failed'
                self.state['last']['error'] = str(exc)
                logger.error('自动播放失败: %s', exc)
            try:
                await asyncio.to_thread(self.save_state)
            except Exception as exc:
                self.error = '执行记录保存失败：' + str(exc)
                logger.error(self.error)

    async def voice(self, text):
        if self.error:
            return False
        try:
            config = await asyncio.to_thread(self.config)
            for rule in config['rules']:
                if rule['profileId'] != self.profile['id'] or not rule['enabled'] or not rule['phrase']:
                    continue
                if phrase_key(text) != phrase_key(rule['phrase']):
                    continue
                playlist = next((item for item in config['playlists'] if item['id'] == rule['playlistId']), None)
                if not playlist:
                    return False
                now = time.monotonic()
                if now - self.voice_times.get(rule['id'], -100) < 1:
                    logger.info('忽略1秒内重复的语音歌单事件')
                    return True
                self.voice_times[rule['id']] = now
                logger.info('语音歌单匹配成功: 提示词=%s 歌单=%s', rule['phrase'], playlist['name'])
                task = asyncio.create_task(self.execute(rule, playlist, 'voice'))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)
                return True
        except Exception as exc:
            logger.error('语音歌单配置读取失败：%s', exc)
        return False

    async def run(self):
        while True:
            try:
                if not self.error:
                    config = await asyncio.to_thread(self.config)
                    now = datetime.now(ZoneInfo('Asia/Shanghai'))
                    for rule in config['rules']:
                        if rule['profileId'] != self.profile['id'] or not rule['enabled'] or rule['time'] != now.strftime('%H:%M'):
                            continue
                        playlist = next((item for item in config['playlists'] if item['id'] == rule['playlistId']), None)
                        if playlist:
                            await self.execute(rule, playlist, 'schedule', now.strftime('%Y-%m-%d'))
            except Exception as exc:
                logger.error('定时播放检查失败：%s', exc)
                self.state['last'] = {'status': 'failed', 'error': str(exc), 'at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat()}
            await asyncio.sleep(5)

    async def stop(self):
        for task in [self.timer, *self.tasks]:
            if task:
                task.cancel()
        await asyncio.gather(*([self.timer] if self.timer else []), *self.tasks, return_exceptions=True)
