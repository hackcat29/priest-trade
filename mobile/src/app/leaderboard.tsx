import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import { API_BASE } from '../lib/api';

interface LeaderboardUser {
  rank: number;
  handle: string;
  name: string;
  pnlUsd: number;
  roiPercent: number;
  winRate: number;
  volumeUsd: number;
  tradesCount: number;
}

const SEED_LEADERS: LeaderboardUser[] = [
  { rank: 1, handle: '@75Ffzx...7Si4', name: 'Alpha Core LP', pnlUsd: 160903, roiPercent: 1609.0, winRate: 91.5, volumeUsd: 5631631, tradesCount: 321 },
  { rank: 2, handle: '@0xe789...3674', name: 'Monad Arbitrage Vault', pnlUsd: 100508, roiPercent: 1005.0, winRate: 88.0, volumeUsd: 3517801, tradesCount: 201 },
  { rank: 3, handle: '@dr_leverage', name: 'Dr. Leverage', pnlUsd: 64200, roiPercent: 318.5, winRate: 84.5, volumeUsd: 2850000, tradesCount: 96 },
  { rank: 4, handle: '@delta_harvester', name: 'Delta Neutral King', pnlUsd: 48900, roiPercent: 142.8, winRate: 96.0, volumeUsd: 3100000, tradesCount: 310 },
  { rank: 5, handle: '@solana_whale', name: 'Solana Whale', pnlUsd: 39500, roiPercent: 112.4, winRate: 74.0, volumeUsd: 1250000, tradesCount: 52 },
];

export default function LeaderboardScreen() {
  const router = useRouter();
  const [timeframe, setTimeframe] = useState<'7d' | '30d' | 'all'>('7d');
  const [sortBy, setSortBy] = useState<'pnl' | 'roi' | 'winRate'>('pnl');
  const [leaders, setLeaders] = useState<LeaderboardUser[]>(SEED_LEADERS);

  useEffect(() => {
    fetch(`${API_BASE}/rewards/leaderboard?limit=20&range=${timeframe}`)
      .then((res) => res.json())
      .then((json) => {
        const raw = json?.data;
        if (Array.isArray(raw) && raw.length > 0) {
          const mapped: LeaderboardUser[] = raw.map((item: any, idx: number) => {
            const pts = Number(item.points || '1000000');
            return {
              rank: item.rank || idx + 1,
              handle: item.handle ? `@${item.handle}` : `@${(item.wallet || '').slice(0, 6)}...${(item.wallet || '').slice(-4)}`,
              name: item.handle ? item.handle : `Trader #${idx + 1}`,
              pnlUsd: Math.round(pts * 0.01),
              roiPercent: Math.round((pts / 10000) * 10) / 10,
              winRate: Math.min(95, Math.max(65, 75 + (idx % 15))),
              volumeUsd: Math.round(pts * 0.35),
              tradesCount: Math.max(12, Math.round(pts / 50000)),
            };
          });
          setLeaders(mapped);
        }
      })
      .catch(() => {});
  }, [timeframe]);

  const sorted = [...leaders].sort((a, b) => {
    if (sortBy === 'pnl') return b.pnlUsd - a.pnlUsd;
    if (sortBy === 'roi') return b.roiPercent - a.roiPercent;
    return b.winRate - a.winRate;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="arrow-back" size={20} color={PriestTheme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Global Leaderboard</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Timeframe & Sort Controls */}
        <View style={styles.controlsRow}>
          <View style={styles.tfContainer}>
            {(['7d', '30d', 'all'] as const).map((tf) => (
              <TouchableOpacity
                key={tf}
                style={[styles.tfPill, timeframe === tf && styles.tfPillActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setTimeframe(tf);
                }}
              >
                <Text style={[styles.tfText, timeframe === tf && styles.tfTextActive]}>
                  {tf.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.sortContainer}>
            {(['pnl', 'roi', 'winRate'] as const).map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.sortPill, sortBy === s && styles.sortPillActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSortBy(s);
                }}
              >
                <Text style={[styles.sortText, sortBy === s && styles.sortTextActive]}>
                  {s === 'pnl' ? 'PnL' : s === 'roi' ? 'ROI' : 'Win%'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Podium Top 3 */}
        <View style={styles.podiumContainer}>
          {/* Rank 2 */}
          <View style={[styles.podiumItem, styles.podiumSilver]}>
            <View style={styles.podiumAvatar}>
              <Text style={styles.podiumAvatarText}>🥈</Text>
            </View>
            <Text style={styles.podiumName} numberOfLines={1}>{sorted[1]?.name}</Text>
            <Text style={styles.podiumPnl}>+${(sorted[1]?.pnlUsd / 1000).toFixed(0)}k</Text>
            <Text style={styles.podiumRoi}>+{sorted[1]?.roiPercent.toFixed(0)}% ROI</Text>
          </View>

          {/* Rank 1 (Gold) */}
          <View style={[styles.podiumItem, styles.podiumGold]}>
            <View style={[styles.podiumAvatar, styles.podiumAvatarGold]}>
              <Text style={styles.podiumAvatarText}>👑</Text>
            </View>
            <Text style={styles.podiumName} numberOfLines={1}>{sorted[0]?.name}</Text>
            <Text style={[styles.podiumPnl, { color: PriestTheme.colors.primary, fontSize: 16 }]}>
              +${(sorted[0]?.pnlUsd / 1000).toFixed(0)}k
            </Text>
            <Text style={styles.podiumRoi}>+{sorted[0]?.roiPercent.toFixed(0)}% ROI</Text>
          </View>

          {/* Rank 3 */}
          <View style={[styles.podiumItem, styles.podiumBronze]}>
            <View style={styles.podiumAvatar}>
              <Text style={styles.podiumAvatarText}>🥉</Text>
            </View>
            <Text style={styles.podiumName} numberOfLines={1}>{sorted[2]?.name}</Text>
            <Text style={styles.podiumPnl}>+${(sorted[2]?.pnlUsd / 1000).toFixed(0)}k</Text>
            <Text style={styles.podiumRoi}>+{sorted[2]?.roiPercent.toFixed(0)}% ROI</Text>
          </View>
        </View>

        {/* Full Rankings List */}
        <Text style={styles.sectionHeading}>ALL TRADER RANKINGS</Text>

        {sorted.map((user, idx) => (
          <View key={user.handle} style={styles.traderRow}>
            <View style={styles.rankBadge}>
              <Text style={styles.rankNum}>#{idx + 1}</Text>
            </View>

            <View style={styles.traderInfo}>
              <Text style={styles.traderName}>{user.name}</Text>
              <Text style={styles.traderMeta}>
                @{user.handle} • {user.winRate}% Win • {user.tradesCount} Trades
              </Text>
            </View>

            <View style={styles.traderNumbers}>
              <Text style={styles.traderPnl}>+${user.pnlUsd.toLocaleString()}</Text>
              <Text style={styles.traderRoi}>+{user.roiPercent.toFixed(1)}%</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: PriestTheme.colors.bg0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
  },
  closeBtn: {
    padding: 6,
  },
  title: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 8,
  },
  tfContainer: {
    flexDirection: 'row',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  tfPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  tfPillActive: {
    backgroundColor: PriestTheme.colors.bg4,
  },
  tfText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  tfTextActive: {
    color: PriestTheme.colors.primary,
  },
  sortContainer: {
    flexDirection: 'row',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  sortPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  sortPillActive: {
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  sortText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  sortTextActive: {
    color: PriestTheme.colors.primary,
  },
  podiumContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 24,
    gap: 8,
  },
  podiumItem: {
    flex: 1,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  podiumGold: {
    borderColor: 'rgba(0, 255, 148, 0.4)',
    backgroundColor: 'rgba(0, 255, 148, 0.05)',
    paddingVertical: 18,
  },
  podiumSilver: {
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  podiumBronze: {
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  podiumAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PriestTheme.colors.bg3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  podiumAvatarGold: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  podiumAvatarText: {
    fontSize: 18,
  },
  podiumName: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  podiumPnl: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  podiumRoi: {
    color: PriestTheme.colors.primary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionHeading: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  traderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 8,
    gap: 12,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: PriestTheme.colors.bg3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankNum: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '900',
  },
  traderInfo: {
    flex: 1,
  },
  traderName: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  traderMeta: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  traderNumbers: {
    alignItems: 'flex-end',
  },
  traderPnl: {
    color: PriestTheme.colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  traderRoi: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});
