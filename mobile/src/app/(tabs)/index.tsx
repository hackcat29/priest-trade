import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  RefreshControl,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../../constants/theme';
import { Header } from '../../components/Header';
import { MarketCard } from '../../components/MarketCard';
import { usePriest } from '../../hooks/usePriestState';
import type { MarketItem } from '../../lib/types';
import { INITIAL_STREAMS } from '../../lib/api';

const FILTERS = ['All', 'Trending', 'vAMM Primary', 'DLOB Graduated', 'Graduating', 'Monad'] as const;

export default function DiscoverScreen() {
  const router = useRouter();
  const { markets, setSelectedMarket, refreshMarkets } = usePriest();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<(typeof FILTERS)[number]>('All');
  const [refreshing, setRefreshing] = useState(false);

  const featuredMarket = markets[0];

  const liveStreamPills = useMemo(() => {
    if (markets && markets.length > 0) {
      return markets.slice(0, 4).map((m, idx) => ({
        id: `pill-${m.mint}`,
        streamerName:
          idx === 0
            ? 'CryptoCobie'
            : idx === 1
            ? 'Sarah Jenkins'
            : idx === 2
            ? 'Alex Thorne'
            : 'Monad Chad',
        tokenSymbol: m.symbol,
        viewers: Math.max(300, 1420 - idx * 280),
      }));
    }
    return INITIAL_STREAMS;
  }, [markets]);

  const filteredMarkets = useMemo(() => {
    return markets.filter((m) => {
      const matchesSearch =
        m.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.name.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (selectedFilter === 'vAMM Primary') return m.engine === 'vAMM';
      if (selectedFilter === 'DLOB Graduated') return m.engine === 'HybridDLOB' || m.engine === 'SecondaryAMM';
      if (selectedFilter === 'Graduating') return m.graduationPercent > 60 && m.graduationPercent < 100;
      if (selectedFilter === 'Monad') return m.chain === 'monad';
      return true;
    });
  }, [markets, searchQuery, selectedFilter]);

  const handleSelectMarket = (market: MarketItem) => {
    setSelectedMarket(market);
    router.push('/(tabs)/trade');
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await refreshMarkets();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Discover Markets" />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={PriestTheme.colors.primary}
          />
        }
      >
        {/* Hero Featured Market Banner */}
        {featuredMarket && (
          <TouchableOpacity
            style={styles.heroBanner}
            onPress={() => handleSelectMarket(featuredMarket)}
            activeOpacity={0.85}
          >
            <View style={styles.heroBadgeRow}>
              <View style={styles.heroHotPill}>
                <Ionicons name="flame" size={12} color="#000000" />
                <Text style={styles.heroHotText}>FEATURED GRADUATE</Text>
              </View>
              <Text style={styles.heroChainText}>
                {featuredMarket.chain.toUpperCase()} • 40X LEVERAGE
              </Text>
            </View>

            <View style={styles.heroMainRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {featuredMarket.imageUri ? (
                  <Image source={{ uri: featuredMarket.imageUri }} style={styles.heroTokenImg} />
                ) : (
                  <View style={styles.heroTokenImgPlaceholder}>
                    <Text style={styles.heroTokenImgInitial}>
                      {featuredMarket.symbol.slice(0, 2)}
                    </Text>
                  </View>
                )}
                <View>
                  <Text style={styles.heroSymbol}>${featuredMarket.symbol}</Text>
                  <Text style={styles.heroName}>{featuredMarket.name}</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.heroPrice}>${featuredMarket.price.toFixed(4)}</Text>
                <Text
                  style={[
                    styles.heroChange,
                    {
                      color:
                        featuredMarket.priceChange24h >= 0
                          ? PriestTheme.colors.primary
                          : PriestTheme.colors.danger,
                    },
                  ]}
                >
                  {featuredMarket.priceChange24h >= 0 ? '+' : ''}
                  {featuredMarket.priceChange24h.toFixed(1)}% 24h
                </Text>
              </View>
            </View>

            <View style={styles.heroFooter}>
              <View style={styles.heroVolItem}>
                <Text style={styles.heroVolLabel}>24h Volume</Text>
                <Text style={styles.heroVolValue}>
                  ${(featuredMarket.volume24h / 1000000).toFixed(2)}M
                </Text>
              </View>
              <View style={styles.heroVolItem}>
                <Text style={styles.heroVolLabel}>Engine</Text>
                <Text style={[styles.heroVolValue, { color: PriestTheme.colors.primary }]}>
                  {featuredMarket.engine}
                </Text>
              </View>
              <View style={styles.tradeNowBtn}>
                <Text style={styles.tradeNowText}>Trade Now</Text>
                <Ionicons name="arrow-forward" size={13} color="#000000" />
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Action Shortcuts Grid */}
        <View style={styles.actionGrid}>
          <TouchableOpacity
            style={[styles.actionCard, { borderColor: 'rgba(0, 255, 148, 0.3)' }]}
            onPress={() => router.push('/launch')}
          >
            <View style={[styles.actionIcon, { backgroundColor: PriestTheme.colors.primaryDim }]}>
              <Ionicons name="rocket" size={17} color={PriestTheme.colors.primary} />
            </View>
            <Text style={styles.actionTitle}>Launch Token</Text>
            <Text style={styles.actionSub}>Zero code fair perp</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { borderColor: 'rgba(131, 110, 249, 0.3)' }]}
            onPress={() => router.push('/copy')}
          >
            <View style={[styles.actionIcon, { backgroundColor: PriestTheme.colors.purpleDim }]}>
              <Ionicons name="people" size={17} color={PriestTheme.colors.purple} />
            </View>
            <Text style={styles.actionTitle}>Copy Vaults</Text>
            <Text style={styles.actionSub}>Follow top 1% PnL</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.actionGrid, { marginTop: -6, marginBottom: 16 }]}>
          <TouchableOpacity
            style={[styles.actionCard, { borderColor: 'rgba(56, 189, 248, 0.3)' }]}
            onPress={() => router.push('/counterflow')}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
              <Ionicons name="water" size={17} color="#38BDF8" />
            </View>
            <Text style={styles.actionTitle}>Counterflow</Text>
            <Text style={styles.actionSub}>Earn LP vault yield</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { borderColor: 'rgba(255, 184, 0, 0.3)' }]}
            onPress={() => router.push('/list')}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(255, 184, 0, 0.15)' }]}>
              <Ionicons name="flash" size={17} color="#FFB800" />
            </View>
            <Text style={styles.actionTitle}>List Token</Text>
            <Text style={styles.actionSub}>Perps on spot pools</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Utility Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickChipsScroll}
          contentContainerStyle={styles.quickChipsContent}
        >
          <TouchableOpacity
            style={styles.quickChip}
            onPress={() => router.push('/leaderboard')}
          >
            <Ionicons name="trophy-outline" size={14} color={PriestTheme.colors.warning} />
            <Text style={styles.quickChipText}>Leaderboard</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickChip}
            onPress={() => router.push('/faucet')}
          >
            <Ionicons name="water-outline" size={14} color={PriestTheme.colors.info} />
            <Text style={styles.quickChipText}>Faucet</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickChip}
            onPress={() => router.push('/support')}
          >
            <Ionicons name="help-buoy-outline" size={14} color={PriestTheme.colors.primary} />
            <Text style={styles.quickChipText}>Status & FAQ</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickChip}
            onPress={() => router.push('/profile')}
          >
            <Ionicons name="person-outline" size={14} color={PriestTheme.colors.purple} />
            <Text style={styles.quickChipText}>Creator Profile</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Live Streamers Mini Bar */}
        <View style={styles.streamsSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <View style={styles.liveDot} />
              <Text style={styles.sectionTitle}>Live Trading Streams</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/live')}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.streamsScroll}>
            {liveStreamPills.map((stream) => (
              <TouchableOpacity
                key={stream.id}
                style={styles.streamPill}
                onPress={() => router.push('/(tabs)/live')}
              >
                <View style={styles.streamerAvatar}>
                  <Text style={styles.streamerInitial}>{stream.streamerName[0]}</Text>
                </View>
                <View>
                  <Text style={styles.streamerName}>{stream.streamerName}</Text>
                  <Text style={styles.streamToken}>
                    ${stream.tokenSymbol} • {stream.viewers} watching
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Search Bar */}
        <View style={styles.searchWrapper}>
          <Ionicons name="search" size={16} color={PriestTheme.colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search perpetuals by token or symbol..."
            placeholderTextColor={PriestTheme.colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={16} color={PriestTheme.colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersScroll}
          contentContainerStyle={styles.filtersContainer}
        >
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              style={[
                styles.filterPill,
                selectedFilter === f && styles.filterPillActive,
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setSelectedFilter(f);
              }}
            >
              <Text
                style={[
                  styles.filterText,
                  selectedFilter === f && styles.filterTextActive,
                ]}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Market List */}
        <View style={styles.marketsHeader}>
          <Text style={styles.marketsCount}>
            {filteredMarkets.length} Markets Available
          </Text>
        </View>

        {filteredMarkets.map((market) => (
          <MarketCard
            key={market.mint}
            market={market}
            onPress={handleSelectMarket}
          />
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
  container: {
    flex: 1,
    backgroundColor: PriestTheme.colors.bg0,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  heroBanner: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 148, 0.3)',
    marginBottom: 16,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  heroHotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  heroHotText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '900',
  },
  heroChainText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  heroMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroTokenImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 148, 0.4)',
    backgroundColor: '#000000',
  },
  heroTokenImgPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 148, 0.4)',
    backgroundColor: PriestTheme.colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTokenImgInitial: {
    color: PriestTheme.colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  heroSymbol: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  heroName: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  heroPrice: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
  },
  heroChange: {
    color: PriestTheme.colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  heroFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: PriestTheme.colors.border,
    paddingTop: 12,
  },
  heroVolItem: {
    gap: 2,
  },
  heroVolLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
  },
  heroVolValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  tradeNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 4,
  },
  tradeNowText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  actionCard: {
    flex: 1,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
  },
  quickChipsScroll: {
    marginBottom: 16,
  },
  quickChipsContent: {
    flexDirection: 'row',
    gap: 8,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PriestTheme.colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: PriestTheme.colors.textPrimary,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  actionSub: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  streamsSection: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PriestTheme.colors.danger,
  },
  sectionTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  seeAllText: {
    color: PriestTheme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  streamsScroll: {
    flexDirection: 'row',
  },
  streamPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    padding: 8,
    paddingRight: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginRight: 10,
    gap: 8,
  },
  streamerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PriestTheme.colors.bg3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streamerInitial: {
    color: PriestTheme.colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  streamerName: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  streamToken: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 10,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
  },
  filtersScroll: {
    marginBottom: 14,
  },
  filtersContainer: {
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: PriestTheme.colors.bg2,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  filterPillActive: {
    backgroundColor: PriestTheme.colors.primaryDim,
    borderColor: PriestTheme.colors.primary,
  },
  filterText: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  filterTextActive: {
    color: PriestTheme.colors.primary,
  },
  marketsHeader: {
    marginBottom: 10,
  },
  marketsCount: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
});
