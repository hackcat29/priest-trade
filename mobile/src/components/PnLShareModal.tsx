import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Share,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import type { PositionItem } from '../lib/types';

interface PnLShareModalProps {
  position: PositionItem | null;
  onClose: () => void;
}

const SKINS = [
  { id: 'cyberpunk', name: 'Cyberpunk', bg: '#0A0E17', accent: '#00FF94' },
  { id: 'aurora', name: 'Aurora', bg: '#130C25', accent: '#38BDF8' },
  { id: 'matrix', name: 'Matrix', bg: '#05140A', accent: '#00FF66' },
  { id: 'obsidian', name: 'Obsidian', bg: '#0A0A0C', accent: '#F2F3F5' },
];

export function PnLShareModal({ position, onClose }: PnLShareModalProps) {
  const [selectedSkin, setSelectedSkin] = useState(SKINS[0]);

  if (!position) return null;

  const isProfit = position.pnlUsd >= 0;

  const handleShare = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await Share.share({
        message: `Just scored ${isProfit ? '+' : ''}${position.roePercent.toFixed(1)}% ROE on $${position.symbol} ${position.side} ${position.leverage}x on @perpesfun! 🚀\nTrade perpetuals natively on Solana & Monad: https://perpes.fun`,
        title: `Priest.trade PnL Card - ${position.symbol}`,
      });
    } catch {}
  };

  return (
    <Modal visible={!!position} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Share PnL Card</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={PriestTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Skin Selector */}
          <View style={styles.skinSelector}>
            {SKINS.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[
                  styles.skinBtn,
                  selectedSkin.id === s.id && styles.skinBtnActive,
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelectedSkin(s);
                }}
              >
                <View style={[styles.skinColorDot, { backgroundColor: s.accent }]} />
                <Text
                  style={[
                    styles.skinBtnText,
                    selectedSkin.id === s.id && styles.skinBtnTextActive,
                  ]}
                >
                  {s.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* The Visual Card Canvas */}
          <View style={[styles.cardCanvas, { backgroundColor: selectedSkin.bg }]}>
            {/* Top Brand Bar */}
            <View style={styles.cardHeader}>
              <View style={styles.cardLogo}>
                <Text style={styles.cardLogoP}>P</Text>
                <Text style={styles.cardBrandText}>perpes<Text style={{ color: selectedSkin.accent }}>.fun</Text></Text>
              </View>
              <View style={[styles.sideBadge, { borderColor: selectedSkin.accent }]}>
                <Text style={[styles.sideBadgeText, { color: selectedSkin.accent }]}>
                  {position.side.toUpperCase()} {position.leverage}X
                </Text>
              </View>
            </View>

            {/* Token & ROE Section */}
            <View style={styles.roeSection}>
              <Text style={styles.tokenTitle}>{position.symbol} PERP</Text>
              <Text
                style={[
                  styles.roeText,
                  { color: isProfit ? selectedSkin.accent : PriestTheme.colors.danger },
                ]}
              >
                {isProfit ? '+' : ''}{position.roePercent.toFixed(1)}%
              </Text>
              <Text style={styles.pnlSubtext}>
                {isProfit ? '+' : ''}${position.pnlUsd.toFixed(2)} USD PnL
              </Text>
            </View>

            {/* Price Details */}
            <View style={styles.cardDetails}>
              <View>
                <Text style={styles.detailLabel}>ENTRY PRICE</Text>
                <Text style={styles.detailValue}>${position.entryPrice.toFixed(4)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.detailLabel}>MARK PRICE</Text>
                <Text style={styles.detailValue}>${position.markPrice.toFixed(4)}</Text>
              </View>
            </View>

            {/* Footer Watermark */}
            <View style={styles.cardFooter}>
              <Text style={styles.footerTag}>Solana & Monad Perpetuals Launchpad</Text>
              <Text style={styles.footerRef}>t.me/perpesfun</Text>
            </View>
          </View>

          {/* Share Action */}
          <TouchableOpacity
            style={[styles.shareActionButton, { backgroundColor: selectedSkin.accent }]}
            onPress={handleShare}
            activeOpacity={0.8}
          >
            <Ionicons name="share-social" size={18} color="#000000" />
            <Text style={styles.shareActionText}>Share to X & Telegram</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: PriestTheme.colors.bg1,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    color: PriestTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: PriestTheme.colors.bg2,
  },
  skinSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 6,
  },
  skinBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: PriestTheme.colors.bg2,
    borderWidth: 1,
    borderColor: PriestTheme.colors.border,
    gap: 5,
  },
  skinBtnActive: {
    borderColor: PriestTheme.colors.primary,
  },
  skinColorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  skinBtnText: {
    color: PriestTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  skinBtnTextActive: {
    color: PriestTheme.colors.textPrimary,
  },
  cardCanvas: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  cardLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardLogoP: {
    color: '#000000',
    backgroundColor: '#00FF94',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    fontWeight: '900',
    fontSize: 14,
  },
  cardBrandText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
  },
  sideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  sideBadgeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  roeSection: {
    alignItems: 'center',
    marginVertical: 14,
  },
  tokenTitle: {
    color: '#91939C',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  roeText: {
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -1,
  },
  pnlSubtext: {
    color: '#F2F3F5',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  cardDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    marginBottom: 16,
  },
  detailLabel: {
    color: '#91939C',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  detailValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 10,
  },
  footerTag: {
    color: '#585A65',
    fontSize: 10,
    fontWeight: '600',
  },
  footerRef: {
    color: '#91939C',
    fontSize: 10,
    fontWeight: '700',
  },
  shareActionButton: {
    flexDirection: 'row',
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareActionText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '900',
  },
});
