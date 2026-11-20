import { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from './Avatar';
import { Conversation, Message, User, createConversation, getConversations, getMessages, getUsers } from './api';
import { colors, formatTime } from './theme';

type Props = {
  me: User;
  onOpen: (conversation: Conversation, title: string) => void;
  onLogout: () => void;
};

export function conversationTitle(c: Conversation, me: string, users: Record<string, User>) {
  if (c.type === 'GROUP') return c.name || 'Group';
  const other = c.participants_ids.find((id) => id !== me);
  return (other && users[other]?.name) || c.name || 'Chat';
}

export function ChatListScreen({ me, onOpen, onLogout }: Props) {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [last, setLast] = useState<Record<string, Message | undefined>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cs, us] = await Promise.all([getConversations(), getUsers()]);
      setUsers(Object.fromEntries(us.map((u) => [u.id, u])));
      setConvos(cs);
      const previews = await Promise.all(cs.map((c) => getMessages(c.id).catch(() => null)));
      setLast(Object.fromEntries(cs.map((c, i) => [c.id, previews[i]?.data.at(-1)])));
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const startChat = async (u: User) => {
    setPicking(false);
    const c = await createConversation([u.id]);
    onOpen(c, u.name);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <Pressable onPress={onLogout}>
          <Text style={styles.headerAction}>Logout</Text>
        </Pressable>
      </View>
      <FlatList
        data={convos}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No chats yet. Tap + to start one.</Text>}
        renderItem={({ item }) => {
          const title = conversationTitle(item, me.id, users);
          const m = last[item.id];
          return (
            <Pressable style={styles.row} onPress={() => onOpen(item, title)}>
              <Avatar name={title} />
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.name} numberOfLines={1}>{title}</Text>
                  {m && <Text style={styles.time}>{formatTime(m.createdAt)}</Text>}
                </View>
                <Text style={styles.preview} numberOfLines={1}>
                  {m ? (m.senderId === me.id ? 'You: ' : '') + (m.type === 'IMAGE' ? '📷 ' + (m.content || 'Photo') : m.type === 'FILE' ? '📎 ' + (m.file?.name ?? 'File') : m.content) : 'No messages yet'}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
      <Pressable style={styles.fab} onPress={() => setPicking(true)}>
        <Text style={styles.fabText}>＋</Text>
      </Pressable>

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Select contact</Text>
            <Pressable onPress={() => setPicking(false)}>
              <Text style={styles.headerAction}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            data={Object.values(users).filter((u) => u.id !== me.id)}
            keyExtractor={(u) => u.id}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => startChat(item)}>
                <Avatar name={item.name} />
                <View style={styles.rowBody}>
                  <Text style={styles.name}>{item.name}</Text>
                  {!!item.bio && <Text style={styles.preview}>{item.bio}</Text>}
                </View>
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { backgroundColor: colors.header, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '600' },
  headerAction: { color: '#fff', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  rowBody: { flex: 1, marginLeft: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, paddingBottom: 10 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { fontSize: 17, fontWeight: '500', color: colors.text, flexShrink: 1 },
  time: { fontSize: 12, color: colors.subtext },
  preview: { color: colors.subtext, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.subtext, marginTop: 60 },
  fab: { position: 'absolute', right: 20, bottom: 30, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  fabText: { color: '#fff', fontSize: 28, marginTop: -2 },
});
