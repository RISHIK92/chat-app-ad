import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from './Avatar';
import { VoiceBubble, VoiceRecorderBar } from './VoiceMessage';
import { Message, getFile, getMessages, sendMessage, uploadFile } from './api';
import { colors, formatTime } from './theme';

type Props = { conversationId: string; title: string; meId: string; onBack: () => void };

function Ticks({ m, meId }: { m: Message; meId: string }) {
  const others = Object.entries(m.status ?? {}).filter(([id]) => id !== meId);
  const read = others.length > 0 && others.every(([, s]) => s.read);
  const delivered = others.length > 0 && others.every(([, s]) => s.delivered);
  return <Text style={[styles.tick, read && { color: colors.tick }]}>{delivered || read ? '✓✓' : '✓'}</Text>;
}

// Native <Image> can't be trusted to forward our non-standard Authorization header (it 401s),
// so images are fetched through the authenticated JSON endpoint and shown as data URIs.
const imageCache = new Map<string, string>();

function ChatImage({ fileId, onPress }: { fileId: string; onPress?: (uri: string) => void }) {
  const [uri, setUri] = useState(imageCache.get(fileId) ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (uri) return;
    getFile(fileId)
      .then((f) => {
        const dataUri = `data:${f.mimeType};base64,${f.data}`;
        imageCache.set(fileId, dataUri);
        setUri(dataUri);
      })
      .catch((e) => setError(e.message));
  }, [fileId, uri]);

  if (error) return <Text style={styles.msg}>⚠️ Image failed to load: {error}</Text>;
  if (!uri) return <View style={[styles.msgImage, styles.msgImageLoading]}><ActivityIndicator color={colors.subtext} /></View>;
  return (
    <Pressable onPress={() => onPress?.(uri)}>
      <Image source={{ uri }} style={styles.msgImage} />
    </Pressable>
  );
}

async function readRecordingAsBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const str = typeof reader.result === 'string' ? reader.result : '';
        resolve(str.includes(',') ? str.split(',')[1] : str);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  return await new File(uri).base64();
}

function downsampleWaveform(samples: number[], target = 24): number[] {
  if (samples.length === 0) return Array.from({ length: target }, () => 0.35);
  const out: number[] = [];
  for (let i = 0; i < target; i++) {
    const idx = Math.min(samples.length - 1, Math.floor((i / target) * samples.length));
    out.push(Number(samples[idx].toFixed(2)));
  }
  return out;
}

export function ChatScreen({ conversationId, title, meId, onBack }: Props) {
  // Newest first, rendered in an inverted list.
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const loadingOlder = useRef(false);
  const initialLoaded = useRef(false);
  const [image, setImage] = useState<{ uri: string; base64: string; name: string } | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  // Voice recording state
  const audioRecorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(audioRecorder, 150);
  const [isRecording, setIsRecording] = useState(false);
  const [sendingVoice, setSendingVoice] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [waveLevels, setWaveLevels] = useState<number[]>([]);
  const recordStartedAt = useRef<number>(0);

  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setRecordMs(Date.now() - recordStartedAt.current);
      const metering = recorderState.metering;
      // Convert dBFS (-60..0) to 0.15..1.0; fallback to gentle animated level when metering is unavailable
      const level = typeof metering === 'number'
        ? Math.max(0.15, Math.min(1, (metering + 60) / 60))
        : 0.25 + Math.random() * 0.65;
      setWaveLevels((prev) => [...prev.slice(-120), level]);
    }, 150);
    return () => clearInterval(interval);
  }, [isRecording, recorderState.metering]);

  const processSelectedAsset = async (assetUri: string) => {
    // Downscale before upload: phone photos are huge and the API caps files at 12 MB.
    const ctx = ImageManipulator.manipulate(assetUri);
    ctx.resize({ width: 1280 });
    const rendered = await ctx.renderAsync();
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
    setImage({ uri: out.uri, base64: out.base64!, name: `photo-${Date.now()}.jpg` });
  };

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        if (perm.canAskAgain) {
          Alert.alert('Permission needed', 'Photo access is needed to attach images.');
        } else {
          Alert.alert('Photo access blocked', 'Enable photo access for this app in Settings to attach images.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]);
        }
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled) return;
      await processSelectedAsset(result.assets[0].uri);
    } catch {
      Alert.alert('Something went wrong', 'Could not open your photos. Please try again.');
    }
  };

  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) {
          Alert.alert('Permission needed', 'Camera access is needed to take photos.');
        } else {
          Alert.alert('Camera access blocked', 'Enable camera access for this app in Settings to take photos.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]);
        }
        return;
      }

      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled) return;
      await processSelectedAsset(result.assets[0].uri);
    } catch {
      Alert.alert('Camera unavailable', 'Could not open the camera on this device.');
    }
  };

  const startVoiceRecording = async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) {
          Alert.alert('Permission needed', 'Microphone access is needed to record voice messages.');
        } else {
          Alert.alert('Microphone blocked', 'Enable microphone access in Settings to send voice messages.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]);
        }
        return;
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      recordStartedAt.current = Date.now();
      setRecordMs(0);
      setWaveLevels([]);
      setIsRecording(true);
    } catch (e: any) {
      Alert.alert('Recording failed', e?.message || 'Could not start voice recording.');
    }
  };

  const cancelVoiceRecording = async () => {
    try {
      await audioRecorder.stop();
    } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    setIsRecording(false);
    setRecordMs(0);
    setWaveLevels([]);
  };

  const sendVoiceRecording = async () => {
    if (sendingVoice) return;
    setSendingVoice(true);
    const durationMs = Math.max(500, Date.now() - recordStartedAt.current);
    const waveform = downsampleWaveform(waveLevels, 24);
    try {
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      const uri = audioRecorder.uri;
      if (!uri) throw new Error('No audio file recorded');

      const base64 = await readRecordingAsBase64(uri);
      const isWeb = Platform.OS === 'web';
      const mimeType = isWeb ? 'audio/webm' : 'audio/mp4';
      const ext = isWeb ? 'webm' : 'm4a';
      const file = await uploadFile(`voice-${Date.now()}.${ext}`, mimeType, base64, durationMs);
      const m = await sendMessage(conversationId, undefined, file.id, { durationMs, waveform });
      setMessages((prev) => [m, ...prev]);
    } catch (e: any) {
      Alert.alert('Could not send voice message', e?.message || 'Please try again.');
    } finally {
      setSendingVoice(false);
      setIsRecording(false);
      setRecordMs(0);
      setWaveLevels([]);
    }
  };

  const refresh = useCallback(async () => {
    try {
      const page = await getMessages(conversationId);
      const fresh = [...page.data].reverse();
      setMessages((prev) => {
        const ids = new Set(fresh.map((m) => m.id));
        const oldestFresh = fresh[fresh.length - 1]?.createdAt;
        return [...fresh, ...prev.filter((m) => !ids.has(m.id) && (!oldestFresh || m.createdAt < oldestFresh))];
      });
      if (!initialLoaded.current) {
        initialLoaded.current = true;
        setCursor(page.nextCursor ?? null);
      }
    } catch {}
  }, [conversationId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const loadOlder = async () => {
    if (!cursor || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      const page = await getMessages(conversationId, cursor);
      setMessages((prev) => [...prev, ...[...page.data].reverse()]);
      setCursor(page.nextCursor ?? null);
    } catch {}
    loadingOlder.current = false;
  };

  const send = async () => {
    const content = text.trim();
    if (!content && !image) return;
    const pending = image;
    setText('');
    setImage(null);
    try {
      // Upload first, then send one message that references the file; the text becomes its caption.
      const file = pending && (await uploadFile(pending.name, 'image/jpeg', pending.base64));
      const m = await sendMessage(conversationId, content, file?.id);
      setMessages((prev) => [m, ...prev]);
    } catch (e: any) {
      setText(content);
      setImage(pending);
      Alert.alert('Could not send', e.message);
    }
  };

  const canSendTextOrImage = text.trim().length > 0 || image !== null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Avatar name={title} size={38} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ padding: 8 }}
          renderItem={({ item }) => {
            const mine = item.senderId === meId;
            const fileId = item.fileId ?? item.file?.id;
            return (
              <View style={[styles.bubble, mine ? styles.out : styles.in]}>
                {item.type === 'IMAGE' && fileId && (
                  <ChatImage fileId={fileId} onPress={setViewerUri} />
                )}
                {item.type === 'AUDIO' && fileId && (
                  <VoiceBubble
                    fileId={fileId}
                    durationMs={item.durationMs ?? item.file?.durationMs}
                    waveform={item.waveform}
                    mine={mine}
                  />
                )}
                {item.type === 'FILE' && <Text style={styles.msg}>📎 {item.file?.name ?? 'File'}</Text>}
                {!!item.content && <Text style={styles.msg}>{item.content}</Text>}
                <View style={styles.meta}>
                  <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
                  {mine && <Ticks m={item} meId={meId} />}
                </View>
              </View>
            );
          }}
        />
        {image && (
          <View style={styles.preview}>
            <Image source={{ uri: image.uri }} style={styles.previewImg} />
            <Text style={styles.previewLabel} numberOfLines={1}>Photo ready to send</Text>
            <Pressable onPress={() => setImage(null)} hitSlop={8}>
              <Text style={styles.previewRemove}>✕</Text>
            </Pressable>
          </View>
        )}
        {isRecording ? (
          <VoiceRecorderBar
            durationMs={recordMs}
            levels={waveLevels}
            sending={sendingVoice}
            onCancel={cancelVoiceRecording}
            onSend={sendVoiceRecording}
          />
        ) : (
          <View style={styles.inputRow}>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.input}
                placeholder="Message"
                value={text}
                onChangeText={setText}
                multiline
              />
              <Pressable onPress={pickImage} hitSlop={8} style={styles.iconBtn}>
                <Text style={styles.iconText}>📎</Text>
              </Pressable>
              <Pressable onPress={takePhoto} hitSlop={8} style={styles.iconBtn}>
                <Text style={styles.iconText}>📷</Text>
              </Pressable>
            </View>
            {canSendTextOrImage ? (
              <Pressable style={styles.send} onPress={send}>
                <Text style={styles.sendText}>➤</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.send} onPress={startVoiceRecording}>
                <Text style={styles.sendText}>🎤</Text>
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={styles.viewerBackdrop}>
          <Pressable style={styles.viewerClose} onPress={() => setViewerUri(null)} hitSlop={12}>
            <Text style={styles.viewerCloseText}>✕</Text>
          </Pressable>
          {viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.header },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  back: { color: '#fff', fontSize: 24 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 },
  body: { flex: 1, backgroundColor: colors.chatBg },
  bubble: { maxWidth: '82%', borderRadius: 8, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 4, marginVertical: 2 },
  out: { alignSelf: 'flex-end', backgroundColor: colors.outgoing },
  in: { alignSelf: 'flex-start', backgroundColor: colors.incoming },
  msgImage: { width: 220, height: 220, borderRadius: 6 },
  msgImageLoading: { backgroundColor: '#00000010', alignItems: 'center', justifyContent: 'center' },
  msg: { fontSize: 16, color: colors.text },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4 },
  time: { fontSize: 11, color: colors.subtext },
  tick: { fontSize: 11, color: colors.subtext },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 8 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#fff', borderRadius: 22, paddingRight: 4 },
  input: { flex: 1, paddingLeft: 16, paddingVertical: 10, maxHeight: 120, fontSize: 16 },
  iconBtn: { paddingHorizontal: 8, paddingVertical: 11 },
  iconText: { fontSize: 20 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 8, marginTop: 8, padding: 8, backgroundColor: '#fff', borderRadius: 12 },
  previewImg: { width: 56, height: 56, borderRadius: 8 },
  previewLabel: { flex: 1, fontSize: 14, color: colors.subtext },
  previewRemove: { fontSize: 18, color: colors.subtext, paddingHorizontal: 6 },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.header, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 19 },
  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', top: 52, right: 20, zIndex: 2, padding: 8 },
  viewerCloseText: { color: '#fff', fontSize: 26, fontWeight: '600' },
  viewerImage: { width: '94%', height: '80%' },
});
