import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import type { PositionItem } from '../lib/types';
import { usePriest } from '../hooks/usePriestState';

interface PositionCardProps {
  position: PositionItem;
  onSharePnl: (position: PositionItem) => void;
}

export function PositionCard({ position, onSharePnl }: PositionCardProps) {
  const { closePosition } = usePriest();
  const isProfit = position.pnlUsd >= 0;

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Close Position',
      `Are you sure you want to market close your ${position.side} ${position.symbol} position?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Close',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            closePosition(position.id);
          },
        },
      ]
    );
  };

  const handleShare = () => {
    Haptics.selectionAsync();
    onSharePnl(position);
  };

  return (
    <View style={styles.card}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.symbol}>{position.symbol}</Text>
          <View
            style={[
              styles.sideBadge,
              position.side === 'Long' ? styles.sideBadgeLong : styles.sideBadgeShort,
            ]}
          >
            <Text
              style={[
                styles.sideText,
                position.side === 'Long' ? styles.sideTextLong : styles.sideTextShort,
              ]}
            >
              {position.side} {position.leverage}x
            </Text>
          </View>
        </View>

        {/* PnL & ROE Display */}
        <View style={styles.pnlContainer}>
          <Text
            style={[
              styles.pnlUsd,
              { color: isProfit ? PriestTheme.colors.primary : PriestTheme.colors.danger },
            ]}
          >
            {isProfit ? '+' : ''}${position.pnlUsd.toFixed(2)}
          </Text>
          <Text
            style={[
              styles.pnlPercent,
              { color: isProfit ? PriestTheme.colors.primary : PriestTheme.colors.danger },
            ]}
          >
            {isProfit ? '+' : ''}{position.roePercent.toFixed(2)}% ROE
          </Text>
        </View>
      </View>

      {/* Grid Meta */}
      <View style={styles.grid}>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Size</Text>
          <Text style={styles.gridValue}>{position.size.toLocaleString()}</Text>
        </View>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Entry Price</Text>
          <Text style={styles.gridValue}>${position.entryPrice.toFixed(4)}</Text>
        </View>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Mark Price</Text>
          <Text style={styles.gridValue}>${position.markPrice.toFixed(4)}</Text>
        </View>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Est. Liq Price</Text>
          <Text style={[styles.gridValue, { color: PriestTheme.colors.danger }]}>
            ${position.liquidationPrice.toFixed(4)}
          </Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.shareBtn}
          onPress={handleShare}
          activeOpacity={0.8}
        >
          <Ionicons name="share-social-outline" size={15} color={PriestTheme.colors.primary} />
          <Text style={styles.shareBtnText}>Share PnL</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.closeBtn}
          onPress={handleClose}
          activeOpacity={0.8}
        >
          <Text style={styles.closeBtnText}>Close Position</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  symbol: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  sideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sideBadgeLong: {
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  sideBadgeShort: {
    backgroundColor: PriestTheme.colors.dangerDim,
  },
  sideText: {
    fontSize: 11,
    fontWeight: '800',
  },
  sideTextLong: {
    color: PriestTheme.colors.primary,
  },
  sideTextShort: {
    color: PriestTheme.colors.danger,
  },
  pnlContainer: {
    alignItems: 'flex-end',
  },
  pnlUsd: {
    fontSize: 18,
    fontWeight: '900',
  },
  pnlPercent: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  gridItem: {
    alignItems: 'center',
  },
  gridLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  gridValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: PriestTheme.colors.bg3,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 148, 0.3)',
    gap: 6,
  },
  shareBtnText: {
    color: PriestTheme.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  closeBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  closeBtnText: {
    color: PriestTheme.colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});
