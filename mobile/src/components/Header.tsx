import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { PriestTheme } from '../constants/theme';
import { usePriest } from '../hooks/usePriestState';
import { WalletModal } from './WalletModal';

export function Header({ title }: { title?: string }) {
  const router = useRouter();
  const { wallet, switchChain } = usePriest();
  const [walletModalVisible, setWalletModalVisible] = useState(false);

  const handleWalletPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setWalletModalVisible(true);
  };

  const handleChainToggle = () => {
    Haptics.selectionAsync();
    switchChain(wallet.chain === 'solana' ? 'monad' : 'solana');
  };

  return (
    <View style={styles.container}>
      {/* Brand / Logo */}
      <TouchableOpacity
        style={styles.left}
        onPress={() => {
          Haptics.selectionAsync();
          router.push('/(tabs)');
        }}
        activeOpacity={0.8}
      >
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <View>
          <Text style={styles.brandTitle}>perpes<Text style={styles.brandAccent}>.fun</Text></Text>
          {title && <Text style={styles.subtitle}>{title}</Text>}
        </View>
      </TouchableOpacity>

      {/* Right Controls: Chain Switcher & Wallet */}
      <View style={styles.right}>
        {/* Chain Switcher Pill */}
        <TouchableOpacity
          style={[
            styles.chainPill,
            wallet.chain === 'monad' ? styles.chainPillMonad : styles.chainPillSolana,
          ]}
          onPress={handleChainToggle}
          activeOpacity={0.8}
        >
          <View
            style={[
              styles.chainDot,
              { backgroundColor: wallet.chain === 'monad' ? PriestTheme.colors.purple : '#14F195' },
            ]}
          />
          <Text style={styles.chainText}>
            {wallet.chain === 'monad' ? 'Monad' : 'Solana'}
          </Text>
        </TouchableOpacity>

        {/* Wallet Button */}
        <TouchableOpacity
          style={[styles.walletButton, wallet.isConnected && styles.walletButtonConnected]}
          onPress={handleWalletPress}
          activeOpacity={0.8}
        >
          <Ionicons
            name={wallet.isConnected ? 'wallet' : 'wallet-outline'}
            size={16}
            color={wallet.isConnected ? PriestTheme.colors.primary : PriestTheme.colors.textSecondary}
          />
          <Text
            style={[
              styles.walletText,
              wallet.isConnected && styles.walletTextConnected,
            ]}
            numberOfLines={1}
          >
            {wallet.isConnected ? wallet.displayAddress : 'Connect'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Wallet Connection Modal */}
      <WalletModal
        visible={walletModalVisible}
        onClose={() => setWalletModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: PriestTheme.colors.bg0,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoImage: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 148, 0.45)',
    backgroundColor: '#000000',
  },
  brandTitle: {
    color: PriestTheme.colors.textPrimary,
    fontWeight: '800',
    fontSize: 17,
    letterSpacing: -0.5,
  },
  brandAccent: {
    color: PriestTheme.colors.primary,
  },
  subtitle: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chainPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: PriestTheme.colors.bg2,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    gap: 6,
  },
  chainPillSolana: {
    borderColor: 'rgba(20, 241, 149, 0.3)',
  },
  chainPillMonad: {
    borderColor: 'rgba(131, 110, 249, 0.3)',
  },
  chainDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chainText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  walletButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: PriestTheme.colors.bg2,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    gap: 6,
  },
  walletButtonConnected: {
    borderColor: PriestTheme.colors.primary,
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  walletText: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  walletTextConnected: {
    color: PriestTheme.colors.primary,
  },
});
