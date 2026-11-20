import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from './Avatar';
import { formatDuration } from './VoiceMessage';
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

function previewText(m: Message | undefined, meId: string) {
  if (!m) return 'No messages yet';
  const prefix = m.senderId === meId ? 'You: ' : '';
  if (m.type === 'IMAGE') return `${prefix}📷 ${m.content || 'Photo'}`;
  if (m.type === 'AUDIO') {
    const dur = m.durationMs ?? m.file?.durationMs;
    return `${prefix}🎤 Voice message${dur ? ` (${formatDuration(dur)})` : ''}`;
  }
  if (m.type === 'FILE') return `${prefix}📎 ${m.file?.name ?? 'File'}`;
  return `${prefix}${m.content}`;
}

export function ChatListScreen({ me, onOpen, onLogout }: Props) {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [last, setLast] = useState<Record<string, Message | undefined>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Main screen search (filters chats + matching contacts)
  const [chatSearch, setChatSearch] = useState('');

  // Select contact modal + live backend search
  const [picking, setPicking] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [searchedContacts, setSearchedContacts] = useState<User[] | null>(null);
  const [searchingContacts, setSearchingContacts] = useState(false);

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

  // Live backend contact search when modal is open
  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    const q = contactSearch.trim();
    setSearchingContacts(true);
    const timer = setTimeout(async () => {
      try {
        const results = await getUsers(q || undefined);
        if (!cancelled) {
          setSearchedContacts(results.filter((u) => u.id !== me.id));
        }
      } catch {
        if (!cancelled) setSearchedContacts(null);
      } finally {
        if (!cancelled) setSearchingContacts(false);
      }
    }, q ? 200 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [picking, contactSearch, me.id]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const startChat = async (u: User) => {
    setPicking(false);
    setContactSearch('');
    setChatSearch('');
    const c = await createConversation([u.id]);
    onOpen(c, u.name);
  };

  const q = chatSearch.trim().toLowerCase();

  const filteredConvos = useMemo(() => {
    if (!q) return convos;
    return convos.filter((c) => {
      const title = conversationTitle(c, me.id, users).toLowerCase();
      const msg = last[c.id]?.content?.toLowerCase() ?? '';
      return title.includes(q) || msg.includes(q);
    });
  }, [convos, last, me.id, q, users]);

  const matchingContacts = useMemo(() => {
    if (!q) return [];
    return Object.values(users).filter(
      (u) =>
        u.id !== me.id &&
        (u.name.toLowerCase().includes(q) || (u.bio && u.bio.toLowerCase().includes(q))),
    );
  }, [me.id, q, users]);

  const modalContacts = useMemo(() => {
    if (searchedContacts) return searchedContacts;
    const cq = contactSearch.trim().toLowerCase();
    return Object.values(users).filter(
      (u) =>
        u.id !== me.id &&
        (!cq || u.name.toLowerCase().includes(cq) || (u.bio && u.bio.toLowerCase().includes(cq))),
    );
  }, [contactSearch, me.id, searchedContacts, users]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <Pressable onPress={onLogout}>
          <Text style={styles.headerAction}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search chats or contacts..."
            placeholderTextColor={colors.subtext}
            value={chatSearch}
            onChangeText={setChatSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!!chatSearch && (
            <Pressable onPress={() => setChatSearch('')} hitSlop={8}>
              <Text style={styles.clearText}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={filteredConvos}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={
          q && matchingContacts.length > 0 ? undefined : (
            <Text style={styles.empty}>
              {q ? `No chats or contacts match "${chatSearch.trim()}"` : 'No chats yet. Tap + to start one.'}
            </Text>
          )
        }
        ListFooterComponent={
          q && matchingContacts.length > 0 ? (
            <View>
              <Text style={styles.sectionLabel}>Contacts</Text>
              {matchingContacts.map((u) => (
                <Pressable key={u.id} style={styles.row} onPress={() => startChat(u)}>
                  <Avatar name={u.name} />
                  <View style={styles.rowBody}>
                    <Text style={styles.name}>{u.name}</Text>
                    {!!u.bio && <Text style={styles.preview} numberOfLines={1}>{u.bio}</Text>}
                  </View>
                </Pressable>
              ))}
            </View>
          ) : undefined
        }
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
                  {previewText(m, me.id)}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
      <Pressable style={styles.fab} onPress={() => setPicking(true)}>
        <Text style={styles.fabText}>＋</Text>
      </Pressable>

      <Modal
        visible={picking}
        animationType="slide"
        onRequestClose={() => {
          setPicking(false);
          setContactSearch('');
        }}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Select contact</Text>
            <Pressable
              onPress={() => {
                setPicking(false);
                setContactSearch('');
              }}>
              <Text style={styles.headerAction}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <View style={styles.searchBox}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search contacts by name or bio..."
                placeholderTextColor={colors.subtext}
                value={contactSearch}
                onChangeText={setContactSearch}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              {searchingContacts ? (
                <ActivityIndicator size="small" color={colors.header} />
              ) : (
                !!contactSearch && (
                  <Pressable onPress={() => setContactSearch('')} hitSlop={8}>
                    <Text style={styles.clearText}>✕</Text>
                  </Pressable>
                )
              )}
            </View>
          </View>

          <FlatList
            data={modalContacts}
            keyExtractor={(u) => u.id}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {contactSearch.trim()
                  ? `No contacts found for "${contactSearch.trim()}"`
                  : 'No other users registered yet.'}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => startChat(item)}>
                <Avatar name={item.name} />
                <View style={styles.rowBody}>
                  <Text style={styles.name}>{item.name}</Text>
                  {!!item.bio && <Text style={styles.preview} numberOfLines={1}>{item.bio}</Text>}
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
  searchWrap: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#F6F7F8', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 12, height: 38, gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  searchIcon: { fontSize: 15 },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  clearText: { fontSize: 15, color: colors.subtext, paddingHorizontal: 4 },
  sectionLabel: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, fontSize: 13, fontWeight: '600', color: colors.header, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  rowBody: { flex: 1, marginLeft: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, paddingBottom: 10 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { fontSize: 17, fontWeight: '500', color: colors.text, flexShrink: 1 },
  time: { fontSize: 12, color: colors.subtext },
  preview: { color: colors.subtext, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.subtext, marginTop: 60, paddingHorizontal: 24 },
  fab: { position: 'absolute', right: 20, bottom: 30, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  fabText: { color: '#fff', fontSize: 28, marginTop: -2 },
});
