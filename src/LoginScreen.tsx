import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { getBaseUrl } from './api';
import { colors } from './theme';

type Props = { onLogin: (username: string, password: string, serverUrl?: string) => Promise<void> };

export function LoginScreen({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(getBaseUrl());
  const [showServer, setShowServer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      await onLogin(username.trim(), password, serverUrl.trim() || undefined);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>Welcome to Chat</Text>
      <Text style={styles.sub}>Enter a username and password. New usernames are registered automatically.</Text>
      <TextInput
        style={styles.input}
        placeholder="Username"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoCapitalize="none"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      {showServer && (
        <TextInput
          style={styles.input}
          placeholder="Backend URL (e.g. http://192.168.1.5:3000)"
          autoCapitalize="none"
          autoCorrect={false}
          value={serverUrl}
          onChangeText={setServerUrl}
        />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>NEXT</Text>}
      </Pressable>
      <Pressable onPress={() => setShowServer((v) => !v)} style={styles.serverToggle}>
        <Text style={styles.serverToggleText}>
          {showServer ? 'Hide server settings' : `Server: ${serverUrl}`}
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', padding: 32 },
  title: { fontSize: 22, fontWeight: '600', color: colors.header, textAlign: 'center' },
  sub: { color: colors.subtext, textAlign: 'center', marginVertical: 16 },
  input: { borderBottomWidth: 2, borderBottomColor: colors.accent, paddingVertical: 10, fontSize: 17, marginBottom: 20 },
  error: { color: '#C0392B', textAlign: 'center', marginBottom: 12 },
  button: { backgroundColor: colors.accent, borderRadius: 24, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700', letterSpacing: 1 },
  serverToggle: { marginTop: 18, alignItems: 'center' },
  serverToggleText: { color: colors.subtext, fontSize: 13 },
});
