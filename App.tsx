import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatListScreen } from './src/ChatListScreen';
import { ChatScreen } from './src/ChatScreen';
import { LoginScreen } from './src/LoginScreen';
import { User, getProfile, setCredentials } from './src/api';

const STORAGE_KEY = 'credentials';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<User | null>(null);
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);

  const login = async (username: string, password: string) => {
    setCredentials(username, password);
    setMe(await getProfile());
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ username, password }));
  };

  const logout = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setMe(null);
    setOpen(null);
  };

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          const { username, password } = JSON.parse(saved);
          await login(username, password);
        }
      } catch {}
      setBooting(false);
    })();
  }, []);

  let screen;
  if (booting) {
    screen = <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color="#075E54" /></View>;
  } else if (!me) {
    screen = <LoginScreen onLogin={login} />;
  } else if (open) {
    screen = <ChatScreen conversationId={open.id} title={open.title} meId={me.id} onBack={() => setOpen(null)} />;
  } else {
    screen = <ChatListScreen me={me} onOpen={(c, title) => setOpen({ id: c.id, title })} onLogout={logout} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {screen}
    </SafeAreaProvider>
  );
}
