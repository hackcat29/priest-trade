import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../../constants/theme';
import { CandleChart } from '../../components/CandleChart';
import { OrderBook } from '../../components/OrderBook';
import { usePriest } from '../../hooks/usePriestState';
import { fetchLiveTrades, type LiveTradeItem } from '../../lib/api';

export default function MarketDetailScreen() {
  const router = useRouter();
  const { mint } = useLocalSearchParams<{ mint: string }>();
  const { markets, setSelectedMarket } = usePriest();

  const market = markets.find((m) => m.mint === mint) || markets[0];
  const isUp = market.priceChange24h >= 0;
  const [recentTrades, setRecentTrades] = useState<LiveTradeItem[]>([]);

  React.useEffect(() => {
    if (market?.mint) {
      fetchLiveTrades(market.mint, 15, market.price).then((trades) => {
        if (trades && trades.length > 0) {
          setRecentTrades(trades);
        }
      });
    }
  }, [market?.mint, market?.price]);

  const handleTradeSide = (side: 'Long' | 'Short') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedMarket(market);
    router.replace('/(tabs)/trade');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={PriestTheme.colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerSymbol}>{market.symbol}</Text>
          <Text style={styles.headerEngine}>{market.engine} • {market.chain.toUpperCase()}</Text>
        </View>
        <TouchableOpacity style={styles.favoriteBtn}>
          <Ionicons name="star-outline" size={18} color={PriestTheme.colors.warning} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Price Hero */}
        <View style={styles.priceHero}>
          <View>
            <Text style={styles.priceText}>
              ${market.price < 0.01 ? market.price.toFixed(5) : market.price.toFixed(4)}
            </Text>
            <View style={styles.changeRow}>
              <Ionicons
                name={isUp ? 'trending-up' : 'trending-down'}
                size={14}
                color={isUp ? PriestTheme.colors.primary : PriestTheme.colors.danger}
              />
              <Text
                style={[
                  styles.changeText,
                  { color: isUp ? PriestTheme.colors.primary : PriestTheme.colors.danger },
                ]}
              >
                {isUp ? '+' : ''}{market.priceChange24h.toFixed(2)}% (24h)
              </Text>
            </View>
          </View>

          <View style={styles.heroMetrics}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>24h High</Text>
              <Text style={styles.metricValue}>${market.high24h.toFixed(4)}</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>24h Low</Text>
              <Text style={styles.metricValue}>${market.low24h.toFixed(4)}</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Open Interest</Text>
              <Text style={styles.metricValue}>${(market.openInterest / 1000).toFixed(0)}k</Text>
            </View>
          </View>
        </View>

        {/* Candlestick Chart */}
        <CandleChart basePrice={market.price} symbol={market.symbol} mint={market.mint} />

        {/* Graduation Gate Card */}
        <View style={styles.graduationCard}>
          <View style={styles.gradTop}>
            <Ionicons name="rocket" size={16} color={PriestTheme.colors.warning} />
            <Text style={styles.gradTitle}>Lifecycle Graduation Gate ($2M)</Text>
          </View>
          <Text style={styles.gradDesc}>
            Current Volume: ${(market.graduationVolumeCurrent / 1000000).toFixed(2)}M / $2.00M Target.
            Once triggered, 69 SOL/MON will be seeded into Uniswap v4 pool & LP tokens burned on-chain.
          </Text>
          <View style={styles.gradTrack}>
            <View
              style={[
                styles.gradFill,
                { width: `${Math.min(100, market.graduationPercent)}%` },
              ]}
            />
          </View>
        </View>

        {/* Order Book Depth */}
        <OrderBook midPrice={market.price} mint={market.mint} onSelectPrice={() => {}} />

        {/* Recent Trades Stream */}
        <View style={styles.tradesSection}>
          <Text style={styles.sectionTitle}>Recent Trades</Text>
          <View style={styles.tradesTable}>
            {recentTrades.map((trade) => (
              <View key={trade.id} style={styles.tradeRow}>
                <View style={styles.tradeSideCol}>
                  <Text
                    style={[
                      styles.tradeSideText,
                      { color: trade.side === 'Long' ? PriestTheme.colors.primary : PriestTheme.colors.danger },
                    ]}
                  >
                    {trade.side}
                  </Text>
                  {trade.isWhale && (
                    <View style={styles.whaleBadge}>
                      <Text style={styles.whaleText}>WHALE</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.tradePrice}>${trade.price.toFixed(4)}</Text>
                <Text style={styles.tradeSize}>{trade.size}</Text>
                <Text style={styles.tradeTime}>{trade.time}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Sticky Bottom Quick Trade Bar */}
      <View style={styles.stickyTradeBar}>
        <TouchableOpacity
          style={[styles.tradeBtn, styles.tradeBtnLong]}
          onPress={() => handleTradeSide('Long')}
          activeOpacity={0.8}
        >
          <Text style={styles.tradeBtnTextLong}>Long {market.symbol}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tradeBtn, styles.tradeBtnShort]}
          onPress={() => handleTradeSide('Short')}
          activeOpacity={0.8}
        >
          <Text style={styles.tradeBtnTextShort}>Short {market.symbol}</Text>
        </TouchableOpacity>
      </View>
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
  backBtn: {
    padding: 6,
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerSymbol: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  headerEngine: {
    color: PriestTheme.colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  favoriteBtn: {
    padding: 6,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 80,
  },
  priceHero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  priceText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  changeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  heroMetrics: {
    alignItems: 'flex-end',
    gap: 4,
  },
  metricItem: {
    flexDirection: 'row',
    gap: 8,
  },
  metricLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
  },
  metricValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  graduationCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    marginBottom: 16,
  },
  gradTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  gradTitle: {
    color: PriestTheme.colors.warning,
    fontSize: 13,
    fontWeight: '800',
  },
  gradDesc: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
  },
  gradTrack: {
    height: 4,
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  gradFill: {
    height: '100%',
    backgroundColor: PriestTheme.colors.warning,
  },
  tradesSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 10,
  },
  tradesTable: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  tradeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
  },
  tradeSideCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 70,
  },
  tradeSideText: {
    fontSize: 12,
    fontWeight: '800',
  },
  whaleBadge: {
    backgroundColor: 'rgba(0, 255, 148, 0.15)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  whaleText: {
    color: PriestTheme.colors.primary,
    fontSize: 8,
    fontWeight: '900',
  },
  tradePrice: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  tradeSize: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
  },
  tradeTime: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
  },
  stickyTradeBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: PriestTheme.colors.bg1,
    borderTopWidth: 1,
    borderTopColor: PriestTheme.colors.border,
    gap: 12,
  },
  tradeBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tradeBtnLong: {
    backgroundColor: PriestTheme.colors.primary,
  },
  tradeBtnShort: {
    backgroundColor: PriestTheme.colors.danger,
  },
  tradeBtnTextLong: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },
  tradeBtnTextShort: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
