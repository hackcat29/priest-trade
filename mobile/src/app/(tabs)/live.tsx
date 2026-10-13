import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../../constants/theme';
import { Header } from '../../components/Header';
import { INITIAL_STREAMS } from '../../lib/api';
import { usePriest } from '../../hooks/usePriestState';
import type { LiveStreamItem } from '../../lib/types';

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  isAlert?: boolean;
}

const INITIAL_CHAT: ChatMessage[] = [
  { id: '1', sender: 'Satoshi99', text: '40x leverage is printing on this candle 🔥' },
  { id: '2', sender: 'WHALE_ALERT', text: '🚨 50,000 PERPES Long ($4,210) opened at $0.084', isAlert: true },
  { id: '3', sender: 'SolDegen', text: 'Uniswap v4 graduation happens at 2M volume right?' },
  { id: '4', sender: 'CobieFan', text: 'Yes! 69 SOL seeded and LP burned on-chain!' },
];

export default function LiveScreen() {
  const router = useRouter();
  const { setSelectedMarket, markets } = usePriest();

  const streams: LiveStreamItem[] = React.useMemo(() => {
    if (markets && markets.length > 0) {
      return markets.slice(0, 5).map((m, idx) => ({
        id: `stream-${m.mint}`,
        title: `${m.name} ($${m.symbol}) Live Scalping & Liquidity Watch`,
        roomName: `priest-stage-${m.symbol.toLowerCase()}`,
        streamerName: idx === 0 ? 'CryptoCobie' : idx === 1 ? 'Sarah Jenkins' : idx === 2 ? 'Alex Thorne' : 'TraderJoe',
        streamerHandle: idx === 0 ? '@cobie' : idx === 1 ? '@sarahtrades' : idx === 2 ? '@alexthorne' : '@traderjoe',
        viewers: Math.max(340, 1540 - idx * 280),
        tokenSymbol: m.symbol,
        tokenPrice: m.price,
        tokenChange: m.priceChange24h,
        mint: m.mint,
        isLive: true,
      }));
    }
    return INITIAL_STREAMS;
  }, [markets]);

  const [selectedStream, setSelectedStream] = useState<LiveStreamItem>(INITIAL_STREAMS[0]);

  React.useEffect(() => {
    if (streams.length > 0 && (!selectedStream || !streams.some((s) => s.id === selectedStream.id))) {
      setSelectedStream(streams[0]);
    }
  }, [streams]);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [chatInput, setChatInput] = useState('');

  const handleSelectStream = (stream: LiveStreamItem) => {
    Haptics.selectionAsync();
    setSelectedStream(stream);
  };

  const handleTradeToken = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const target = markets.find((m) => m.symbol === selectedStream.tokenSymbol) || markets[0];
    setSelectedMarket(target);
    router.push('/(tabs)/trade');
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    Haptics.selectionAsync();
    const newMsg: ChatMessage = {
      id: `chat-${Date.now()}`,
      sender: 'You',
      text: chatInput,
    };
    setChatMessages((prev) => [...prev, newMsg]);
    setChatInput('');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Live Trading Streams" />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Live Stage Player Video Mock */}
        <View style={styles.playerStage}>
          {/* Top Stage Bar */}
          <View style={styles.playerTopBar}>
            <View style={styles.liveBadge}>
              <View style={styles.liveRedDot} />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
            <View style={styles.viewersBadge}>
              <Ionicons name="eye" size={12} color="#FFFFFF" />
              <Text style={styles.viewersText}>{selectedStream.viewers.toLocaleString()}</Text>
            </View>
          </View>

          {/* Center Visual Mock / Streamer Placeholder */}
          <View style={styles.streamerCenter}>
            <View style={styles.streamerBigAvatar}>
              <Text style={styles.streamerBigInitial}>
                {selectedStream.streamerName[0]}
              </Text>
            </View>
            <Text style={styles.stageTitle}>{selectedStream.title}</Text>
            <Text style={styles.stageHost}>Streaming with @{selectedStream.streamerHandle}</Text>
          </View>

          {/* Stage Bottom Ticker Bar */}
          <View style={styles.stageBottomBar}>
            <View style={styles.tokenTag}>
              <Text style={styles.tokenTagSymbol}>${selectedStream.tokenSymbol}</Text>
              <Text style={styles.tokenTagPrice}>${selectedStream.tokenPrice.toFixed(4)}</Text>
              <Text style={styles.tokenTagChange}>+{selectedStream.tokenChange}%</Text>
            </View>

            <TouchableOpacity
              style={styles.tradeTokenBtn}
              onPress={handleTradeToken}
              activeOpacity={0.8}
            >
              <Ionicons name="flash" size={14} color="#000000" />
              <Text style={styles.tradeTokenText}>Trade Token</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Live Stream Rooms Carousel */}
        <Text style={styles.sectionHeader}>ALL ACTIVE ROOMS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roomsScroll}>
          {streams.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[
                styles.roomCard,
                selectedStream.id === s.id && styles.roomCardSelected,
              ]}
              onPress={() => handleSelectStream(s)}
            >
              <View style={styles.roomCardTop}>
                <View style={styles.roomAvatar}>
                  <Text style={styles.roomAvatarText}>{s.streamerName[0]}</Text>
                </View>
                <View style={styles.roomLivePill}>
                  <Text style={styles.roomLiveText}>LIVE</Text>
                </View>
              </View>
              <Text style={styles.roomTitle} numberOfLines={2}>
                {s.title}
              </Text>
              <Text style={styles.roomMeta}>
                ${s.tokenSymbol} • {s.viewers} viewers
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* In-Stream Live Chat */}
        <View style={styles.chatSection}>
          <Text style={styles.sectionHeader}>STREAM CHAT</Text>
          <View style={styles.chatBox}>
            <ScrollView style={styles.chatMessagesList} nestedScrollEnabled>
              {chatMessages.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    styles.chatRow,
                    msg.isAlert && styles.chatRowAlert,
                  ]}
                >
                  <Text
                    style={[
                      styles.chatSender,
                      msg.isAlert && { color: PriestTheme.colors.primary },
                    ]}
                  >
                    {msg.sender}:
                  </Text>
                  <Text
                    style={[
                      styles.chatText,
                      msg.isAlert && { color: PriestTheme.colors.primary, fontWeight: '700' },
                    ]}
                  >
                    {msg.text}
                  </Text>
                </View>
              ))}
            </ScrollView>

            {/* Chat Input */}
            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Send a chat message..."
                placeholderTextColor={PriestTheme.colors.textMuted}
                value={chatInput}
                onChangeText={setChatInput}
                onSubmitEditing={handleSendMessage}
              />
              <TouchableOpacity
                style={styles.chatSendBtn}
                onPress={handleSendMessage}
              >
                <Ionicons name="send" size={16} color="#000000" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: PriestTheme.colors.bg0,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  playerStage: {
    height: 240,
    backgroundColor: '#0D0F17',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 148, 0.2)',
    padding: 16,
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  playerTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: PriestTheme.colors.danger,
    gap: 6,
  },
  liveRedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PriestTheme.colors.danger,
  },
  liveBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  viewersBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 5,
  },
  viewersText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  streamerCenter: {
    alignItems: 'center',
  },
  streamerBigAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: PriestTheme.colors.primaryDim,
    borderWidth: 2,
    borderColor: PriestTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  streamerBigInitial: {
    color: PriestTheme.colors.primary,
    fontSize: 26,
    fontWeight: '900',
  },
  stageTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  stageHost: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  stageBottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 10,
  },
  tokenTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tokenTagSymbol: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  tokenTagPrice: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
  },
  tokenTagChange: {
    color: PriestTheme.colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  tradeTokenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  tradeTokenText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionHeader: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  roomsScroll: {
    marginBottom: 20,
  },
  roomCard: {
    width: 170,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginRight: 10,
  },
  roomCardSelected: {
    borderColor: PriestTheme.colors.primary,
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  roomCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  roomAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PriestTheme.colors.bg3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomAvatarText: {
    color: PriestTheme.colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  roomLivePill: {
    backgroundColor: PriestTheme.colors.dangerDim,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roomLiveText: {
    color: PriestTheme.colors.danger,
    fontSize: 9,
    fontWeight: '800',
  },
  roomTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    height: 36,
  },
  roomMeta: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 11,
    marginTop: 6,
  },
  chatSection: {
    marginBottom: 20,
  },
  chatBox: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    padding: 12,
  },
  chatMessagesList: {
    maxHeight: 180,
    marginBottom: 10,
  },
  chatRow: {
    flexDirection: 'row',
    marginBottom: 6,
    gap: 6,
  },
  chatRowAlert: {
    backgroundColor: PriestTheme.colors.primaryDim,
    padding: 6,
    borderRadius: 6,
  },
  chatSender: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  chatText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    flex: 1,
  },
  chatInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  chatInput: {
    flex: 1,
    height: 38,
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
  },
  chatSendBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: PriestTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
