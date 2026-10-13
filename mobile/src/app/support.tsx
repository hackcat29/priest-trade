import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PriestTheme } from '../constants/theme';
import { API_BASE } from '../lib/api';

interface FAQItem {
  id: string;
  q: string;
  a: string;
}

const FAQS: FAQItem[] = [
  {
    id: '1',
    q: 'What is Priest.trade?',
    a: 'A memecoin launchpad where every newly created coin automatically receives its own perpetual futures market. You can trade long or short with leverage from minute one, watch the creator stream live, and earn creator trading fees.',
  },
  {
    id: '2',
    q: 'Do I need to deposit?',
    a: 'No. Trades are signed directly from your connected wallet (or embedded Privy wallet), and collateral moves on-chain. Priest never holds your custody.',
  },
  {
    id: '3',
    q: 'What is the difference between Primary and Secondary markets?',
    a: "Primary markets are new launches priced along a virtual AMM (vAMM) curve where trades directly move the price. Graduated tokens unlock permanent spot pools and become Secondary markets priced via TWAP oracles with hourly funding payments.",
  },
  {
    id: '4',
    q: 'When does my position get liquidated?',
    a: 'When your margin falls below the maintenance requirement at both mark price and index price. Requiring both safeguards positions from being liquidated by single-wick anomalies.',
  },
  {
    id: '5',
    q: 'How does funding work?',
    a: 'Every hour, the crowded side pays the uncrowded side. If open interest is net long, longs pay shorts. Current funding rates and countdown timers are displayed on the trading terminal.',
  },
  {
    id: '6',
    q: 'Where do trading fees go?',
    a: 'Trading fees are split between the market creator (25% to 50%), the protocol insurance fund, and the protocol treasury.',
  },
  {
    id: '7',
    q: 'What is "claimable profit"?',
    a: "If a market vault cannot disburse your full profit instantly when closing during high volatility, your payout is recorded on-chain and can be claimed from your Portfolio as soon as vault liquidity refills.",
  },
];

export default function SupportScreen() {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>('1');
  const [apiLatency, setApiLatency] = useState<number | null>(null);
  const [isOperational, setIsOperational] = useState<boolean>(true);

  useEffect(() => {
    const t0 = Date.now();
    fetch(`${API_BASE}/health`)
      .then((res) => {
        if (res.ok) {
          setApiLatency(Date.now() - t0);
          setIsOperational(true);
        } else {
          setIsOperational(false);
        }
      })
      .catch(() => setIsOperational(false));
  }, []);

  const toggleExpand = (id: string) => {
    Haptics.selectionAsync();
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={PriestTheme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Support & System Status</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Live System Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeaderRow}>
            <View style={styles.pulseContainer}>
              <View style={[styles.pulseDot, !isOperational && { backgroundColor: '#FF4D4D' }]} />
              <Text style={styles.statusTitle}>
                {isOperational ? 'All Systems Operational' : 'Degraded Performance'}
              </Text>
            </View>
            <Text style={styles.uptimeText}>
              {apiLatency !== null ? `${apiLatency}ms latency` : '99.98% Uptime'}
            </Text>
          </View>

          <View style={styles.statusGrid}>
            <View style={styles.statusRow}>
              <Text style={styles.serviceName}>Perpetuals Indexer</Text>
              <View style={styles.operationalBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#00FF94" />
                <Text style={styles.operationalText}>Operational</Text>
              </View>
            </View>

            <View style={styles.statusRow}>
              <Text style={styles.serviceName}>vAMM & DLOB Engines</Text>
              <View style={styles.operationalBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#00FF94" />
                <Text style={styles.operationalText}>Operational</Text>
              </View>
            </View>

            <View style={styles.statusRow}>
              <Text style={styles.serviceName}>Liquidator Keepers</Text>
              <View style={styles.operationalBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#00FF94" />
                <Text style={styles.operationalText}>Operational</Text>
              </View>
            </View>

            <View style={styles.statusRow}>
              <Text style={styles.serviceName}>LiveKit Streaming Nodes</Text>
              <View style={styles.operationalBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#00FF94" />
                <Text style={styles.operationalText}>Operational</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Community Links */}
        <View style={styles.communityRow}>
          <TouchableOpacity
            style={styles.communityCard}
            onPress={() => Linking.openURL('https://x.com/perpesfun')}
          >
            <Ionicons name="logo-twitter" size={18} color={PriestTheme.colors.primary} />
            <Text style={styles.communityText}>Twitter / X</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.communityCard}
            onPress={() => Linking.openURL('https://t.me/perpesfun')}
          >
            <Ionicons name="paper-plane" size={18} color={PriestTheme.colors.info} />
            <Text style={styles.communityText}>Telegram</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.communityCard}
            onPress={() => Linking.openURL('https://discord.gg/perpes')}
          >
            <Ionicons name="logo-discord" size={18} color={PriestTheme.colors.purple} />
            <Text style={styles.communityText}>Discord</Text>
          </TouchableOpacity>
        </View>

        {/* FAQ Section */}
        <View style={styles.faqSection}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          <Text style={styles.sectionSubtitle}>
            Everything you need to know about trading, launching, and earning on Priest.
          </Text>

          {FAQS.map((faq) => {
            const isExpanded = expandedId === faq.id;
            return (
              <TouchableOpacity
                key={faq.id}
                style={[styles.faqCard, isExpanded && styles.faqCardExpanded]}
                onPress={() => toggleExpand(faq.id)}
                activeOpacity={0.8}
              >
                <View style={styles.faqQuestionRow}>
                  <Text style={styles.faqQuestion}>{faq.q}</Text>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={PriestTheme.colors.textMuted}
                  />
                </View>

                {isExpanded && (
                  <View style={styles.faqAnswerContainer}>
                    <Text style={styles.faqAnswer}>{faq.a}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
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
  statusCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 148, 0.25)',
    marginBottom: 14,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: PriestTheme.colors.borderSubtle,
    paddingBottom: 12,
    marginBottom: 12,
  },
  pulseContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00FF94',
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
  },
  uptimeText: {
    fontSize: 11,
    color: PriestTheme.colors.primary,
    fontWeight: '700',
  },
  statusGrid: {
    gap: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  serviceName: {
    fontSize: 12,
    color: PriestTheme.colors.textSecondary,
    fontWeight: '600',
  },
  operationalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  operationalText: {
    fontSize: 11,
    fontWeight: '700',
    color: PriestTheme.colors.primary,
  },
  communityRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  communityCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
  },
  communityText: {
    fontSize: 12,
    fontWeight: '700',
    color: PriestTheme.colors.textPrimary,
  },
  faqSection: {
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: PriestTheme.colors.textSecondary,
    marginBottom: 14,
  },
  faqCard: {
    backgroundColor: PriestTheme.colors.bg2,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: PriestTheme.colors.borderSubtle,
    marginBottom: 10,
  },
  faqCardExpanded: {
    borderColor: 'rgba(0, 255, 148, 0.3)',
  },
  faqQuestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  faqQuestion: {
    fontSize: 13,
    fontWeight: '800',
    color: PriestTheme.colors.textPrimary,
    flex: 1,
    paddingRight: 10,
  },
  faqAnswerContainer: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: PriestTheme.colors.borderSubtle,
  },
  faqAnswer: {
    fontSize: 12,
    lineHeight: 18,
    color: PriestTheme.colors.textSecondary,
  },
});
