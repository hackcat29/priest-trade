import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import { usePriest } from '../hooks/usePriestState';

interface WalletModalProps {
  visible: boolean;
  onClose: () => void;
}

export function WalletModal({ visible, onClose }: WalletModalProps) {
  const { wallet, connectWallet, disconnectWallet } = usePriest();

  const handleSelect = (method: 'privy' | 'phantom' | 'metamask' | 'demo') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    connectWallet(method);
    onClose();
  };

  const handleDisconnect = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    disconnectWallet();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <SafeAreaView style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>
                {wallet.isConnected ? 'Wallet Connected' : 'Connect to Priest.trade'}
              </Text>
              <Text style={styles.subtitle}>
                {wallet.isConnected
                  ? 'Trade perpetuals with zero friction'
                  : 'Social login or connect your mobile wallet'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={PriestTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {wallet.isConnected ? (
              <View style={styles.connectedCard}>
                <View style={styles.balanceRow}>
                  <Text style={styles.balanceLabel}>Account Net Equity</Text>
                  <Text style={styles.balanceValue}>
                    ${wallet.netEquityUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </View>

                <View style={styles.divider} />

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Free Collateral</Text>
                  <Text style={styles.metaValue}>
                    ${wallet.freeCollateralUsd.toFixed(2)} USDC
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Address</Text>
                  <Text style={styles.metaAddress}>{wallet.address}</Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Margin Health</Text>
                  <Text style={styles.healthGreen}>
                    {wallet.marginHealthPercent}% (Safe)
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.disconnectButton}
                  onPress={handleDisconnect}
                >
                  <Ionicons name="log-out-outline" size={18} color={PriestTheme.colors.danger} />
                  <Text style={styles.disconnectText}>Disconnect Wallet</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Privy Embedded Auth */}
                <Text style={styles.sectionHeader}>RECOMMENDED (PRIVY EMBEDDED)</Text>
                <TouchableOpacity
                  style={styles.walletOption}
                  onPress={() => handleSelect('privy')}
                >
                  <View style={[styles.iconCircle, { backgroundColor: 'rgba(0, 255, 148, 0.15)' }]}>
                    <Ionicons name="mail" size={20} color={PriestTheme.colors.primary} />
                  </View>
                  <View style={styles.optionDetails}>
                    <Text style={styles.optionTitle}>Privy Social / Email</Text>
                    <Text style={styles.optionDesc}>Instant seedless embedded wallet</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={PriestTheme.colors.textMuted} />
                </TouchableOpacity>

                {/* Solana Mobile Wallets */}
                <Text style={styles.sectionHeader}>EXTERNAL WALLETS</Text>
                <TouchableOpacity
                  style={styles.walletOption}
                  onPress={() => handleSelect('phantom')}
                >
                  <View style={[styles.iconCircle, { backgroundColor: 'rgba(171, 159, 242, 0.15)' }]}>
                    <Ionicons name="flash" size={20} color="#AB9FF2" />
                  </View>
                  <View style={styles.optionDetails}>
                    <Text style={styles.optionTitle}>Phantom / Solflare</Text>
                    <Text style={styles.optionDesc}>Solana Mobile Wallet Adapter</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={PriestTheme.colors.textMuted} />
                </TouchableOpacity>

                {/* EVM / Monad */}
                <TouchableOpacity
                  style={styles.walletOption}
                  onPress={() => handleSelect('metamask')}
                >
                  <View style={[styles.iconCircle, { backgroundColor: 'rgba(131, 110, 249, 0.15)' }]}>
                    <Ionicons name="cube" size={20} color={PriestTheme.colors.purple} />
                  </View>
                  <View style={styles.optionDetails}>
                    <Text style={styles.optionTitle}>MetaMask / Rabby</Text>
                    <Text style={styles.optionDesc}>Monad EVM testnet & mainnet</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={PriestTheme.colors.textMuted} />
                </TouchableOpacity>

                {/* Demo Mode */}
                <Text style={styles.sectionHeader}>TEST DRIVE</Text>
                <TouchableOpacity
                  style={[styles.walletOption, styles.demoOption]}
                  onPress={() => handleSelect('demo')}
                >
                  <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                    <Ionicons name="play-circle" size={20} color={PriestTheme.colors.info} />
                  </View>
                  <View style={styles.optionDetails}>
                    <Text style={[styles.optionTitle, { color: PriestTheme.colors.info }]}>
                      Demo Trader Mode
                    </Text>
                    <Text style={styles.optionDesc}>$3,400 USDC sandbox balance</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={PriestTheme.colors.info} />
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: PriestTheme.colors.bg1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
  },
  title: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: PriestTheme.colors.bg2,
  },
  content: {
    padding: 20,
  },
  sectionHeader: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 8,
  },
  walletOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 10,
    gap: 12,
  },
  demoOption: {
    borderColor: 'rgba(56, 189, 248, 0.3)',
    backgroundColor: 'rgba(56, 189, 248, 0.05)',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionDetails: {
    flex: 1,
  },
  optionTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  optionDesc: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  connectedCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  balanceRow: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  balanceLabel: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
  },
  balanceValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: PriestTheme.colors.border,
    marginVertical: 14,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  metaLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 13,
  },
  metaValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  metaAddress: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    maxWidth: 180,
  },
  healthGreen: {
    color: PriestTheme.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  disconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    gap: 8,
  },
  disconnectText: {
    color: PriestTheme.colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
});
