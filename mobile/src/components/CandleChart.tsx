import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import type { CandleDataPoint } from '../lib/types';
import { generateCandles, fetchLiveCandles } from '../lib/api';

interface CandleChartProps {
  basePrice: number;
  symbol: string;
  mint?: string;
}

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d'] as const;

export function CandleChart({ basePrice, symbol, mint }: CandleChartProps) {
  const [selectedTf, setSelectedTf] = useState<(typeof TIMEFRAMES)[number]>('5m');
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle');
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [candles, setCandles] = useState<CandleDataPoint[]>(() => generateCandles(basePrice, 24));

  useEffect(() => {
    if (mint) {
      fetchLiveCandles(mint, selectedTf, 24, basePrice).then((live) => {
        if (live && live.length > 0) {
          setCandles(live);
        }
      });
    } else {
      setCandles(generateCandles(basePrice, 24));
    }
  }, [mint, basePrice, selectedTf]);

  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const c of candles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }
    const range = max - min || 1;
    return { minPrice: min, maxPrice: max, priceRange: range };
  }, [candles]);

  const activeCandle = scrubIndex !== null ? candles[scrubIndex] : candles[candles.length - 1];
  const isUp = activeCandle ? activeCandle.close >= activeCandle.open : true;

  const handleTfPress = (tf: (typeof TIMEFRAMES)[number]) => {
    Haptics.selectionAsync();
    setSelectedTf(tf);
    setScrubIndex(null);
  };

  const chartHeight = 160;

  return (
    <View style={styles.container}>
      {/* Chart Top Bar: Price Info & Timeframe Selectors */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.currentPrice}>
            ${activeCandle ? activeCandle.close.toFixed(4) : basePrice.toFixed(4)}
          </Text>
          <Text style={[styles.priceChange, { color: isUp ? PriestTheme.colors.primary : PriestTheme.colors.danger }]}>
            {isUp ? '▲' : '▼'}{' '}
            {activeCandle
              ? (((activeCandle.close - activeCandle.open) / activeCandle.open) * 100).toFixed(2)
              : '0.00'}
            %
          </Text>
        </View>

        {/* Timeframe Buttons */}
        <View style={styles.tfContainer}>
          {TIMEFRAMES.map((tf) => (
            <TouchableOpacity
              key={tf}
              style={[styles.tfButton, selectedTf === tf && styles.tfButtonActive]}
              onPress={() => handleTfPress(tf)}
            >
              <Text style={[styles.tfText, selectedTf === tf && styles.tfTextActive]}>
                {tf}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Main Chart Canvas Area */}
      <View style={[styles.chartArea, { height: chartHeight }]}>
        {/* High & Low Watermarks */}
        <View style={styles.watermarkContainer}>
          <Text style={styles.watermarkText}>H: ${maxPrice.toFixed(4)}</Text>
          <Text style={styles.watermarkText}>L: ${minPrice.toFixed(4)}</Text>
        </View>

        {/* Candlestick Bars */}
        <View style={styles.barsContainer}>
          {candles.map((candle, idx) => {
            const candleIsUp = candle.close >= candle.open;
            const color = candleIsUp ? PriestTheme.colors.primary : PriestTheme.colors.danger;

            // Normalized heights
            const topPrice = Math.max(candle.open, candle.close);
            const bottomPrice = Math.min(candle.open, candle.close);

            const wickTop = ((maxPrice - candle.high) / priceRange) * (chartHeight - 30);
            const wickHeight = Math.max(2, ((candle.high - candle.low) / priceRange) * (chartHeight - 30));

            const bodyTop = ((maxPrice - topPrice) / priceRange) * (chartHeight - 30);
            const bodyHeight = Math.max(3, ((topPrice - bottomPrice) / priceRange) * (chartHeight - 30));

            const isSelected = scrubIndex === idx;

            return (
              <TouchableOpacity
                key={candle.time}
                style={styles.candleColumn}
                activeOpacity={0.8}
                onPress={() => {
                  Haptics.selectionAsync();
                  setScrubIndex(idx);
                }}
              >
                {/* Upper & Lower Wick */}
                <View
                  style={[
                    styles.wick,
                    {
                      top: wickTop,
                      height: wickHeight,
                      backgroundColor: color,
                    },
                  ]}
                />
                {/* Candle Body */}
                <View
                  style={[
                    styles.body,
                    {
                      top: bodyTop,
                      height: bodyHeight,
                      backgroundColor: color,
                      borderColor: color,
                      opacity: isSelected ? 1 : 0.85,
                      borderWidth: isSelected ? 1 : 0,
                    },
                  ]}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Volume bars preview at bottom */}
      <View style={styles.volumeRow}>
        {candles.map((c, i) => (
          <View
            key={`vol-${c.time}`}
            style={[
              styles.volBar,
              {
                height: Math.max(2, (c.volume / 60000) * 16),
                backgroundColor:
                  c.close >= c.open
                    ? 'rgba(0, 255, 148, 0.25)'
                    : 'rgba(239, 68, 68, 0.25)',
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: PriestTheme.colors.bg1,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 14,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  currentPrice: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  priceChange: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  tfContainer: {
    flexDirection: 'row',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  tfButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tfButtonActive: {
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
  chartArea: {
    position: 'relative',
    marginTop: 6,
  },
  watermarkContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 10,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    zIndex: 1,
  },
  watermarkText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    height: '100%',
    paddingRight: 60, // Leave room for watermarks
  },
  candleColumn: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    marginHorizontal: 1,
  },
  wick: {
    position: 'absolute',
    width: 1.5,
  },
  body: {
    position: 'absolute',
    width: '100%',
    borderRadius: 1,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 18,
    marginTop: 6,
    paddingRight: 60,
    gap: 2,
  },
  volBar: {
    flex: 1,
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
  },
});
