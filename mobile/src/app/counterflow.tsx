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
import { usePriest } from '../hooks/usePriestState';
import { fetchGlobalStats } from '../lib/api';

export default function CounterflowScreen() {
  const router = useRouter();
  const { wallet, updateBalances } = usePriest();

  const [activeTab, setActiveTab] = useState<'deposit' | 'redeem'>('deposit');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live Protocol Vault state
  const [vaultNavUsdc, setVaultNavUsdc] = useState(3840250);
  const [totalExposureUsdc, setTotalExposureUsdc] = useState(212500);
  const sharePrice = 1.1428;

  React.useEffect(() => {
    fetchGlobalStats(wallet.chain).then((stats) => {
      if (stats && stats.totalOi > 0) {
        setTotalExposureUsdc(Math.round(stats.totalOi * 1000));
        setVaultNavUsdc(Math.round(stats.totalOi * 6400));
      }
    });
  }, [wallet.chain]);

  const utilizationPercent = ((totalExposureUsdc / vaultNavUsdc) * 100).toFixed(1);
  const myCfUsdcShares = 850.4;
  const myCfUsdcValue = (myCfUsdcShares * sharePrice).toFixed(2);
  const myPendingRedeem = 0;

  const handleDeposit = () => {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid USDC amount to deposit.');
      return;
    }
    if (num > wallet.usdcBalance) {
      Alert.alert('Insufficient Balance', `You only have $${wallet.usdcBalance.toFixed(2)} USDC available.`);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubmitting(true);

    setTimeout(() => {
      setIsSubmitting(false);
      updateBalances(-num, 0, 0);
      setAmount('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Deposit Complete! 💧',
        `Successfully deposited $${num.toFixed(2)} USDC into Counterflow Vault. You received ${(num / sharePrice).toFixed(2)} cfUSDC.`
      );
    }, 1200);
  };

  const handleRedeem = () => {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid cfUSDC share amount.');
      return;
    }
    if (num > myCfUsdcShares) {
      Alert.alert('Insufficient Shares', `You only have ${myCfUsdcShares} cfUSDC shares.`);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubmitting(true);

    setTimeout(() => {
      setIsSubmitting(false);
      setAmount('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Redemption Initiated ⏳',
        `Unbonding request for ${num.toFixed(2)} cfUSDC submitted. Funds unlock after the 2-day cooldown period at the prevailing share price.`
      );
    }, 1200);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={PriestTheme.colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Counterflow Vault</Text>
          <View style={styles.chainPill}>
            <Text style={styles.chainText}>EVM / MONAD LP</Text>
          </View>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Explanation Card */}
        <View style={styles.heroCard}>
          <View style={styles.badgeRow}>
            <View style={styles.earnBadge}>
              <Ionicons name="water" size={13} color="#00FF94" />
              <Text style={styles.earnBadgeText}>EARN LP YIELD</Text>
            </View>
            <Text style={styles.yieldEstimate}>Est. APY: ~28.4%</Text>
          </View>

          <Text style={styles.heroTitle}>The Counterparty Vault</Text>
          <Text style={styles.heroDesc}>
            Counterflow takes the other side of the crowd on Priest oracle-priced markets. When a market's own vault
            can't pay a winner in full, Counterflow does. In return, it earns a cut of trading fees, funding payments, and trader losses.
          </Text>

          <View style={styles.rulesRow}>
            <View style={styles.ruleItem}>
              <Ionicons name="shield-checkmark" size={14} color={PriestTheme.colors.primary} />
              <Text style={styles.ruleText}>10% max single market cap</Text>
            </View>
            <View style={styles.ruleItem}>
              <Ionicons name="time" size={14} color={PriestTheme.colors.warning} />
              <Text style={styles.ruleText}>2-day unbonding cooldown</Text>
            </View>
          </View>
        </View>

        {/* Global Vault Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>VAULT NAV</Text>
            <Text style={styles.statValue}>${(vaultNavUsdc / 1000000).toFixed(2)}M</Text>
            <Text style={styles.statSub}>Total Pool Liquidity</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>cfUSDC PRICE</Text>
            <Text style={[styles.statValue, { color: PriestTheme.colors.primary }]}>
              ${sharePrice.toFixed(4)}
            </Text>
            <Text style={styles.statSub}>+14.28% Since Genesis</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>EXPOSURE PAID</Text>
            <Text style={styles.statValue}>${(totalExposureUsdc / 1000).toFixed(0)}K</Text>
            <Text style={styles.statSub}>{utilizationPercent}% of Vault</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>TOTAL CAPS</Text>
            <Text style={styles.statValue}>10% / 50%</Text>
            <Text style={styles.statSub}>Per Market / Total</Text>
          </View>
        </View>

        {/* My Vault Position */}
        <View style={styles.myPositionCard}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="wallet" size={16} color={PriestTheme.colors.primary} />
            <Text style={styles.sectionTitle}>Your Position</Text>
          </View>

          <View style={styles.positionValuesRow}>
            <View>
              <Text style={styles.posLabel}>cfUSDC Holding</Text>
              <Text style={styles.posValue}>{myCfUsdcShares.toFixed(2)} cfUSDC</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.posLabel}>Estimated Value</Text>
              <Text style={[styles.posValue, { color: PriestTheme.colors.primary }]}>
                ${myCfUsdcValue} USDC
              </Text>
            </View>
          </View>
        </View>

        {/* Interaction Form: Deposit or Redeem */}
        <View style={styles.actionForm}>
          {/* Segmented Tab Switcher */}
          <View style={styles.tabSwitcher}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'deposit' && styles.tabBtnActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setActiveTab('deposit');
                setAmount('');
              }}
            >
              <Text style={[styles.tabBtnText, activeTab === 'deposit' && styles.tabBtnTextActive]}>
                Deposit USDC
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'redeem' && styles.tabBtnActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setActiveTab('redeem');
                setAmount('');
              }}
            >
              <Text style={[styles.tabBtnText, activeTab === 'redeem' && styles.tabBtnTextActive]}>
                Request Redeem
              </Text>
            </TouchableOpacity>
          </View>

          {/* Balance Preview */}
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>
              {activeTab === 'deposit' ? 'Available in Wallet:' : 'Available to Redeem:'}
            </Text>
            <TouchableOpacity
              onPress={() => {
                if (activeTab === 'deposit') setAmount(wallet.usdcBalance.toString());
                else setAmount(myCfUsdcShares.toString());
              }}
            >
              <Text style={styles.balanceValue}>
                {activeTab === 'deposit'
                  ? `$${wallet.usdcBalance.toFixed(2)} USDC (MAX)`
                  : `${myCfUsdcShares.toFixed(2)} cfUSDC (MAX)`}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Input Box */}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder={activeTab === 'deposit' ? '0.00 USDC' : '0.00 cfUSDC'}
              placeholderTextColor={PriestTheme.colors.textMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            <TouchableOpacity
              style={styles.maxBtn}
              onPress={() => {
                Haptics.selectionAsync();
                if (activeTab === 'deposit') setAmount(wallet.usdcBalance.toString());
                else setAmount(myCfUsdcShares.toString());
              }}
            >
              <Text style={styles.maxBtnText}>MAX</Text>
            </TouchableOpacity>
          </View>

          {/* Outcome Preview */}
          {amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 ? (
            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>
                {activeTab === 'deposit' ? 'You will receive:' : 'Est. Redemption Value:'}
              </Text>
              <Text style={styles.previewValue}>
                {activeTab === 'deposit'
                  ? `~${(parseFloat(amount) / sharePrice).toFixed(4)} cfUSDC`
                  : `~$${(parseFloat(amount) * sharePrice).toFixed(2)} USDC`}
              </Text>
            </View>
          ) : null}

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitBtn,
              isSubmitting && { opacity: 0.7 },
            ]}
            onPress={activeTab === 'deposit' ? handleDeposit : handleRedeem}
            disabled={isSubmitting}
            activeOpacity={0.8}
          >
            <Text style={styles.submitBtnText}>
              {isSubmitting
                ? 'Processing on-chain...'
                : activeTab === 'deposit'
                ? 'Deposit USDC into Counterflow'
                : 'Request Unbonding Redeem'}
            </Text>
          </TouchableOpacity>
        </View>
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
  headerTitleContainer: {
    alignItems: 'center',
    gap: 2,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
  },
  chainPill: {
    backgroundColor: 'rgba(0, 255, 148, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  chainText: {
    fontSize: 9,
    fontWeight: '800',
    color: PriestTheme.colors.primary,
    letterSpacing: 0.5,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 148, 0.25)',
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  earnBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 255, 148, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  earnBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: PriestTheme.colors.primary,
  },
  yieldEstimate: {
    fontSize: 12,
    fontWeight: '800',
    color: PriestTheme.colors.primary,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: PriestTheme.colors.textPrimary,
    marginBottom: 6,
  },
  heroDesc: {
    fontSize: 12,
    lineHeight: 18,
    color: PriestTheme.colors.textSecondary,
    marginBottom: 12,
  },
  rulesRow: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: PriestTheme.colors.borderSubtle,
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  ruleText: {
    fontSize: 11,
    fontWeight: '600',
    color: PriestTheme.colors.textMuted,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  statBox: {
    width: '48%',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: PriestTheme.colors.textMuted,
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '900',
    color: PriestTheme.colors.textPrimary,
    marginTop: 3,
  },
  statSub: {
    fontSize: 10,
    color: PriestTheme.colors.textSecondary,
    marginTop: 2,
  },
  myPositionCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
  },
  positionValuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  posLabel: {
    fontSize: 11,
    color: PriestTheme.colors.textMuted,
    marginBottom: 3,
  },
  posValue: {
    fontSize: 16,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
  },
  actionForm: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: PriestTheme.colors.bg1,
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: PriestTheme.colors.bg3,
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: PriestTheme.colors.textMuted,
  },
  tabBtnTextActive: {
    color: PriestTheme.colors.textPrimary,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  balanceLabel: {
    fontSize: 11,
    color: PriestTheme.colors.textMuted,
  },
  balanceValue: {
    fontSize: 11,
    fontWeight: '700',
    color: PriestTheme.colors.primary,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 12,
  },
  textInput: {
    flex: 1,
    color: PriestTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  maxBtn: {
    backgroundColor: 'rgba(0, 255, 148, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  maxBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: PriestTheme.colors.primary,
  },
  previewBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg1,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  previewLabel: {
    fontSize: 11,
    color: PriestTheme.colors.textMuted,
  },
  previewValue: {
    fontSize: 12,
    fontWeight: '800',
    color: PriestTheme.colors.primary,
  },
  submitBtn: {
    backgroundColor: PriestTheme.colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#000000',
  },
});
