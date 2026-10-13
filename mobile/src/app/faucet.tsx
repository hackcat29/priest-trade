import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import { usePriest } from '../hooks/usePriestState';

const AMOUNTS = ['1000', '5000', '25000'] as const;

export default function FaucetScreen() {
  const router = useRouter();
  const { wallet, switchChain, updateBalances } = usePriest();
  const [selectedAmount, setSelectedAmount] = useState<string>('5000');
  const [isMinting, setIsMinting] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const handleClaimAirdrop = async () => {
    if (!wallet.isConnected) {
      Alert.alert('Connect Wallet', 'Please connect a wallet first before requesting airdrop.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsMinting(true);

    setTimeout(() => {
      setIsMinting(false);
      const fakeHash = `${wallet.chain === 'monad' ? '0x' : ''}5K9x...${Math.random().toString(36).slice(-6)}`;
      setLastTxHash(fakeHash);
      updateBalances(Number(selectedAmount));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Airdrop Confirmed! 💧',
        `Successfully received $${Number(selectedAmount).toLocaleString()} Testnet USDC on ${wallet.chain.toUpperCase()}. Your margin collateral has been credited.`
      );
    }, 1200);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color={PriestTheme.colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>Testnet Faucet</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Banner */}
        <View style={styles.faucetBanner}>
          <View style={styles.faucetIconCircle}>
            <Ionicons name="water" size={28} color={PriestTheme.colors.info} />
          </View>
          <Text style={styles.bannerTitle}>Free Testnet Collateral</Text>
          <Text style={styles.bannerDesc}>
            Claim Testnet USDC Collateral to test perpetual contracts, leverage up to 40x, and explore liquidations on {wallet.chain === 'solana' ? 'Solana Devnet' : 'Monad Testnet'}.
          </Text>
        </View>

        {/* Network Selector */}
        <Text style={styles.sectionHeader}>SELECT NETWORK</Text>
        <View style={styles.chainRow}>
          <TouchableOpacity
            style={[
              styles.chainBtn,
              wallet.chain === 'solana' && styles.chainBtnActive,
            ]}
            onPress={() => switchChain('solana')}
          >
            <View style={[styles.chainDot, { backgroundColor: '#14F195' }]} />
            <Text style={styles.chainText}>Solana Devnet</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.chainBtn,
              wallet.chain === 'monad' && styles.chainBtnActive,
            ]}
            onPress={() => switchChain('monad')}
          >
            <View style={[styles.chainDot, { backgroundColor: PriestTheme.colors.purple }]} />
            <Text style={styles.chainText}>Monad Testnet</Text>
          </TouchableOpacity>
        </View>

        {/* Amount Presets */}
        <Text style={styles.sectionHeader}>USDC AIRDROP AMOUNT</Text>
        <View style={styles.amountRow}>
          {AMOUNTS.map((amt) => (
            <TouchableOpacity
              key={amt}
              style={[
                styles.amountPill,
                selectedAmount === amt && styles.amountPillActive,
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setSelectedAmount(amt);
              }}
            >
              <Text
                style={[
                  styles.amountText,
                  selectedAmount === amt && styles.amountTextActive,
                ]}
              >
                ${Number(amt).toLocaleString()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Target Address Card */}
        <View style={styles.destCard}>
          <Text style={styles.destLabel}>Receiving Address:</Text>
          <Text style={styles.destAddress}>
            {wallet.isConnected ? wallet.address : 'No wallet connected'}
          </Text>
        </View>

        {/* Claim Action Button */}
        <TouchableOpacity
          style={[styles.claimBtn, isMinting && styles.claimBtnDisabled]}
          onPress={handleClaimAirdrop}
          disabled={isMinting}
          activeOpacity={0.8}
        >
          {isMinting ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <View style={styles.claimBtnInner}>
              <Ionicons name="water" size={18} color="#000000" />
              <Text style={styles.claimBtnText}>
                Request ${Number(selectedAmount).toLocaleString()} Test USDC
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Last Transaction Status */}
        {lastTxHash && (
          <View style={styles.txSuccessCard}>
            <Ionicons name="checkmark-circle" size={18} color={PriestTheme.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.txTitle}>Airdrop Transaction Confirmed</Text>
              <Text style={styles.txHash}>Tx: {lastTxHash}</Text>
            </View>
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: PriestTheme.colors.bg2,
  },
  title: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  faucetBanner: {
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    marginBottom: 24,
  },
  faucetIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  bannerTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
  },
  bannerDesc: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
  sectionHeader: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  chainRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  chainBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    gap: 8,
  },
  chainBtnActive: {
    borderColor: PriestTheme.colors.primary,
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  chainDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chainText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  amountRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  amountPill: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  amountPillActive: {
    borderColor: PriestTheme.colors.info,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  amountText: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '800',
  },
  amountTextActive: {
    color: PriestTheme.colors.info,
  },
  destCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 20,
  },
  destLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
  },
  destAddress: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  claimBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: PriestTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimBtnDisabled: {
    opacity: 0.6,
  },
  claimBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  claimBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
  txSuccessCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.primaryDim,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.primary,
    marginTop: 16,
    gap: 10,
  },
  txTitle: {
    color: PriestTheme.colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  txHash: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
});
