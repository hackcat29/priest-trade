import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import type { MarketItem, OrderSide, OrderType } from '../lib/types';
import { usePriest } from '../hooks/usePriestState';

interface TradePanelProps {
  market: MarketItem;
  overridePrice?: number | null;
}

const LEVERAGE_STEPS = [2, 5, 10, 20, 25, 40];
const PERCENT_PRESETS = [25, 50, 75, 100];

export function TradePanel({ market, overridePrice }: TradePanelProps) {
  const { wallet, openPosition } = usePriest();
  const [side, setSide] = useState<OrderSide>('Long');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [limitPrice, setLimitPrice] = useState<string>(
    overridePrice ? overridePrice.toString() : market.price.toString()
  );
  const [leverage, setLeverage] = useState<number>(10);
  const [collateralInput, setCollateralInput] = useState<string>('50');
  const [tpEnabled, setTpEnabled] = useState<boolean>(false);
  const [slEnabled, setSlEnabled] = useState<boolean>(false);
  const [tpPrice, setTpPrice] = useState<string>('');
  const [slPrice, setSlPrice] = useState<string>('');

  const currentPrice = orderType === 'limit' && Number(limitPrice) > 0 ? Number(limitPrice) : market.price;
  const collateral = Number(collateralInput) || 0;
  const positionSizeUsd = collateral * leverage;
  const maxAllowedLeverage = market.isWarmup ? 10 : market.maxLeverage;

  // Liquidation calculation
  const liqDistance = (currentPrice * 0.9) / leverage;
  const estLiqPrice =
    side === 'Long'
      ? Math.max(0.0001, currentPrice - liqDistance)
      : currentPrice + liqDistance;

  // Fee calculation (0.10% taker fee per protocol specification)
  const estFee = positionSizeUsd * 0.001;

  const handleSideChange = (newSide: OrderSide) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSide(newSide);
  };

  const handlePercentPreset = (pct: number) => {
    Haptics.selectionAsync();
    const amount = (wallet.freeCollateralUsd * (pct / 100)).toFixed(2);
    setCollateralInput(amount);
  };

  const handleLeverageSelect = (lev: number) => {
    if (lev > maxAllowedLeverage) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        'Warmup Leverage Cap',
        `This market is in its 24h warmup phase. Max leverage is capped at 10x to protect protocol solvency.`
      );
      setLeverage(maxAllowedLeverage);
      return;
    }
    Haptics.selectionAsync();
    setLeverage(lev);
  };

  const handleExecuteTrade = () => {
    if (collateral <= 0) {
      Alert.alert('Invalid Margin', 'Please specify a collateral amount to open.');
      return;
    }
    if (collateral > wallet.freeCollateralUsd) {
      Alert.alert('Insufficient Balance', 'You do not have enough free USDC collateral.');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const result = openPosition({
      mint: market.mint,
      symbol: market.symbol,
      side,
      sizeUsd: positionSizeUsd,
      leverage,
      entryPrice: currentPrice,
    });

    if (result.success) {
      Alert.alert(
        'Order Executed! 🚀',
        `${side} ${positionSizeUsd.toFixed(2)} USD of ${market.symbol} at ${leverage}x leverage placed successfully on the ${market.engine} engine.`
      );
    } else {
      Alert.alert('Execution Error', result.error || 'Failed to place order.');
    }
  };

  return (
    <View style={styles.container}>
      {/* Long / Short Switcher */}
      <View style={styles.sideSwitcher}>
        <TouchableOpacity
          style={[styles.sideTab, side === 'Long' && styles.sideTabLongActive]}
          onPress={() => handleSideChange('Long')}
          activeOpacity={0.8}
        >
          <Text style={[styles.sideText, side === 'Long' && styles.sideTextLong]}>
            Long (Bullish)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.sideTab, side === 'Short' && styles.sideTabShortActive]}
          onPress={() => handleSideChange('Short')}
          activeOpacity={0.8}
        >
          <Text style={[styles.sideText, side === 'Short' && styles.sideTextShort]}>
            Short (Bearish)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Order Type: Market / Limit */}
      <View style={styles.orderTypeRow}>
        <TouchableOpacity
          style={[styles.typeBtn, orderType === 'market' && styles.typeBtnActive]}
          onPress={() => setOrderType('market')}
        >
          <Text style={[styles.typeBtnText, orderType === 'market' && styles.typeBtnTextActive]}>
            Market
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeBtn, orderType === 'limit' && styles.typeBtnActive]}
          onPress={() => setOrderType('limit')}
        >
          <Text style={[styles.typeBtnText, orderType === 'limit' && styles.typeBtnTextActive]}>
            Limit
          </Text>
        </TouchableOpacity>
      </View>

      {/* Limit Price Input (if applicable) */}
      {orderType === 'limit' && (
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Limit Price (USDC)</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              value={limitPrice}
              onChangeText={setLimitPrice}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={PriestTheme.colors.textMuted}
            />
            <Text style={styles.inputSuffix}>USDC</Text>
          </View>
        </View>
      )}

      {/* Leverage Selector */}
      <View style={styles.section}>
        <View style={styles.leverageHeader}>
          <Text style={styles.sectionLabel}>Leverage: {leverage}x</Text>
          {market.isWarmup && (
            <View style={styles.warmupBadge}>
              <Ionicons name="shield-checkmark" size={10} color={PriestTheme.colors.warning} />
              <Text style={styles.warmupText}>10x Warmup Cap</Text>
            </View>
          )}
        </View>
        <View style={styles.leverageRow}>
          {LEVERAGE_STEPS.map((lev) => {
            const isSelected = leverage === lev;
            const isExceeded = lev > maxAllowedLeverage;
            return (
              <TouchableOpacity
                key={lev}
                style={[
                  styles.leveragePill,
                  isSelected && styles.leveragePillActive,
                  isExceeded && styles.leveragePillDisabled,
                ]}
                onPress={() => handleLeverageSelect(lev)}
              >
                <Text
                  style={[
                    styles.leverageText,
                    isSelected && styles.leverageTextActive,
                    isExceeded && styles.leverageTextDisabled,
                  ]}
                >
                  {lev}x
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Collateral Input */}
      <View style={styles.section}>
        <View style={styles.balanceHeader}>
          <Text style={styles.sectionLabel}>Margin Collateral</Text>
          <Text style={styles.balanceNote}>
            Avail: ${wallet.freeCollateralUsd.toFixed(2)} USDC
          </Text>
        </View>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={collateralInput}
            onChangeText={setCollateralInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={PriestTheme.colors.textMuted}
          />
          <Text style={styles.inputSuffix}>USDC</Text>
        </View>

        {/* Quick Percent Buttons */}
        <View style={styles.presetRow}>
          {PERCENT_PRESETS.map((pct) => (
            <TouchableOpacity
              key={pct}
              style={styles.presetBtn}
              onPress={() => handlePercentPreset(pct)}
            >
              <Text style={styles.presetText}>{pct}%</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Position Preview Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Position Notional</Text>
          <Text style={styles.summaryValue}>${positionSizeUsd.toFixed(2)} USDC</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Est. Liquidation Price</Text>
          <Text style={[styles.summaryValue, { color: PriestTheme.colors.danger }]}>
            ${estLiqPrice.toFixed(4)}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Protocol Fee (0.10%)</Text>
          <Text style={styles.summaryValue}>${estFee.toFixed(3)} USDC</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Engine</Text>
          <Text style={[styles.summaryValue, { color: PriestTheme.colors.primary }]}>
            {market.engine}
          </Text>
        </View>
      </View>

      {/* Action Submit Button */}
      <TouchableOpacity
        style={[
          styles.actionButton,
          side === 'Long' ? styles.actionButtonLong : styles.actionButtonShort,
        ]}
        onPress={handleExecuteTrade}
        activeOpacity={0.8}
      >
        <Text style={styles.actionButtonText}>
          {side === 'Long' ? 'Open Long' : 'Open Short'} {market.symbol}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: PriestTheme.colors.bg1,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 20,
  },
  sideSwitcher: {
    flexDirection: 'row',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  sideTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  sideTabLongActive: {
    backgroundColor: PriestTheme.colors.primary,
  },
  sideTabShortActive: {
    backgroundColor: PriestTheme.colors.danger,
  },
  sideText: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '800',
  },
  sideTextLong: {
    color: '#000000',
  },
  sideTextShort: {
    color: '#FFFFFF',
  },
  orderTypeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  typeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: PriestTheme.colors.bg2,
  },
  typeBtnActive: {
    backgroundColor: PriestTheme.colors.bg4,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  typeBtnText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  typeBtnTextActive: {
    color: PriestTheme.colors.textPrimary,
  },
  section: {
    marginBottom: 14,
  },
  sectionLabel: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  balanceNote: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    height: 44,
    color: PriestTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  inputSuffix: {
    color: PriestTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 6,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  presetText: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  leverageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  warmupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: PriestTheme.colors.warningDim,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  warmupText: {
    color: PriestTheme.colors.warning,
    fontSize: 10,
    fontWeight: '700',
  },
  leverageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  leveragePill: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  leveragePillActive: {
    borderColor: PriestTheme.colors.primary,
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  leveragePillDisabled: {
    opacity: 0.35,
  },
  leverageText: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  leverageTextActive: {
    color: PriestTheme.colors.primary,
  },
  leverageTextDisabled: {
    color: PriestTheme.colors.textMuted,
  },
  summaryCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
  },
  summaryValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  actionButton: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonLong: {
    backgroundColor: PriestTheme.colors.primary,
  },
  actionButtonShort: {
    backgroundColor: PriestTheme.colors.danger,
  },
  actionButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
