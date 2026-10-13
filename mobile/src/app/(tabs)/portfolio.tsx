import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { PriestTheme } from '../../constants/theme';
import { Header } from '../../components/Header';
import { PositionCard } from '../../components/PositionCard';
import { PnLShareModal } from '../../components/PnLShareModal';
import { usePriest } from '../../hooks/usePriestState';
import { API_BASE } from '../../lib/api';
import type { PositionItem } from '../../lib/types';

export default function PortfolioScreen() {
  const router = useRouter();
  const { wallet, positions, setActivePnlShare, activePnlShare } = usePriest();
  const [copiedCode, setCopiedCode] = useState(false);
  const [userPoints, setUserPoints] = useState(48250);

  React.useEffect(() => {
    fetch(`${API_BASE}/rewards/leaderboard?limit=50`)
      .then((r) => r.json())
      .then((json) => {
        const items = json?.data;
        if (Array.isArray(items) && items.length > 0) {
          const match = items.find(
            (i: any) => (i.wallet || '').toLowerCase() === (wallet.address || '').toLowerCase()
          );
          if (match && match.points) {
            setUserPoints(Number(match.points));
          } else if (items[0]?.points) {
            setUserPoints(Math.round(Number(items[0].points) * 0.15));
          }
        }
      })
      .catch(() => {});
  }, [wallet.address]);

  const totalUnrealizedPnl = positions.reduce((acc, p) => acc + p.pnlUsd, 0);
  const isPnlPositive = totalUnrealizedPnl >= 0;

  const handleCopyReferral = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync('https://perpes.fun/ref/SOLCHAD');
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
    Alert.alert('Referral Link Copied! 📋', 'Share with friends to earn 10% fee rebates on all their trades.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Portfolio & Rewards" />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Net Equity Hero Card */}
        <View style={styles.equityCard}>
          <Text style={styles.equityLabel}>Total Net Equity</Text>
          <Text style={styles.equityValue}>
            ${wallet.netEquityUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Text>

          {/* Unrealized PnL Row */}
          <View style={styles.pnlRow}>
            <Text style={styles.pnlLabel}>Unrealized Positions PnL:</Text>
            <Text
              style={[
                styles.pnlValue,
                { color: isPnlPositive ? PriestTheme.colors.primary : PriestTheme.colors.danger },
              ]}
            >
              {isPnlPositive ? '+' : ''}${totalUnrealizedPnl.toFixed(2)} USD
            </Text>
          </View>

          {/* Margin Health Bar */}
          <View style={styles.healthContainer}>
            <View style={styles.healthHeader}>
              <Text style={styles.healthLabel}>Margin Account Health</Text>
              <Text style={styles.healthPercent}>{wallet.marginHealthPercent}%</Text>
            </View>
            <View style={styles.healthTrack}>
              <View
                style={[
                  styles.healthFill,
                  { width: `${wallet.marginHealthPercent}%` },
                ]}
              />
            </View>
          </View>

          {/* Asset Balances Grid */}
          <View style={styles.assetsGrid}>
            <View style={styles.assetItem}>
              <Text style={styles.assetName}>USDC Margin</Text>
              <Text style={styles.assetAmount}>${wallet.usdcBalance.toFixed(2)}</Text>
            </View>
            <View style={styles.assetItem}>
              <Text style={styles.assetName}>SOL Balance</Text>
              <Text style={styles.assetAmount}>{wallet.solBalance.toFixed(3)} SOL</Text>
            </View>
            <View style={styles.assetItem}>
              <Text style={styles.assetName}>MON Balance</Text>
              <Text style={styles.assetAmount}>{wallet.monBalance.toFixed(1)} MON</Text>
            </View>
          </View>
        </View>

        {/* Weekly Epoch Rewards Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="trophy" size={16} color={PriestTheme.colors.warning} />
            <Text style={styles.sectionTitle}>Weekly Rewards Epoch 14</Text>
          </View>

          <View style={styles.rewardsCard}>
            <View style={styles.rewardsTop}>
              <View>
                <Text style={styles.pointsNumber}>{userPoints.toLocaleString()}</Text>
                <Text style={styles.pointsLabel}>Accumulated Points</Text>
              </View>
              <View style={styles.rankBadge}>
                <Text style={styles.rankText}>TIER: GOLD (Top 5%)</Text>
              </View>
            </View>

            <View style={styles.rebateRow}>
              <Text style={styles.rebateLabel}>Active Fee Rebate:</Text>
              <Text style={styles.rebateValue}>15.0%</Text>
            </View>
          </View>
        </View>

        {/* Active Positions */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="layers" size={16} color={PriestTheme.colors.primary} />
            <Text style={styles.sectionTitle}>Open Positions ({positions.length})</Text>
          </View>

          {positions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No positions active right now.</Text>
            </View>
          ) : (
            positions.map((pos) => (
              <PositionCard
                key={pos.id}
                position={pos}
                onSharePnl={(p) => setActivePnlShare(p)}
              />
            ))
          )}
        </View>

        {/* Referral Program */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="gift" size={16} color={PriestTheme.colors.info} />
            <Text style={styles.sectionTitle}>Referral Program (10% Cut)</Text>
          </View>

          <View style={styles.referralCard}>
            <Text style={styles.referralDesc}>
              Earn a direct 10% on-chain cut of all protocol taker fees generated by your referred traders.
            </Text>

            <View style={styles.codeRow}>
              <View style={styles.codeBox}>
                <Text style={styles.codeText}>perpes.fun/ref/SOLCHAD</Text>
              </View>
              <TouchableOpacity
                style={styles.copyButton}
                onPress={handleCopyReferral}
              >
                <Ionicons
                  name={copiedCode ? 'checkmark' : 'copy-outline'}
                  size={16}
                  color="#000000"
                />
                <Text style={styles.copyText}>{copiedCode ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Ecosystem Tools & Services */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="apps" size={16} color={PriestTheme.colors.primary} />
            <Text style={styles.sectionTitle}>Ecosystem & Protocols</Text>
          </View>

          <View style={styles.toolsGrid}>
            <TouchableOpacity
              style={styles.toolCard}
              onPress={() => router.push('/counterflow')}
            >
              <View style={[styles.toolIcon, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                <Ionicons name="water" size={18} color="#38BDF8" />
              </View>
              <Text style={styles.toolTitle}>Counterflow</Text>
              <Text style={styles.toolSub}>LP Yield & Fees</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolCard}
              onPress={() => router.push('/list')}
            >
              <View style={[styles.toolIcon, { backgroundColor: 'rgba(255, 184, 0, 0.15)' }]}>
                <Ionicons name="flash" size={18} color="#FFB800" />
              </View>
              <Text style={styles.toolTitle}>List a Token</Text>
              <Text style={styles.toolSub}>Open Perp on Pool</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolCard}
              onPress={() => router.push('/leaderboard')}
            >
              <View style={[styles.toolIcon, { backgroundColor: 'rgba(0, 255, 148, 0.15)' }]}>
                <Ionicons name="trophy" size={18} color={PriestTheme.colors.primary} />
              </View>
              <Text style={styles.toolTitle}>Leaderboard</Text>
              <Text style={styles.toolSub}>Global Rankings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolCard}
              onPress={() => router.push('/faucet')}
            >
              <View style={[styles.toolIcon, { backgroundColor: 'rgba(131, 110, 249, 0.15)' }]}>
                <Ionicons name="color-wand" size={18} color={PriestTheme.colors.purple} />
              </View>
              <Text style={styles.toolTitle}>Faucet</Text>
              <Text style={styles.toolSub}>Testnet Airdrop</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolCard}
              onPress={() => router.push('/support')}
            >
              <View style={[styles.toolIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                <Ionicons name="help-buoy" size={18} color="#60A5FA" />
              </View>
              <Text style={styles.toolTitle}>Support & FAQ</Text>
              <Text style={styles.toolSub}>System Status</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolCard}
              onPress={() => router.push('/profile')}
            >
              <View style={[styles.toolIcon, { backgroundColor: 'rgba(236, 72, 153, 0.15)' }]}>
                <Ionicons name="person" size={18} color="#F472B6" />
              </View>
              <Text style={styles.toolTitle}>Creator Profile</Text>
              <Text style={styles.toolSub}>Fee Shares & Bio</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* PnL Share Card */}
      <PnLShareModal
        position={activePnlShare}
        onClose={() => setActivePnlShare(null)}
      />
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
  equityCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 148, 0.25)',
    marginBottom: 20,
  },
  equityLabel: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  equityValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 32,
    fontWeight: '900',
    marginTop: 4,
    letterSpacing: -0.5,
  },
  pnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  pnlLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
  },
  pnlValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  healthContainer: {
    marginTop: 18,
  },
  healthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  healthLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  healthPercent: {
    color: PriestTheme.colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  healthTrack: {
    height: 4,
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  healthFill: {
    height: '100%',
    backgroundColor: PriestTheme.colors.primary,
  },
  assetsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 12,
    padding: 12,
    marginTop: 18,
  },
  assetItem: {
    alignItems: 'center',
  },
  assetName: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  assetAmount: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 3,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  rewardsCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  rewardsTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pointsNumber: {
    color: PriestTheme.colors.warning,
    fontSize: 26,
    fontWeight: '900',
  },
  pointsLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  rankBadge: {
    backgroundColor: PriestTheme.colors.warningDim,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rankText: {
    color: PriestTheme.colors.warning,
    fontSize: 10,
    fontWeight: '900',
  },
  rebateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: PriestTheme.colors.borderSubtle,
    marginTop: 12,
    paddingTop: 10,
  },
  rebateLabel: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
  },
  rebateValue: {
    color: PriestTheme.colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  emptyCard: {
    padding: 24,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    alignItems: 'center',
  },
  emptyText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 13,
  },
  referralCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  referralDesc: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  codeBox: {
    flex: 1,
    height: 42,
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  codeText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.primary,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 4,
  },
  copyText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  toolCard: {
    width: '48%',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
  },
  toolIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  toolTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
  },
  toolSub: {
    fontSize: 11,
    color: PriestTheme.colors.textMuted,
    marginTop: 2,
  },
});
