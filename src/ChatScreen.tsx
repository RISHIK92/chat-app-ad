import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from './Avatar';
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

function ChatImage({ fileId }: { fileId: string }) {
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
  return <Image source={{ uri }} style={styles.msgImage} />;
}

export function ChatScreen({ conversationId, title, meId, onBack }: Props) {
  // Newest first, rendered in an inverted list.
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const loadingOlder = useRef(false);
  const initialLoaded = useRef(false);
  const [image, setImage] = useState<{ uri: string; base64: string; name: string } | null>(null);

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        if (perm.canAskAgain) {
          Alert.alert('Permission needed', 'Photo access is needed to attach images.');
        } else {
          // Denied permanently: the system won't prompt again, so send them to Settings.
          Alert.alert('Photo access blocked', 'Enable photo access for this app in Settings to attach images.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]);
        }
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled) return;

      // Downscale before upload: phone photos are huge and the API caps files at 10 MB.
      const ctx = ImageManipulator.manipulate(result.assets[0].uri);
      ctx.resize({ width: 1280 });
      const rendered = await ctx.renderAsync();
      const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
      setImage({ uri: out.uri, base64: out.base64!, name: `photo-${Date.now()}.jpg` });
    } catch {
      Alert.alert('Something went wrong', 'Could not open your photos. Please try again.');
    }
  };

  const refresh = useCallback(async () => {
    try {
      const page = await getMessages(conversationId);
      const fresh = [...page.data].reverse();
      setMessages((prev) => {
        const ids = new Set(fresh.map((m) => m.id));
        return [...fresh, ...prev.filter((m) => !ids.has(m.id) && m.createdAt < fresh[fresh.length - 1]?.createdAt)];
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
            return (
              <View style={[styles.bubble, mine ? styles.out : styles.in]}>
                {item.type === 'IMAGE' && (item.fileId ?? item.file?.id) && (
                  <ChatImage fileId={(item.fileId ?? item.file?.id)!} />
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
            <Pressable onPress={() => setImage(null)} hitSlop={8}>
              <Text style={styles.previewRemove}>✕</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.inputRow}>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              placeholder="Message"
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable onPress={pickImage} hitSlop={8} style={styles.upload}>
              <Text style={styles.uploadText}>📎</Text>
            </Pressable>
          </View>
          <Pressable style={styles.send} onPress={send}>
            <Text style={styles.sendText}>➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.header },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  back: { color: '#fff', fontSize: 24 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 },
  body: { flex: 1, backgroundColor: colors.chatBg },
  bubble: { maxWidth: '80%', borderRadius: 8, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 4, marginVertical: 2 },
  out: { alignSelf: 'flex-end', backgroundColor: colors.outgoing },
  in: { alignSelf: 'flex-start', backgroundColor: colors.incoming },
  msgImage: { width: 220, height: 220, borderRadius: 6 },
  msgImageLoading: { backgroundColor: '#00000010', alignItems: 'center', justifyContent: 'center' },
  msg: { fontSize: 16, color: colors.text },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4 },
  time: { fontSize: 11, color: colors.subtext },
  tick: { fontSize: 11, color: colors.subtext },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 8 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#fff', borderRadius: 22 },
  input: { flex: 1, paddingLeft: 16, paddingVertical: 10, maxHeight: 120, fontSize: 16 },
  upload: { paddingHorizontal: 12, paddingVertical: 11 },
  uploadText: { fontSize: 20 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 8, marginTop: 8, padding: 8, backgroundColor: '#fff', borderRadius: 12 },
  previewImg: { width: 56, height: 56, borderRadius: 8 },
  previewRemove: { fontSize: 18, color: colors.subtext },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.header, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 18 },
});
