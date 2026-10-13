import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import { generateOrderBook, fetchLiveOrderBook } from '../lib/api';
import type { OrderBookData } from '../lib/types';

interface OrderBookProps {
  midPrice: number;
  onSelectPrice: (price: number) => void;
  mint?: string;
}

export function OrderBook({ midPrice, onSelectPrice, mint }: OrderBookProps) {
  const [depth, setDepth] = useState<OrderBookData>(() => generateOrderBook(midPrice));

  useEffect(() => {
    if (mint) {
      fetchLiveOrderBook(mint, midPrice).then((live) => {
        if (live && live.bids.length > 0) {
          setDepth(live);
        }
      });
    } else {
      setDepth(generateOrderBook(midPrice));
    }
  }, [mint, midPrice]);

  const maxTotal = Math.max(
    depth.bids[depth.bids.length - 1]?.total || 1,
    depth.asks[depth.asks.length - 1]?.total || 1
  );

  const handlePriceClick = (price: number) => {
    Haptics.selectionAsync();
    onSelectPrice(price);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.headerText}>Price (USDC)</Text>
        <Text style={styles.headerText}>Size</Text>
        <Text style={styles.headerText}>Total</Text>
      </View>

      {/* Asks (Sells, descending) */}
      <View style={styles.sideContainer}>
        {depth.asks.slice(0, 5).reverse().map((ask) => {
          const depthPercent = (ask.total / maxTotal) * 100;
          return (
            <TouchableOpacity
              key={`ask-${ask.price}`}
              style={styles.row}
              onPress={() => handlePriceClick(ask.price)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.depthBar,
                  styles.depthBarAsk,
                  { width: `${depthPercent}%` },
                ]}
              />
              <Text style={styles.askPrice}>{ask.price.toFixed(4)}</Text>
              <Text style={styles.sizeText}>{ask.size.toLocaleString()}</Text>
              <Text style={styles.totalText}>{ask.total.toLocaleString()}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Mid Price & Spread Banner */}
      <View style={styles.spreadBanner}>
        <Text style={styles.midPriceText}>${midPrice.toFixed(4)}</Text>
        <Text style={styles.spreadText}>
          Spread: ${depth.spread.toFixed(4)} ({depth.spreadPercent.toFixed(2)}%)
        </Text>
      </View>

      {/* Bids (Buys, ascending) */}
      <View style={styles.sideContainer}>
        {depth.bids.slice(0, 5).map((bid) => {
          const depthPercent = (bid.total / maxTotal) * 100;
          return (
            <TouchableOpacity
              key={`bid-${bid.price}`}
              style={styles.row}
              onPress={() => handlePriceClick(bid.price)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.depthBar,
                  styles.depthBarBid,
                  { width: `${depthPercent}%` },
                ]}
              />
              <Text style={styles.bidPrice}>{bid.price.toFixed(4)}</Text>
              <Text style={styles.sizeText}>{bid.size.toLocaleString()}</Text>
              <Text style={styles.totalText}>{bid.total.toLocaleString()}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: PriestTheme.colors.bg1,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
    marginBottom: 4,
  },
  headerText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  sideContainer: {
    gap: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    position: 'relative',
    height: 24,
  },
  depthBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    opacity: 0.2,
    borderRadius: 2,
  },
  depthBarAsk: {
    backgroundColor: PriestTheme.colors.danger,
  },
  depthBarBid: {
    backgroundColor: PriestTheme.colors.primary,
  },
  askPrice: {
    color: PriestTheme.colors.danger,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    textAlign: 'left',
    paddingLeft: 4,
  },
  bidPrice: {
    color: PriestTheme.colors.primary,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    textAlign: 'left',
    paddingLeft: 4,
  },
  sizeText: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    textAlign: 'center',
  },
  totalText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    paddingRight: 4,
  },
  spreadBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginVertical: 4,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 8,
  },
  midPriceText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  spreadText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
});
