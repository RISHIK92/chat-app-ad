import { Text, View } from 'react-native';
import { avatarColor } from './theme';

export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: avatarColor(name),
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: '#fff', fontSize: size * 0.42, fontWeight: '600' }}>
        {(name[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}
