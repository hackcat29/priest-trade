import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import { INITIAL_COPY_LEADERS, fetchLiveLeaders } from '../lib/api';
import type { CopyLeaderItem } from '../lib/types';
import { usePriest } from '../hooks/usePriestState';

export default function CopyTradingScreen() {
  const router = useRouter();
  const { wallet } = usePriest();
  const [leaders, setLeaders] = useState<CopyLeaderItem[]>(INITIAL_COPY_LEADERS);

  useEffect(() => {
    fetchLiveLeaders().then((live) => {
      if (live && live.length > 0) {
        setLeaders(live);
      }
    });
  }, []);
  const [selectedLeader, setSelectedLeader] = useState<CopyLeaderItem | null>(null);
  const [copyAmountUsd, setCopyAmountUsd] = useState('100');

  const handleToggleCopy = (leader: CopyLeaderItem) => {
    Haptics.selectionAsync();
    if (leader.isCopying) {
      Alert.alert(
        'Stop Copying',
        `Stop copying ${leader.name}? All future trades will cease.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Stop Copying',
            style: 'destructive',
            onPress: () => {
              setLeaders((prev) =>
                prev.map((l) => (l.id === leader.id ? { ...l, isCopying: false } : l))
              );
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            },
          },
        ]
      );
    } else {
      setSelectedLeader(leader);
    }
  };

  const handleConfirmCopy = () => {
    if (!selectedLeader) return;
    const amount = Number(copyAmountUsd);
    if (!amount || amount <= 0) {
      Alert.alert('Invalid Allocation', 'Please enter a valid amount.');
      return;
    }
    if (amount > wallet.freeCollateralUsd) {
      Alert.alert('Insufficient Balance', 'Not enough free USDC collateral.');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLeaders((prev) =>
      prev.map((l) =>
        l.id === selectedLeader.id
          ? { ...l, isCopying: true, copiersCount: l.copiersCount + 1 }
          : l
      )
    );
    setSelectedLeader(null);
    Alert.alert(
      'Copy Vault Activated! ⚡',
      `You are now mirroring ${selectedLeader.name}'s perp positions with $${amount} USDC allocated. Drawdown protection is active at 15%.`
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color={PriestTheme.colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>Copy Trading Vaults</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Explanation */}
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Passive Protocol Liquidity</Text>
          <Text style={styles.heroDesc}>
            Mirror top traders automatically. Protected by a 15% NAV drawdown liquidation guard.
          </Text>
        </View>

        {/* Leaders List */}
        <Text style={styles.sectionHeader}>TOP LEADER VAULTS</Text>

        {leaders.map((leader) => (
          <View key={leader.id} style={styles.leaderCard}>
            <View style={styles.leaderTop}>
              <View style={styles.leaderInfo}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{leader.name[0]}</Text>
                </View>
                <View>
                  <Text style={styles.leaderName}>{leader.name}</Text>
                  <Text style={styles.leaderHandle}>@{leader.handle}</Text>
                </View>
              </View>

              <View style={styles.roiBox}>
                <Text style={styles.roiValue}>+{leader.roi7d.toFixed(1)}%</Text>
                <Text style={styles.roiLabel}>7D ROI</Text>
              </View>
            </View>

            {/* Metrics Grid */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Win Rate</Text>
                <Text style={styles.metricValue}>{leader.winRate.toFixed(1)}%</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>30D ROI</Text>
                <Text style={[styles.metricValue, { color: PriestTheme.colors.primary }]}>
                  +{leader.roi30d.toFixed(0)}%
                </Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Max Drawdown</Text>
                <Text style={[styles.metricValue, { color: PriestTheme.colors.warning }]}>
                  {leader.maxDrawdown}%
                </Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Copiers</Text>
                <Text style={styles.metricValue}>{leader.copiersCount}</Text>
              </View>
            </View>

            {/* Copy CTA Button */}
            <TouchableOpacity
              style={[
                styles.copyBtn,
                leader.isCopying && styles.copyBtnActive,
              ]}
              onPress={() => handleToggleCopy(leader)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.copyBtnText,
                  leader.isCopying && styles.copyBtnTextActive,
                ]}
              >
                {leader.isCopying ? 'Active Copying (Tap to Stop)' : 'Copy This Vault'}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {/* Copy Setup Modal */}
      <Modal visible={!!selectedLeader} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Copy {selectedLeader?.name}</Text>
              <TouchableOpacity onPress={() => setSelectedLeader(null)}>
                <Ionicons name="close" size={20} color={PriestTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>Allocated Capital (USDC)</Text>
              <TextInput
                style={styles.textInput}
                keyboardType="decimal-pad"
                value={copyAmountUsd}
                onChangeText={setCopyAmountUsd}
                placeholder="100.00"
                placeholderTextColor={PriestTheme.colors.textMuted}
              />
              <Text style={styles.availText}>
                Available Collateral: ${wallet.freeCollateralUsd.toFixed(2)} USDC
              </Text>

              <View style={styles.vaultSpecs}>
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Performance Fee</Text>
                  <Text style={styles.specValue}>15% (10% to leader)</Text>
                </View>
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Drawdown Guard</Text>
                  <Text style={[styles.specValue, { color: PriestTheme.colors.primary }]}>
                    Auto-liquidate at 15% drop
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={handleConfirmCopy}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmBtnText}>Confirm Copy Vault</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
  },
  title: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: PriestTheme.colors.bg2,
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
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(131, 110, 249, 0.3)',
    marginBottom: 20,
  },
  heroTitle: {
    color: PriestTheme.colors.purple,
    fontSize: 16,
    fontWeight: '800',
  },
  heroDesc: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  sectionHeader: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  leaderCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 12,
  },
  leaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  leaderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PriestTheme.colors.bg3,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: PriestTheme.colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  leaderName: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  leaderHandle: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  roiBox: {
    alignItems: 'flex-end',
  },
  roiValue: {
    color: PriestTheme.colors.primary,
    fontSize: 18,
    fontWeight: '900',
  },
  roiLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
  },
  metricItem: {
    alignItems: 'center',
  },
  metricLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  metricValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  copyBtn: {
    height: 44,
    borderRadius: 12,
    backgroundColor: PriestTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: PriestTheme.colors.danger,
  },
  copyBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  copyBtnTextActive: {
    color: PriestTheme.colors.danger,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: PriestTheme.colors.bg1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  modalBody: {
    gap: 12,
  },
  inputLabel: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  textInput: {
    height: 48,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    paddingHorizontal: 14,
    color: PriestTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  availText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
  },
  vaultSpecs: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginVertical: 10,
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  specLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
  },
  specValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  confirmBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: PriestTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
});
