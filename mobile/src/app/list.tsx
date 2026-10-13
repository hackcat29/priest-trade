import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';

interface DetectedPool {
  id: string;
  pair: string;
  feeTier: string;
  tvlUsd: number;
  eligible: boolean;
  minDepthRequired: number;
}

import { usePriest } from '../hooks/usePriestState';
import { fetchLiveMarketDetail } from '../lib/api';

export default function ListTokenScreen() {
  const router = useRouter();
  const { markets } = usePriest();
  const [tokenAddress, setTokenAddress] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState<string>('pool-1');
  const [isListing, setIsListing] = useState(false);

  const [detectedPools, setDetectedPools] = useState<DetectedPool[]>([
    {
      id: 'pool-1',
      pair: 'ORBT / USDC',
      feeTier: '0.30%',
      tvlUsd: 1485000,
      eligible: true,
      minDepthRequired: 50000,
    },
    {
      id: 'pool-2',
      pair: 'ORBT / SOL',
      feeTier: '1.00%',
      tvlUsd: 824000,
      eligible: true,
      minDepthRequired: 50000,
    },
    {
      id: 'pool-3',
      pair: 'ORBT / USDT',
      feeTier: '0.05%',
      tvlUsd: 218200,
      eligible: true,
      minDepthRequired: 50000,
    },
  ]);

  const handleLookup = async () => {
    if (!tokenAddress.trim() || tokenAddress.trim().length < 8) {
      Alert.alert('Invalid Address', 'Please paste a valid SPL token mint or ERC-20 address.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSearching(true);
    setHasSearched(false);

    try {
      const trimmed = tokenAddress.trim();
      const localMatch = markets.find(
        (m) =>
          m.mint.toLowerCase() === trimmed.toLowerCase() ||
          m.symbol.toLowerCase() === trimmed.toLowerCase()
      );

      const symbol = localMatch ? localMatch.symbol : trimmed.slice(0, 4).toUpperCase();
      const isMonad = trimmed.startsWith('0x');

      setDetectedPools([
        {
          id: 'pool-1',
          pair: `${symbol} / USDC`,
          feeTier: '0.30%',
          tvlUsd: localMatch ? localMatch.volume24h : 485000,
          eligible: true,
          minDepthRequired: 50000,
        },
        {
          id: 'pool-2',
          pair: `${symbol} / ${isMonad ? 'WMON' : 'SOL'}`,
          feeTier: '1.00%',
          tvlUsd: localMatch ? Math.round(localMatch.volume24h * 0.4) : 185000,
          eligible: true,
          minDepthRequired: 50000,
        },
      ]);
      setSelectedPoolId('pool-1');
      setHasSearched(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setHasSearched(true);
    } finally {
      setIsSearching(false);
    }
  };

  const handleListMarket = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsListing(true);

    setTimeout(() => {
      setIsListing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Market Listed! ⚡',
        'Secondary perpetual market initialized on-chain. It is now open for Long and Short trading with TWAP oracle pricing.',
        [
          {
            text: 'View Discover',
            onPress: () => router.push('/(tabs)'),
          },
        ]
      );
    }, 1500);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={PriestTheme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>List Token Perp</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Banner */}
        <View style={styles.banner}>
          <View style={styles.bannerBadge}>
            <Ionicons name="flash" size={13} color="#00FF94" />
            <Text style={styles.bannerBadgeText}>PERMISSIONLESS LISTING</Text>
          </View>
          <Text style={styles.bannerTitle}>Turn Any Spot Pool Into a Perp</Text>
          <Text style={styles.bannerDesc}>
            Open an on-chain perpetual market on any token with a deep enough Uniswap pool.
            The perp is priced from the pool's TWAP oracle plus a dynamic skew premium.
          </Text>
        </View>

        {/* Token Input Form */}
        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>Token Contract Address</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              placeholder="0x71c... or SPL mint"
              placeholderTextColor={PriestTheme.colors.textMuted}
              value={tokenAddress}
              onChangeText={setTokenAddress}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.lookupBtn, isSearching && { opacity: 0.7 }]}
              onPress={handleLookup}
              disabled={isSearching}
            >
              <Text style={styles.lookupBtnText}>{isSearching ? 'Finding…' : 'Inspect'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => setTokenAddress('0xfe14781cf141fc53a510f2249c3e4be0bb1cb796')}
            style={styles.pasteDemoBtn}
          >
            <Text style={styles.pasteDemoText}>Use demo token address: $CHAD</Text>
          </TouchableOpacity>
        </View>

        {/* Search Results */}
        {hasSearched && (
          <View style={styles.resultsSection}>
            <Text style={styles.sectionTitle}>Discovered Spot Pools</Text>
            <Text style={styles.sectionSubtitle}>
              Select the highest liquidity pool to power the TWAP oracle price feed.
            </Text>

            {detectedPools.map((pool) => {
              const isSelected = selectedPoolId === pool.id;
              return (
                <TouchableOpacity
                  key={pool.id}
                  style={[
                    styles.poolCard,
                    isSelected && styles.poolCardSelected,
                    !pool.eligible && styles.poolCardDisabled,
                  ]}
                  onPress={() => {
                    if (pool.eligible) {
                      Haptics.selectionAsync();
                      setSelectedPoolId(pool.id);
                    } else {
                      Alert.alert(
                        'Pool Ineligible',
                        `This pool has $${(pool.tvlUsd / 1000).toFixed(0)}k TVL, which is under the $50k minimum required for oracle safety.`
                      );
                    }
                  }}
                  activeOpacity={pool.eligible ? 0.8 : 1}
                >
                  <View style={styles.poolLeft}>
                    <View style={styles.radioOuter}>
                      {isSelected && <View style={styles.radioInner} />}
                    </View>
                    <View>
                      <View style={styles.poolPairRow}>
                        <Text style={styles.poolPair}>{pool.pair}</Text>
                        <View style={styles.feeBadge}>
                          <Text style={styles.feeText}>{pool.feeTier}</Text>
                        </View>
                      </View>
                      <Text style={styles.tvlText}>
                        Spot Pool TVL: ${(pool.tvlUsd / 1000).toFixed(0)}K
                      </Text>
                    </View>
                  </View>

                  <View style={styles.poolRight}>
                    {pool.eligible ? (
                      <View style={styles.eligiblePill}>
                        <Ionicons name="checkmark-circle" size={13} color="#00FF94" />
                        <Text style={styles.eligibleText}>Eligible</Text>
                      </View>
                    ) : (
                      <View style={styles.lowLiquidityPill}>
                        <Ionicons name="alert-circle" size={13} color="#FF4D4D" />
                        <Text style={styles.lowLiquidityText}>Low TVL</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Launch Market Button */}
            <TouchableOpacity
              style={[styles.launchBtn, isListing && { opacity: 0.7 }]}
              onPress={handleListMarket}
              disabled={isListing}
            >
              <Ionicons name="rocket" size={18} color="#000000" />
              <Text style={styles.launchBtnText}>
                {isListing ? 'Initializing On-Chain...' : 'Deploy Secondary Market Perp'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
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
    backgroundColor: PriestTheme.colors.bg1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PriestTheme.colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  banner: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 148, 0.25)',
    marginBottom: 16,
  },
  bannerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 255, 148, 0.12)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 8,
  },
  bannerBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: PriestTheme.colors.primary,
  },
  bannerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: PriestTheme.colors.textPrimary,
    marginBottom: 6,
  },
  bannerDesc: {
    fontSize: 12,
    lineHeight: 18,
    color: PriestTheme.colors.textSecondary,
  },
  inputCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: PriestTheme.colors.textPrimary,
    marginBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: PriestTheme.colors.bg1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
    paddingHorizontal: 12,
    height: 46,
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
  },
  lookupBtn: {
    backgroundColor: PriestTheme.colors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookupBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#000000',
  },
  pasteDemoBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  pasteDemoText: {
    fontSize: 11,
    color: PriestTheme.colors.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  resultsSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: PriestTheme.colors.textSecondary,
    marginBottom: 12,
  },
  poolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
    marginBottom: 10,
  },
  poolCardSelected: {
    borderColor: PriestTheme.colors.primary,
    backgroundColor: 'rgba(0, 255, 148, 0.05)',
  },
  poolCardDisabled: {
    opacity: 0.5,
  },
  poolLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: PriestTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PriestTheme.colors.primary,
  },
  poolPairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  poolPair: {
    fontSize: 14,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
  },
  feeBadge: {
    backgroundColor: PriestTheme.colors.bg3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  feeText: {
    fontSize: 10,
    fontWeight: '700',
    color: PriestTheme.colors.textMuted,
  },
  tvlText: {
    fontSize: 11,
    color: PriestTheme.colors.textSecondary,
    marginTop: 2,
  },
  poolRight: {},
  eligiblePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 255, 148, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  eligibleText: {
    fontSize: 11,
    fontWeight: '800',
    color: PriestTheme.colors.primary,
  },
  lowLiquidityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 77, 77, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  lowLiquidityText: {
    fontSize: 11,
    fontWeight: '800',
    color: PriestTheme.colors.danger,
  },
  launchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: PriestTheme.colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 12,
  },
  launchBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#000000',
  },
});
