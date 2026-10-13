import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import { usePriest } from '../hooks/usePriestState';

export default function LaunchScreen() {
  const router = useRouter();
  const { wallet } = usePriest();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [selectedChain, setSelectedChain] = useState<'solana' | 'monad'>(wallet.chain);
  const [initialBuyUsd, setInitialBuyUsd] = useState('10');

  const handleNext = () => {
    if (step === 1) {
      if (!tokenName.trim() || !tokenSymbol.trim()) {
        Alert.alert('Required Fields', 'Please fill in token name and ticker symbol.');
        return;
      }
    }
    Haptics.selectionAsync();
    setStep((prev) => (prev + 1) as any);
  };

  const handleLaunch = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      '🚀 Market Created Successfully!',
      `$${tokenSymbol.toUpperCase()} perpetual market is live! It is initialized on the primary vAMM with 10x warmup protection, and will automatically graduate at $2M volume.`,
      [
        {
          text: 'Trade Now',
          onPress: () => {
            router.back();
            router.push('/(tabs)/trade');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color={PriestTheme.colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>Launch Perpetual</Text>
        <View style={styles.stepBadge}>
          <Text style={styles.stepText}>Step {step}/3</Text>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Step Indicator */}
        <View style={styles.stepIndicatorRow}>
          <View style={[styles.stepBar, step >= 1 && styles.stepBarActive]} />
          <View style={[styles.stepBar, step >= 2 && styles.stepBarActive]} />
          <View style={[styles.stepBar, step >= 3 && styles.stepBarActive]} />
        </View>

        {/* STEP 1: Metadata */}
        {step === 1 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepHeading}>Token Identity</Text>
            <Text style={styles.stepDesc}>
              Any token on Priest is born as an instant tradeable perpetual with up to 40x leverage.
            </Text>

            {/* Chain Selector */}
            <Text style={styles.inputLabel}>Target Network</Text>
            <View style={styles.chainRow}>
              <TouchableOpacity
                style={[
                  styles.chainChoice,
                  selectedChain === 'solana' && styles.chainChoiceActive,
                ]}
                onPress={() => setSelectedChain('solana')}
              >
                <Text style={styles.chainChoiceText}>Solana Network</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.chainChoice,
                  selectedChain === 'monad' && styles.chainChoiceActive,
                ]}
                onPress={() => setSelectedChain('monad')}
              >
                <Text style={styles.chainChoiceText}>Monad Network</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Token Name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Gigachad Inu"
              placeholderTextColor={PriestTheme.colors.textMuted}
              value={tokenName}
              onChangeText={setTokenName}
            />

            <Text style={styles.inputLabel}>Ticker Symbol</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. GIGA"
              placeholderTextColor={PriestTheme.colors.textMuted}
              value={tokenSymbol}
              onChangeText={setTokenSymbol}
              autoCapitalize="characters"
            />

            <Text style={styles.inputLabel}>Description & Alpha</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              multiline
              placeholder="Tell traders why this token will explode..."
              placeholderTextColor={PriestTheme.colors.textMuted}
              value={description}
              onChangeText={setDescription}
            />
          </View>
        )}

        {/* STEP 2: Parameters */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepHeading}>vAMM Parameters</Text>
            <Text style={styles.stepDesc}>
              Configured per protocol rules with fair launch protections.
            </Text>

            <View style={styles.specCard}>
              <View style={styles.specRow}>
                <Text style={styles.specLabel}>Initial vAMM Depth</Text>
                <Text style={styles.specValue}>$100,000 Virtual USDC</Text>
              </View>
              <View style={styles.specRow}>
                <Text style={styles.specLabel}>Warmup Leverage Cap</Text>
                <Text style={[styles.specValue, { color: PriestTheme.colors.warning }]}>
                  10x (24 hours)
                </Text>
              </View>
              <View style={styles.specRow}>
                <Text style={styles.specLabel}>Max Post-Warmup Leverage</Text>
                <Text style={[styles.specValue, { color: PriestTheme.colors.primary }]}>
                  40x
                </Text>
              </View>
              <View style={styles.specRow}>
                <Text style={styles.specLabel}>Taker Trading Fee</Text>
                <Text style={styles.specValue}>0.10%</Text>
              </View>
            </View>

            <Text style={styles.inputLabel}>Initial Dev Sniping / Buy (USDC)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="0.00"
              keyboardType="decimal-pad"
              placeholderTextColor={PriestTheme.colors.textMuted}
              value={initialBuyUsd}
              onChangeText={setInitialBuyUsd}
            />
          </View>
        )}

        {/* STEP 3: Fair Launch & Graduation Gates */}
        {step === 3 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepHeading}>Fair Launch Verification</Text>
            <Text style={styles.stepDesc}>
              On-chain guarantees enforced by the Priest smart contracts:
            </Text>

            <View style={styles.guaranteeCard}>
              <View style={styles.guaranteeItem}>
                <Ionicons name="checkmark-circle" size={18} color={PriestTheme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.guaranteeTitle}>Mint Authority Revoked</Text>
                  <Text style={styles.guaranteeSub}>Token supply is hard capped on-chain.</Text>
                </View>
              </View>

              <View style={styles.guaranteeItem}>
                <Ionicons name="checkmark-circle" size={18} color={PriestTheme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.guaranteeTitle}>Freeze Authority Disabled</Text>
                  <Text style={styles.guaranteeSub}>No blacklisting or frozen accounts.</Text>
                </View>
              </View>

              <View style={styles.guaranteeItem}>
                <Ionicons name="checkmark-circle" size={18} color={PriestTheme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.guaranteeTitle}>$2M Uniswap v4 / Monad Graduation</Text>
                  <Text style={styles.guaranteeSub}>
                    At $2M volume, 69 SOL/MON is seeded into Uniswap v4 pool & LP is burned!
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Bottom Navigation Buttons */}
        <View style={styles.bottomNav}>
          {step > 1 && (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => setStep((prev) => (prev - 1) as any)}
            >
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.nextBtn}
            onPress={step === 3 ? handleLaunch : handleNext}
            activeOpacity={0.8}
          >
            <Text style={styles.nextBtnText}>
              {step === 3 ? 'Deploy Market Now' : 'Continue'}
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
  stepBadge: {
    backgroundColor: PriestTheme.colors.primaryDim,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  stepText: {
    color: PriestTheme.colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  stepBar: {
    flex: 1,
    height: 4,
    backgroundColor: PriestTheme.colors.bg3,
    borderRadius: 2,
  },
  stepBarActive: {
    backgroundColor: PriestTheme.colors.primary,
  },
  stepContent: {
    marginBottom: 20,
  },
  stepHeading: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 4,
  },
  stepDesc: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  chainRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  chainChoice: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  chainChoiceActive: {
    borderColor: PriestTheme.colors.primary,
    backgroundColor: PriestTheme.colors.primaryDim,
  },
  chainChoiceText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  inputLabel: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    paddingHorizontal: 14,
    height: 48,
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
    marginBottom: 16,
  },
  textArea: {
    height: 80,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  specCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 16,
    gap: 10,
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
  guaranteeCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    gap: 16,
  },
  guaranteeItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  guaranteeTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  guaranteeSub: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  bottomNav: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  backBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: PriestTheme.colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  backBtnText: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  nextBtn: {
    flex: 2,
    height: 50,
    borderRadius: 14,
    backgroundColor: PriestTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
});
