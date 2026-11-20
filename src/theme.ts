export const colors = {
  header: '#075E54',
  accent: '#25D366',
  chatBg: '#ECE5DD',
  outgoing: '#DCF8C6',
  incoming: '#FFFFFF',
  text: '#111B21',
  subtext: '#667781',
  tick: '#34B7F1',
  divider: '#E9EDEF',
};

export function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const AVATAR_COLORS = ['#128C7E', '#6B7C85', '#C0392B', '#8E44AD', '#2980B9', '#D35400'];
export function avatarColor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
