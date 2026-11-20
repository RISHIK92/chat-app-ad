import { useEffect, useMemo, useRef, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getFile } from './api';
import { colors } from './theme';

export function formatDuration(ms: number) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;

  const byteLen = (clean.length * 3) / 4 - padding;
  const bytes = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = lookup[clean.charCodeAt(i + 2)];
    const d = lookup[clean.charCodeAt(i + 3)];
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < byteLen) bytes[p++] = (triple >> 16) & 255;
    if (p < byteLen) bytes[p++] = (triple >> 8) & 255;
    if (p < byteLen) bytes[p++] = triple & 255;
  }
  return bytes;
}

const audioUriCache = new Map<string, string>();

async function resolveAudioUri(fileId: string): Promise<string> {
  const cached = audioUriCache.get(fileId);
  if (cached) return cached;

  const f = await getFile(fileId);
  if (Platform.OS === 'web') {
    const dataUri = `data:${f.mimeType};base64,${f.data}`;
    audioUriCache.set(fileId, dataUri);
    return dataUri;
  }

  const ext = f.mimeType.includes('webm')
    ? 'webm'
    : f.mimeType.includes('mpeg') || f.mimeType.includes('mp3')
      ? 'mp3'
      : f.mimeType.includes('wav')
        ? 'wav'
        : 'm4a';
  const dest = new File(Paths.cache, `voice-${fileId}.${ext}`);
  if (!dest.exists) {
    dest.create({ intermediates: true, overwrite: true });
    await dest.write(base64ToBytes(f.data));
  }
  audioUriCache.set(fileId, dest.uri);
  return dest.uri;
}

function defaultWaveform(seed: string, count = 24): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (i + 1), 16777619);
    const norm = ((h >>> 0) % 100) / 100;
    bars.push(0.2 + norm * 0.8);
  }
  return bars;
}

const SPEEDS = [1, 1.5, 2] as const;

type VoiceBubbleProps = {
  fileId: string;
  durationMs?: number | null;
  waveform?: number[] | null;
  mine: boolean;
};

export function VoiceBubble({ fileId, durationMs, waveform, mine }: VoiceBubbleProps) {
  const [sourceUri, setSourceUri] = useState<string | null>(audioUriCache.get(fileId) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [speedIdx, setSpeedIdx] = useState(0);
  const pendingPlay = useRef(false);

  const player = useAudioPlayer(sourceUri, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);

  const bars = useMemo(() => {
    if (waveform && waveform.length >= 8) return waveform.slice(0, 24);
    return defaultWaveform(fileId, 24);
  }, [fileId, waveform]);

  useEffect(() => {
    if (sourceUri && pendingPlay.current && status.isLoaded) {
      pendingPlay.current = false;
      player.setPlaybackRate(SPEEDS[speedIdx]);
      player.play();
    }
  }, [sourceUri, status.isLoaded, player, speedIdx]);

  useEffect(() => {
    if (status.didJustFinish) {
      player.seekTo(0).catch(() => {});
      player.pause();
    }
  }, [status.didJustFinish, player]);

  const togglePlay = async () => {
    setError('');
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!sourceUri) {
        setLoading(true);
        const uri = await resolveAudioUri(fileId);
        pendingPlay.current = true;
        setSourceUri(uri);
        setLoading(false);
        return;
      }
      if (status.playing) {
        player.pause();
      } else {
        if (status.duration > 0 && status.currentTime >= status.duration - 0.15) {
          await player.seekTo(0);
        }
        player.setPlaybackRate(SPEEDS[speedIdx]);
        player.play();
      }
    } catch (e: any) {
      setLoading(false);
      setError(e?.message || 'Playback failed');
    }
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (sourceUri) {
      player.setPlaybackRate(SPEEDS[next]);
    }
  };

  const totalSec = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;
  const progress = totalSec > 0 ? Math.min(1, status.currentTime / totalSec) : 0;
  const activeBarCount = Math.round(progress * bars.length);

  const seekToBar = async (idx: number) => {
    if (!sourceUri || totalSec <= 0) return;
    const targetSec = (idx / bars.length) * totalSec;
    await player.seekTo(targetSec).catch(() => {});
  };

  const displayTime = status.playing || status.currentTime > 0
    ? formatDuration(status.currentTime * 1000)
    : formatDuration(totalSec * 1000);

  return (
    <View style={styles.bubbleWrap}>
      <Pressable
        style={[styles.playBtn, mine ? styles.playBtnOut : styles.playBtnIn]}
        onPress={togglePlay}
        hitSlop={8}>
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.playIcon}>{status.playing ? '❚❚' : '▶'}</Text>
        )}
      </Pressable>

      <View style={styles.waveColumn}>
        <View style={styles.waveRow}>
          {bars.map((amp, i) => {
            const played = i < activeBarCount;
            return (
              <Pressable key={i} onPress={() => seekToBar(i)} style={styles.barTouch}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(5, Math.round(amp * 24)),
                      backgroundColor: played
                        ? (mine ? '#075E54' : colors.accent)
                        : (mine ? '#9BC98E' : '#C8D1D5'),
                    },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.subRow}>
          <Text style={styles.durationText}>🎤 {displayTime}</Text>
          {status.playing && (
            <Pressable onPress={cycleSpeed} style={styles.speedPill} hitSlop={6}>
              <Text style={styles.speedText}>{SPEEDS[speedIdx]}x</Text>
            </Pressable>
          )}
        </View>
        {!!error && <Text style={styles.errText}>{error}</Text>}
      </View>
    </View>
  );
}

type VoiceRecorderBarProps = {
  durationMs: number;
  levels: number[];
  sending: boolean;
  onCancel: () => void;
  onSend: () => void;
};

export function VoiceRecorderBar({ durationMs, levels, sending, onCancel, onSend }: VoiceRecorderBarProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 450, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const visibleLevels = levels.slice(-18);

  return (
    <View style={styles.recRow}>
      <Pressable onPress={onCancel} disabled={sending} style={styles.cancelBtn} hitSlop={8}>
        <Text style={styles.cancelIcon}>🗑</Text>
      </Pressable>

      <View style={styles.recPill}>
        <Animated.View style={[styles.recDot, { opacity: pulse }]} />
        <Text style={styles.recTimer}>{formatDuration(durationMs)}</Text>
        <View style={styles.recWave}>
          {visibleLevels.map((lvl, i) => (
            <View
              key={i}
              style={[
                styles.recBar,
                { height: Math.max(4, Math.round(lvl * 20)) },
              ]}
            />
          ))}
        </View>
      </View>

      <Pressable onPress={onSend} disabled={sending} style={styles.recSendBtn}>
        {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.recSendIcon}>➤</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 215,
    paddingVertical: 4,
  },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnOut: { backgroundColor: colors.header },
  playBtnIn: { backgroundColor: colors.accent },
  playIcon: { color: '#fff', fontSize: 15, marginLeft: 1 },
  waveColumn: { flex: 1 },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    gap: 2,
  },
  barTouch: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bar: {
    width: 3,
    borderRadius: 2,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  durationText: { fontSize: 11, color: colors.subtext },
  speedPill: {
    backgroundColor: '#00000018',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  speedText: { fontSize: 11, fontWeight: '600', color: colors.text },
  errText: { fontSize: 11, color: '#C0392B', marginTop: 2 },
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    gap: 8,
  },
  cancelBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelIcon: { fontSize: 20 },
  recPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 46,
    gap: 10,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E53935',
  },
  recTimer: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    minWidth: 40,
  },
  recWave: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
    height: 22,
    overflow: 'hidden',
  },
  recBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  recSendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recSendIcon: { color: '#fff', fontSize: 18 },
});
