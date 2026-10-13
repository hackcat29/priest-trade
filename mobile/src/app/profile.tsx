import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import { usePriest } from '../hooks/usePriestState';

export function ProfileScreen() {
  const router = useRouter();
  const { wallet, markets } = usePriest();
  const [username, setUsername] = useState('AnonChad');
  const [bio, setBio] = useState('Perp degen scalping vAMMs on Solana & Monad 🚀 | Top 5% Epoch 14');
  const [isEditing, setIsEditing] = useState(false);

  const launchedMarkets = markets.slice(0, 2);

  const handleSaveProfile = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsEditing(false);
    Alert.alert('Profile Saved', 'Your public creator profile has been updated on-chain.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="arrow-back" size={20} color={PriestTheme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Creator Profile</Text>
        <TouchableOpacity onPress={() => setIsEditing(!isEditing)} style={styles.editBtn}>
          <Ionicons name={isEditing ? 'checkmark' : 'create-outline'} size={20} color={PriestTheme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Banner & Avatar */}
        <View style={styles.bannerContainer}>
          <View style={styles.bannerBg} />
          <View style={styles.avatarWrapper}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{username[0]}</Text>
            </View>
          </View>
        </View>

        {/* User Identity */}
        <View style={styles.identitySection}>
          {isEditing ? (
            <TextInput
              style={styles.editInput}
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={PriestTheme.colors.textMuted}
            />
          ) : (
            <Text style={styles.nameText}>{username}</Text>
          )}
          <Text style={styles.addressText}>{wallet.address}</Text>

          {isEditing ? (
            <TextInput
              style={[styles.editInput, styles.editBioInput]}
              value={bio}
              onChangeText={setBio}
              multiline
              placeholder="Bio"
              placeholderTextColor={PriestTheme.colors.textMuted}
            />
          ) : (
            <Text style={styles.bioText}>{bio}</Text>
          )}

          {isEditing && (
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile}>
              <Text style={styles.saveBtnText}>Save Changes</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Creator Performance Metrics */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Creator Earnings</Text>
            <Text style={[styles.metricValue, { color: PriestTheme.colors.primary }]}>
              $1,420.50
            </Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Launched Markets</Text>
            <Text style={styles.metricValue}>{launchedMarkets.length}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Followers</Text>
            <Text style={styles.metricValue}>1,240</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Trading Volume</Text>
            <Text style={styles.metricValue}>$4.2M</Text>
          </View>
        </View>

        {/* Launched Perpetuals List */}
        <Text style={styles.sectionHeader}>LAUNCHED PERPETUAL MARKETS</Text>
        {launchedMarkets.map((m) => (
          <View key={m.mint} style={styles.marketCard}>
            <View style={styles.marketTop}>
              <View>
                <Text style={styles.marketSymbol}>${m.symbol}</Text>
                <Text style={styles.marketName}>{m.name}</Text>
              </View>
              <View style={styles.gradPill}>
                <Text style={styles.gradText}>{m.graduationPercent}% Graduated</Text>
              </View>
            </View>
            <View style={styles.marketBottom}>
              <Text style={styles.marketVol}>24h Volume: ${(m.volume24h / 1000).toFixed(0)}k</Text>
              <Text style={styles.marketPrice}>${m.price.toFixed(4)}</Text>
            </View>
          </View>
        ))}
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
  },
  closeBtn: {
    padding: 6,
  },
  title: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  editBtn: {
    padding: 6,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 40,
  },
  bannerContainer: {
    position: 'relative',
    marginBottom: 44,
  },
  bannerBg: {
    height: 110,
    backgroundColor: PriestTheme.colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.border,
  },
  avatarWrapper: {
    position: 'absolute',
    bottom: -36,
    left: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: PriestTheme.colors.primaryDim,
    borderWidth: 3,
    borderColor: PriestTheme.colors.bg0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: PriestTheme.colors.primary,
    fontSize: 32,
    fontWeight: '900',
  },
  identitySection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  nameText: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
  },
  addressText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  bioText: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  editInput: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    paddingHorizontal: 12,
    height: 40,
    color: PriestTheme.colors.textPrimary,
    fontSize: 14,
    marginBottom: 8,
  },
  editBioInput: {
    height: 70,
    paddingVertical: 10,
  },
  saveBtn: {
    backgroundColor: PriestTheme.colors.primary,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 24,
  },
  metricCard: {
    width: '48%',
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  metricLabel: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  metricValue: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 4,
  },
  sectionHeader: {
    color: PriestTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  marketCard: {
    marginHorizontal: 16,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    marginBottom: 10,
  },
  marketTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  marketSymbol: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  marketName: {
    color: PriestTheme.colors.textMuted,
    fontSize: 12,
  },
  gradPill: {
    backgroundColor: PriestTheme.colors.primaryDim,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  gradText: {
    color: PriestTheme.colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  marketBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: PriestTheme.colors.borderSubtle,
    paddingTop: 8,
  },
  marketVol: {
    color: PriestTheme.colors.textSecondary,
    fontSize: 12,
  },
  marketPrice: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
});

export default ProfileScreen;
