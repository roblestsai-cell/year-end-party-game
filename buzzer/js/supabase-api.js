// 真實後端：Supabase（資料庫結構見 ../supabase/schema.sql）
const toRoom = (r) => r && ({
  round: r.round,
  opensAt: r.opens_at ? Date.parse(r.opens_at) : null,
  winnerPlayer: r.winner_player,
  winnerName: r.winner_name,
});

async function rpc(sb, name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export function create(config) {
  if (!window.supabase) throw new Error('Supabase 函式庫載入失敗，請檢查網路');
  const sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  return {
    async serverNow() { return Number(await rpc(sb, 'server_now_ms')); },

    async getRoom() {
      const { data, error } = await sb.from('rooms')
        .select('round, opens_at, winner_player, winner_name').eq('id', 'main').single();
      if (error) throw new Error(error.message);
      return toRoom(data);
    },

    async listPlayers() {
      const { data, error } = await sb.from('players')
        .select('id, name, joined_at').eq('room_id', 'main').order('joined_at');
      if (error) throw new Error(error.message);
      return data.map((p) => ({ id: p.id, name: p.name, joinedAt: Date.parse(p.joined_at) }));
    },

    async join(name) {
      const rows = await rpc(sb, 'join_game', { p_name: name });
      const p = rows[0];
      return { playerId: p.player_id, token: p.token, name: p.name };
    },

    async whoami(token) {
      const rows = await rpc(sb, 'whoami', { p_token: token });
      return rows.length ? { playerId: rows[0].player_id, name: rows[0].name } : null;
    },

    async buzz(token, round) { return rpc(sb, 'buzz', { p_token: token, p_round: round }); },
    async startRound() { await rpc(sb, 'start_round'); },
    async clearPlayers() { await rpc(sb, 'clear_players'); },

    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    async getSession() { return (await sb.auth.getSession()).data.session; },

    // 即時同步；另有輪詢當備援，所以這裡漏掉事件也不會出錯
    subscribe(onRoom, onPlayers) {
      let ch = sb.channel('buzzer-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.main' },
          (p) => p.new && onRoom(toRoom(p.new)));
      if (onPlayers) {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => onPlayers());
      }
      ch.subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}
