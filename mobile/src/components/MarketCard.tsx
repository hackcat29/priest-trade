import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import type { MarketItem } from '../lib/types';

interface MarketCardProps {
  market: MarketItem;
  onPress: (market: MarketItem) => void;
  compact?: boolean;
}

export function MarketCard({ market, onPress, compact = false }: MarketCardProps) {
  const isPositive = market.priceChange24h >= 0;

  const handlePress = () => {
    Haptics.selectionAsync();
    onPress(market);
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handlePress}
      activeOpacity={0.75}
    >
      {/* Top Row: Symbol, Engine Badge, Price */}
      <View style={styles.topRow}>
        <View style={styles.tokenInfo}>
          {market.imageUri ? (
            <Image
              source={{ uri: market.imageUri }}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{market.symbol.slice(0, 2)}</Text>
            </View>
          )}
          <View>
            <View style={styles.symbolRow}>
              <Text style={styles.symbol}>{market.symbol}</Text>
              <View
                style={[
                  styles.engineBadge,
                  market.engine === 'HybridDLOB' ? styles.engineBadgeDLOB : styles.engineBadgeVAMM,
                ]}
              >
                <Text
                  style={[
                    styles.engineText,
                    market.engine === 'HybridDLOB'
                      ? styles.engineTextDLOB
                      : styles.engineTextVAMM,
                  ]}
                >
                  {market.engine}
                </Text>
              </View>
            </View>
            <Text style={styles.tokenName} numberOfLines={1}>
              {market.name}
            </Text>
          </View>
        </View>

        {/* Price & Change */}
        <View style={styles.priceContainer}>
          <Text style={styles.price}>
            ${market.price < 0.01 ? market.price.toFixed(5) : market.price.toFixed(3)}
          </Text>
          <View
            style={[
              styles.changeBadge,
              isPositive ? styles.changeBadgePos : styles.changeBadgeNeg,
            ]}
          >
            <Ionicons
              name={isPositive ? 'trending-up' : 'trending-down'}
              size={12}
              color={isPositive ? PriestTheme.colors.primary : PriestTheme.colors.danger}
            />
            <Text
              style={[
                styles.changeText,
                isPositive ? styles.changeTextPos : styles.changeTextNeg,
              ]}
            >
              {isPositive ? '+' : ''}
              {market.priceChange24h.toFixed(2)}%
            </Text>
          </View>
        </View>
      </View>

      {/* Middle Row: Metrics */}
      <View style={styles.metricsRow}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>24h Vol</Text>
          <Text style={styles.metricValue}>
            ${(market.volume24h / 1000).toFixed(0)}k
          </Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Open Int.</Text>
          <Text style={styles.metricValue}>
            ${(market.openInterest / 1000).toFixed(0)}k
          </Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Funding</Text>
          <Text
            style={[
              styles.metricValue,
              { color: market.fundingRate >= 0 ? PriestTheme.colors.primary : PriestTheme.colors.danger },
            ]}
          >
            {(market.fundingRate * 100).toFixed(3)}%
          </Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Max Lev</Text>
          <Text style={[styles.metricValue, { color: PriestTheme.colors.warning }]}>
            {market.maxLeverage}x
          </Text>
        </View>
      </View>

      {/* Bottom Row: Graduation Progress Meter */}
      {!compact && (
        <View style={styles.graduationContainer}>
          <View style={styles.graduationHeader}>
            <View style={styles.graduationLabelRow}>
              <Ionicons
                name={market.graduationPercent >= 100 ? 'checkmark-circle' : 'rocket'}
                size={12}
                color={
                  market.graduationPercent >= 100
                    ? PriestTheme.colors.primary
                    : PriestTheme.colors.warning
                }
              />
              <Text style={styles.graduationLabel}>
                {market.graduationPercent >= 100
                  ? 'Graduated to Uniswap v4 LP + DLOB'
                  : `Graduation Progress ($2M Vol Gate)`}
              </Text>
            </View>
            <Text style={styles.graduationPercent}>
              {market.graduationPercent.toFixed(1)}%
            </Text>
          </View>
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.min(100, market.graduationPercent)}%`,
                  backgroundColor:
                    market.graduationPercent >= 100
                      ? PriestTheme.colors.primary
                      : PriestTheme.colors.warning,
                },
              ]}
            />
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 12,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tokenInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PriestTheme.colors.bg3,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PriestTheme.colors.bg3,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 148, 0.3)',
  },
  avatarText: {
    color: PriestTheme.colors.primary,
    fontWeight: '800',
    fontSize: 14,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  symbol: {
    color: PriestTheme.colors.textPrimary,
    fontWeight: '800',
    fontSize: 16,
  },
  tokenName: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    maxWidth: 120,
  },
  engineBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  engineBadgeVAMM: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  engineBadgeDLOB: {
    backgroundColor: 'rgba(0, 255, 148, 0.12)',
  },
  engineText: {
    fontSize: 10,
    fontWeight: '700',
  },
  engineTextVAMM: {
    color: PriestTheme.colors.info,
  },
  engineTextDLOB: {
    color: PriestTheme.colors.primary,
  },
  priceContainer: {
    alignItems: 'flex-end',
  },
  price: {
    color: PriestTheme.colors.textPrimary,
    fontWeight: '800',
    fontSize: 16,
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
    gap: 3,
  },
  changeBadgePos: {
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  changeBadgeNeg: {
    backgroundColor: PriestTheme.colors.dangerDim,
  },
  changeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  changeTextPos: {
    color: PriestTheme.colors.primary,
  },
  changeTextNeg: {
    color: PriestTheme.colors.danger,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  metricItem: {
    alignItems: 'center',
  },
  metricLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  metricValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  graduationContainer: {
    marginTop: 12,
  },
  graduationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  graduationLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  graduationLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  graduationPercent: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
});
